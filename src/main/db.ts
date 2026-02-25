import Database from 'better-sqlite3'
import path from 'path'
import os from 'os'
import fs from 'fs'
import type { Task, CreateTaskInput, Project, ProjectStats, AgentLogEntry, Handoff } from '../shared/types'

const CLAWFLOW_DIR = path.join(os.homedir(), '.clawflow')
const DBS_DIR = path.join(CLAWFLOW_DIR, 'dbs')
const GLOBAL_DB_PATH = path.join(CLAWFLOW_DIR, 'clawflow.db')

function ensureDirs() {
  fs.mkdirSync(DBS_DIR, { recursive: true })
}

// --- Global DB (projects registry) ---

let globalDb: Database.Database | null = null

function getGlobalDb(): Database.Database {
  if (globalDb) return globalDb
  ensureDirs()
  globalDb = new Database(GLOBAL_DB_PATH)
  globalDb.pragma('journal_mode = DELETE')
  globalDb.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      name TEXT PRIMARY KEY,
      path TEXT NOT NULL,
      db_path TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_opened TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `)
  return globalDb
}

export function listProjects(): Project[] {
  const db = getGlobalDb()
  const rows = db.prepare('SELECT * FROM projects ORDER BY last_opened DESC').all() as any[]
  return rows.map(r => ({
    name: r.name,
    path: r.path,
    dbPath: r.db_path,
    createdAt: r.created_at,
    lastOpened: r.last_opened
  }))
}

export function registerProject(name: string, projectPath: string): Project {
  const db = getGlobalDb()
  const dbPath = path.join(DBS_DIR, `${name}.db`)
  const now = new Date().toISOString()

  db.prepare(`
    INSERT OR REPLACE INTO projects (name, path, db_path, created_at, last_opened)
    VALUES (?, ?, ?, ?, ?)
  `).run(name, projectPath, dbPath, now, now)

  initProjectDb(dbPath)

  const configDir = path.join(projectPath, '.clawflow')
  fs.mkdirSync(configDir, { recursive: true })
  fs.writeFileSync(
    path.join(configDir, 'project.json'),
    JSON.stringify({ name, registeredAt: now }, null, 2)
  )

  return { name, path: projectPath, dbPath, createdAt: now, lastOpened: now }
}

export function openProject(name: string): void {
  const db = getGlobalDb()
  db.prepare('UPDATE projects SET last_opened = ? WHERE name = ?')
    .run(new Date().toISOString(), name)
}

export function deleteProject(name: string): void {
  const db = getGlobalDb()
  const project = db.prepare('SELECT db_path FROM projects WHERE name = ?').get(name) as any
  if (project && fs.existsSync(project.db_path)) {
    fs.unlinkSync(project.db_path)
  }
  db.prepare('DELETE FROM projects WHERE name = ?').run(name)
}

// --- Project DB (tasks) ---

const projectDbs = new Map<string, Database.Database>()

function initProjectDb(dbPath: string): Database.Database {
  const db = new Database(dbPath)
  db.pragma('journal_mode = DELETE')
  db.exec(`
    CREATE TABLE IF NOT EXISTS tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      tier TEXT NOT NULL DEFAULT 'L2',
      status TEXT NOT NULL DEFAULT 'backlog',
      priority TEXT NOT NULL DEFAULT 'medium',
      auto_mode INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      started_at TEXT,
      completed_at TEXT,
      current_agent TEXT,
      brainstorm_output TEXT,
      design_review TEXT,
      plan TEXT,
      plan_review_count INTEGER NOT NULL DEFAULT 0,
      implementation_notes TEXT,
      review_comments TEXT,
      review_score REAL,
      impl_review_count INTEGER NOT NULL DEFAULT 0,
      test_results TEXT,
      verify_result TEXT,
      commit_hash TEXT,
      handoffs TEXT NOT NULL DEFAULT '[]',
      agent_log TEXT NOT NULL DEFAULT '[]'
    )
  `)
  return db
}

function getProjectDb(dbPath: string): Database.Database {
  let db = projectDbs.get(dbPath)
  if (db) return db
  db = initProjectDb(dbPath)
  projectDbs.set(dbPath, db)
  return db
}

export function listTasks(dbPath: string): Task[] {
  const db = getProjectDb(dbPath)
  const rows = db.prepare('SELECT * FROM tasks ORDER BY id ASC').all() as any[]
  return rows.map(rowToTask)
}

export function getTask(dbPath: string, taskId: number): Task | null {
  const db = getProjectDb(dbPath)
  const row = db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId) as any
  return row ? rowToTask(row) : null
}

export function createTask(dbPath: string, input: CreateTaskInput): Task {
  const db = getProjectDb(dbPath)
  const result = db.prepare(`
    INSERT INTO tasks (title, description, tier, priority, auto_mode)
    VALUES (?, ?, ?, ?, ?)
  `).run(input.title, input.description, input.tier, input.priority, input.autoMode ? 1 : 0)

  return getTask(dbPath, result.lastInsertRowid as number)!
}

export function updateTask(dbPath: string, taskId: number, updates: Partial<Record<string, any>>): Task | null {
  const db = getProjectDb(dbPath)
  const setClauses: string[] = []
  const values: any[] = []

  for (const [key, value] of Object.entries(updates)) {
    const dbKey = camelToSnake(key)
    setClauses.push(`${dbKey} = ?`)
    values.push(typeof value === 'object' && value !== null ? JSON.stringify(value) : value)
  }

  if (setClauses.length === 0) return getTask(dbPath, taskId)

  values.push(taskId)
  db.prepare(`UPDATE tasks SET ${setClauses.join(', ')} WHERE id = ?`).run(...values)
  return getTask(dbPath, taskId)
}

export function deleteTask(dbPath: string, taskId: number): void {
  const db = getProjectDb(dbPath)
  db.prepare('DELETE FROM tasks WHERE id = ?').run(taskId)
}

export function appendAgentLog(dbPath: string, taskId: number, entry: AgentLogEntry): void {
  const db = getProjectDb(dbPath)
  const task = getTask(dbPath, taskId)
  if (!task) return
  const log = [...task.agentLog, entry]
  db.prepare('UPDATE tasks SET agent_log = ? WHERE id = ?').run(JSON.stringify(log), taskId)
}

export function appendHandoff(dbPath: string, taskId: number, handoff: Handoff): void {
  const db = getProjectDb(dbPath)
  const task = getTask(dbPath, taskId)
  if (!task) return
  const handoffs = [...task.handoffs, handoff]
  db.prepare('UPDATE tasks SET handoffs = ? WHERE id = ?').run(JSON.stringify(handoffs), taskId)
}

export function getProjectStats(dbPath: string): ProjectStats {
  const tasks = listTasks(dbPath)

  const backlog = tasks.filter(t => t.status === 'backlog').length
  const done = tasks.filter(t => t.status === 'done').length
  const blocked = tasks.filter(t => t.status === 'blocked').length
  const inProgress = tasks.filter(t => !['backlog', 'done', 'blocked'].includes(t.status)).length
  const total = tasks.length
  const completionRate = total > 0 ? done / total : 0

  const scores = tasks.filter(t => t.reviewScore !== null).map(t => t.reviewScore!)
  const avgReviewScore = scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : null

  const circuitBreakerTrips = tasks.filter(t =>
    t.planReviewCount >= 3 || t.implReviewCount >= 3
  ).length

  return { backlog, inProgress, done, blocked, completionRate, avgReviewScore, circuitBreakerTrips }
}

export function closeAllDbs(): void {
  globalDb?.close()
  globalDb = null
  for (const db of projectDbs.values()) db.close()
  projectDbs.clear()
}

// --- Helpers ---

function rowToTask(row: any): Task {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    tier: row.tier,
    status: row.status,
    priority: row.priority,
    autoMode: !!row.auto_mode,
    createdAt: row.created_at,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    currentAgent: row.current_agent,
    brainstormOutput: row.brainstorm_output,
    designReview: safeJsonParse(row.design_review),
    plan: safeJsonParse(row.plan),
    planReviewCount: row.plan_review_count,
    implementationNotes: safeJsonParse(row.implementation_notes),
    reviewComments: safeJsonParse(row.review_comments),
    reviewScore: row.review_score,
    implReviewCount: row.impl_review_count,
    testResults: safeJsonParse(row.test_results),
    verifyResult: row.verify_result,
    commitHash: row.commit_hash,
    handoffs: safeJsonParse(row.handoffs) ?? [],
    agentLog: safeJsonParse(row.agent_log) ?? []
  }
}

function safeJsonParse(value: string | null): any {
  if (!value) return null
  try { return JSON.parse(value) } catch { return null }
}

function camelToSnake(str: string): string {
  return str.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`)
}
