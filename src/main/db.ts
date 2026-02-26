import Database from 'better-sqlite3'
import path from 'path'
import os from 'os'
import fs from 'fs'
import type { Task, CreateTaskInput, Project, ProjectStats, AgentLogEntry, Handoff, WorkshopSession, WorkshopMessage, WorkshopArtifact, WorkshopTaskLink, WorkshopMessageRole, WorkshopMessageType, WorkshopArtifactType, WorkshopSessionType, PanelPersona } from '../shared/types'
import crypto from 'crypto'

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
      last_opened TEXT NOT NULL DEFAULT (datetime('now')),
      default_base_branch TEXT NOT NULL DEFAULT 'main',
      git_enabled INTEGER NOT NULL DEFAULT 1
    )
  `)
  migrateProjectsTable(globalDb)
  return globalDb
}

function rowToProject(r: any): Project {
  return {
    name: r.name,
    path: r.path,
    dbPath: r.db_path,
    createdAt: r.created_at,
    lastOpened: r.last_opened,
    defaultBaseBranch: r.default_base_branch ?? 'main',
    gitEnabled: r.git_enabled !== 0
  }
}

export function listProjects(): Project[] {
  const db = getGlobalDb()
  const rows = db.prepare('SELECT * FROM projects ORDER BY last_opened DESC').all() as any[]
  return rows.map(rowToProject)
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

  return { name, path: projectPath, dbPath, createdAt: now, lastOpened: now, defaultBaseBranch: 'main', gitEnabled: true }
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
      branch_name TEXT,
      worktree_path TEXT,
      pr_url TEXT,
      handoffs TEXT NOT NULL DEFAULT '[]',
      agent_log TEXT NOT NULL DEFAULT '[]'
    )
  `)
  migrateTasksTable(db)
  db.exec(`
    CREATE TABLE IF NOT EXISTS workshop_sessions (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      title TEXT NOT NULL DEFAULT 'New Session',
      summary TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      pending_content TEXT DEFAULT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      session_type TEXT NOT NULL DEFAULT 'solo',
      panel_personas TEXT
    )
  `)
  migrateWorkshopSessionsTable(db)
  db.exec(`
    CREATE TABLE IF NOT EXISTS workshop_messages (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES workshop_sessions(id),
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      message_type TEXT NOT NULL DEFAULT 'text',
      metadata TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      persona_id TEXT,
      persona_name TEXT,
      round_number INTEGER
    )
  `)
  migrateWorkshopMessagesTable(db)
  db.exec(`
    CREATE TABLE IF NOT EXISTS workshop_artifacts (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      file_path TEXT NOT NULL,
      current_version INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `)
  db.exec(`
    CREATE TABLE IF NOT EXISTS workshop_task_links (
      id TEXT PRIMARY KEY,
      task_id INTEGER NOT NULL REFERENCES tasks(id),
      session_id TEXT REFERENCES workshop_sessions(id),
      artifact_id TEXT REFERENCES workshop_artifacts(id),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
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
  db.prepare('DELETE FROM workshop_task_links WHERE task_id = ?').run(taskId)
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

export function updateProjectBaseBranch(projectName: string, baseBranch: string): void {
  const db = getGlobalDb()
  db.prepare('UPDATE projects SET default_base_branch = ? WHERE name = ?').run(baseBranch, projectName)
}

export function closeAllDbs(): void {
  globalDb?.close()
  globalDb = null
  for (const db of projectDbs.values()) db.close()
  projectDbs.clear()
}

// --- Workshop Sessions ---

export function createWorkshopSession(
  dbPath: string,
  projectId: string,
  title?: string,
  sessionType: WorkshopSessionType = 'solo',
  panelPersonas: PanelPersona[] | null = null
): WorkshopSession {
  const db = getProjectDb(dbPath)
  const id = crypto.randomUUID()
  db.prepare(`
    INSERT INTO workshop_sessions (id, project_id, title, session_type, panel_personas)
    VALUES (?, ?, ?, ?, ?)
  `).run(id, projectId, title ?? 'New Session', sessionType, panelPersonas ? JSON.stringify(panelPersonas) : null)
  return getWorkshopSession(dbPath, id)!
}

export function getWorkshopSession(dbPath: string, id: string): WorkshopSession | null {
  const db = getProjectDb(dbPath)
  const row = db.prepare('SELECT * FROM workshop_sessions WHERE id = ?').get(id) as any
  return row ? rowToWorkshopSession(row) : null
}

export function listWorkshopSessions(dbPath: string, projectId: string): WorkshopSession[] {
  const db = getProjectDb(dbPath)
  const rows = db.prepare('SELECT * FROM workshop_sessions WHERE project_id = ? ORDER BY updated_at DESC').all(projectId) as any[]
  return rows.map(rowToWorkshopSession)
}

export function updateWorkshopSession(dbPath: string, id: string, updates: Partial<Record<string, any>>): WorkshopSession | null {
  const db = getProjectDb(dbPath)
  const setClauses: string[] = []
  const values: any[] = []

  for (const [key, value] of Object.entries(updates)) {
    const dbKey = camelToSnake(key)
    setClauses.push(`${dbKey} = ?`)
    values.push(typeof value === 'object' && value !== null ? JSON.stringify(value) : value)
  }

  setClauses.push('updated_at = datetime(\'now\')')

  if (setClauses.length === 1) return getWorkshopSession(dbPath, id)

  values.push(id)
  db.prepare(`UPDATE workshop_sessions SET ${setClauses.join(', ')} WHERE id = ?`).run(...values)
  return getWorkshopSession(dbPath, id)
}

export function deleteWorkshopSession(dbPath: string, sessionId: string): void {
  const db = getProjectDb(dbPath)
  db.prepare('DELETE FROM workshop_task_links WHERE session_id = ?').run(sessionId)
  db.prepare('DELETE FROM workshop_messages WHERE session_id = ?').run(sessionId)
  db.prepare('DELETE FROM workshop_sessions WHERE id = ?').run(sessionId)
}

// --- Workshop Messages ---

export function createWorkshopMessage(
  dbPath: string,
  sessionId: string,
  role: WorkshopMessageRole,
  content: string,
  messageType?: WorkshopMessageType,
  metadata?: Record<string, unknown> | null,
  personaId?: string | null,
  personaName?: string | null,
  roundNumber?: number | null
): WorkshopMessage {
  const db = getProjectDb(dbPath)
  const id = crypto.randomUUID()
  db.prepare(`
    INSERT INTO workshop_messages (id, session_id, role, content, message_type, metadata, persona_id, persona_name, round_number)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, sessionId, role, content, messageType ?? 'text', metadata ? JSON.stringify(metadata) : null, personaId ?? null, personaName ?? null, roundNumber ?? null)
  const row = db.prepare('SELECT * FROM workshop_messages WHERE id = ?').get(id) as any
  return rowToWorkshopMessage(row)
}

export function listWorkshopMessages(dbPath: string, sessionId: string): WorkshopMessage[] {
  const db = getProjectDb(dbPath)
  const rows = db.prepare('SELECT * FROM workshop_messages WHERE session_id = ? ORDER BY created_at ASC').all(sessionId) as any[]
  return rows.map(rowToWorkshopMessage)
}

// --- Workshop Artifacts ---

export function createWorkshopArtifact(dbPath: string, projectId: string, name: string, type: WorkshopArtifactType, filePath: string): WorkshopArtifact {
  const db = getProjectDb(dbPath)
  const id = crypto.randomUUID()
  db.prepare(`
    INSERT INTO workshop_artifacts (id, project_id, name, type, file_path)
    VALUES (?, ?, ?, ?, ?)
  `).run(id, projectId, name, type, filePath)
  return getWorkshopArtifact(dbPath, id)!
}

export function listWorkshopArtifacts(dbPath: string, projectId: string): WorkshopArtifact[] {
  const db = getProjectDb(dbPath)
  const rows = db.prepare('SELECT * FROM workshop_artifacts WHERE project_id = ? ORDER BY updated_at DESC').all(projectId) as any[]
  return rows.map(rowToWorkshopArtifact)
}

export function getWorkshopArtifact(dbPath: string, id: string): WorkshopArtifact | null {
  const db = getProjectDb(dbPath)
  const row = db.prepare('SELECT * FROM workshop_artifacts WHERE id = ?').get(id) as any
  return row ? rowToWorkshopArtifact(row) : null
}

export function updateWorkshopArtifact(dbPath: string, id: string, updates: Partial<Record<string, any>>): WorkshopArtifact | null {
  const db = getProjectDb(dbPath)
  const setClauses: string[] = []
  const values: any[] = []

  for (const [key, value] of Object.entries(updates)) {
    const dbKey = camelToSnake(key)
    setClauses.push(`${dbKey} = ?`)
    values.push(typeof value === 'object' && value !== null ? JSON.stringify(value) : value)
  }

  setClauses.push('updated_at = datetime(\'now\')')

  if (setClauses.length === 1) return getWorkshopArtifact(dbPath, id)

  values.push(id)
  db.prepare(`UPDATE workshop_artifacts SET ${setClauses.join(', ')} WHERE id = ?`).run(...values)
  return getWorkshopArtifact(dbPath, id)
}

// --- Workshop Task Links ---

export function createWorkshopTaskLink(dbPath: string, taskId: number, sessionId?: string | null, artifactId?: string | null): WorkshopTaskLink {
  const db = getProjectDb(dbPath)
  const id = crypto.randomUUID()
  db.prepare(`
    INSERT INTO workshop_task_links (id, task_id, session_id, artifact_id)
    VALUES (?, ?, ?, ?)
  `).run(id, taskId, sessionId ?? null, artifactId ?? null)
  const row = db.prepare('SELECT * FROM workshop_task_links WHERE id = ?').get(id) as any
  return rowToWorkshopTaskLink(row)
}

export function getWorkshopTaskLinks(dbPath: string, taskId: number): WorkshopTaskLink[] {
  const db = getProjectDb(dbPath)
  const rows = db.prepare('SELECT * FROM workshop_task_links WHERE task_id = ?').all(taskId) as any[]
  return rows.map(rowToWorkshopTaskLink)
}

export function getAllTasks(dbPath: string): Task[] {
  const db = getProjectDb(dbPath)
  const rows = db.prepare('SELECT * FROM tasks ORDER BY id').all() as any[]
  return rows.map(rowToTask)
}

// --- Helpers ---

function migrateTasksTable(db: Database.Database): void {
  const cols = db.pragma('table_info(tasks)') as { name: string }[]
  const colNames = new Set(cols.map(c => c.name))
  if (!colNames.has('branch_name')) db.prepare('ALTER TABLE tasks ADD COLUMN branch_name TEXT').run()
  if (!colNames.has('worktree_path')) db.prepare('ALTER TABLE tasks ADD COLUMN worktree_path TEXT').run()
  if (!colNames.has('pr_url')) db.prepare('ALTER TABLE tasks ADD COLUMN pr_url TEXT').run()
  if (!colNames.has('todos')) db.prepare('ALTER TABLE tasks ADD COLUMN todos TEXT').run()
}

function migrateProjectsTable(db: Database.Database): void {
  const cols = db.pragma('table_info(projects)') as { name: string }[]
  const colNames = new Set(cols.map(c => c.name))
  if (!colNames.has('default_base_branch')) db.prepare("ALTER TABLE projects ADD COLUMN default_base_branch TEXT NOT NULL DEFAULT 'main'").run()
  if (!colNames.has('git_enabled')) db.prepare('ALTER TABLE projects ADD COLUMN git_enabled INTEGER NOT NULL DEFAULT 1').run()
}

function migrateWorkshopSessionsTable(db: Database.Database): void {
  const cols = db.pragma('table_info(workshop_sessions)') as { name: string }[]
  const colNames = new Set(cols.map(c => c.name))
  if (!colNames.has('pending_content')) {
    db.prepare('ALTER TABLE workshop_sessions ADD COLUMN pending_content TEXT DEFAULT NULL').run()
  }
  if (!colNames.has('session_type')) {
    db.prepare("ALTER TABLE workshop_sessions ADD COLUMN session_type TEXT NOT NULL DEFAULT 'solo'").run()
  }
  if (!colNames.has('panel_personas')) {
    db.prepare('ALTER TABLE workshop_sessions ADD COLUMN panel_personas TEXT').run()
  }
}

function migrateWorkshopMessagesTable(db: Database.Database): void {
  const cols = db.pragma('table_info(workshop_messages)') as { name: string }[]
  const colNames = new Set(cols.map(c => c.name))
  if (!colNames.has('persona_id')) {
    db.prepare('ALTER TABLE workshop_messages ADD COLUMN persona_id TEXT').run()
  }
  if (!colNames.has('persona_name')) {
    db.prepare('ALTER TABLE workshop_messages ADD COLUMN persona_name TEXT').run()
  }
  if (!colNames.has('round_number')) {
    db.prepare('ALTER TABLE workshop_messages ADD COLUMN round_number INTEGER').run()
  }
}

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
    branchName: row.branch_name,
    worktreePath: row.worktree_path,
    prUrl: row.pr_url,
    handoffs: safeJsonParse(row.handoffs) ?? [],
    agentLog: safeJsonParse(row.agent_log) ?? [],
    todos: safeJsonParse(row.todos) ?? null
  }
}

function rowToWorkshopSession(row: any): WorkshopSession {
  return {
    id: row.id,
    projectId: row.project_id,
    title: row.title,
    summary: row.summary,
    pendingContent: row.pending_content ?? null,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    sessionType: row.session_type as WorkshopSessionType ?? 'solo',
    panelPersonas: row.panel_personas ? JSON.parse(row.panel_personas) : null
  }
}

function rowToWorkshopMessage(row: any): WorkshopMessage {
  return {
    id: row.id,
    sessionId: row.session_id,
    role: row.role,
    content: row.content,
    messageType: row.message_type,
    metadata: safeJsonParse(row.metadata),
    createdAt: row.created_at,
    personaId: row.persona_id || null,
    personaName: row.persona_name || null,
    roundNumber: row.round_number || null
  }
}

function rowToWorkshopArtifact(row: any): WorkshopArtifact {
  return {
    id: row.id,
    projectId: row.project_id,
    name: row.name,
    type: row.type,
    filePath: row.file_path,
    currentVersion: row.current_version,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

function rowToWorkshopTaskLink(row: any): WorkshopTaskLink {
  return {
    id: row.id,
    taskId: row.task_id,
    sessionId: row.session_id,
    artifactId: row.artifact_id,
    createdAt: row.created_at
  }
}

function safeJsonParse(value: string | null): any {
  if (!value) return null
  try { return JSON.parse(value) } catch { return null }
}

function camelToSnake(str: string): string {
  return str.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`)
}
