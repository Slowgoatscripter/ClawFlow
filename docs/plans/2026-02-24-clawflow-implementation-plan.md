# ClawFlow Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build an Electron desktop app that orchestrates an autonomous development pipeline, driving Claude Agent SDK sessions through stages with persistent state, agent handoffs, quality gates, and a kanban dashboard UI.

**Architecture:** Three-layer Electron app — main process (pipeline engine + SDK manager + DB + template engine), preload (typed IPC bridge), renderer (React + Zustand dashboard with kanban board, task detail, and intervention panel). Per-project SQLite databases at `~/.clawflow/dbs/`. Agent templates in `src/templates/` with placeholder filling and handoff protocol injection.

**Tech Stack:** Electron 40, electron-vite, React 19, TypeScript, Zustand, better-sqlite3, TailwindCSS v4, @anthropic-ai/claude-agent-sdk, pnpm

---

## Phase 1: Scaffold + Pipeline Engine + Database

### Task 1: Project Scaffold

**Files:**
- Create: `package.json`
- Create: `electron.vite.config.ts`
- Create: `tsconfig.json`
- Create: `tsconfig.node.json`
- Create: `tsconfig.web.json`
- Create: `.gitignore`
- Create: `src/main/index.ts` (minimal)
- Create: `src/preload/index.ts` (minimal)
- Create: `src/renderer/index.html`
- Create: `src/renderer/src/App.tsx` (minimal)
- Create: `src/renderer/src/main.tsx` (minimal)

**Step 1: Initialize pnpm project**

```bash
cd C:/Users/dutte/OneDrive/Desktop/Projects/ClawFlow
pnpm init
```

**Step 2: Install core dependencies**

```bash
pnpm add electron electron-vite vite react react-dom @anthropic-ai/claude-agent-sdk better-sqlite3 zustand
pnpm add -D typescript @types/react @types/react-dom @types/better-sqlite3 @vitejs/plugin-react tailwindcss @tailwindcss/vite
```

**Step 3: Create electron-vite config**

```typescript
// electron.vite.config.ts
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()]
  },
  preload: {
    plugins: [externalizeDepsPlugin()]
  },
  renderer: {
    plugins: [react(), tailwindcss()]
  }
})
```

**Step 4: Create tsconfig files**

```jsonc
// tsconfig.json
{
  "files": [],
  "references": [
    { "path": "./tsconfig.node.json" },
    { "path": "./tsconfig.web.json" }
  ]
}
```

```jsonc
// tsconfig.node.json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "outDir": "out",
    "declaration": true,
    "composite": true,
    "resolveJsonModule": true,
    "allowSyntheticDefaultImports": true
  },
  "include": ["src/main/**/*", "src/preload/**/*", "src/shared/**/*", "electron.vite.config.ts"]
}
```

```jsonc
// tsconfig.web.json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "jsx": "react-jsx",
    "esModuleInterop": true,
    "outDir": "out",
    "declaration": true,
    "composite": true,
    "resolveJsonModule": true,
    "allowSyntheticDefaultImports": true
  },
  "include": ["src/renderer/**/*", "src/shared/**/*"]
}
```

**Step 5: Create minimal main process**

```typescript
// src/main/index.ts
import { app, BrowserWindow } from 'electron'
import path from 'path'

let mainWindow: BrowserWindow | null = null

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false
    },
    backgroundColor: '#1a1b26',
    titleBarStyle: 'hiddenInset'
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(createWindow)
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
```

**Step 6: Create minimal preload**

```typescript
// src/preload/index.ts
import { contextBridge } from 'electron'

contextBridge.exposeInMainWorld('api', {
  ping: () => 'pong'
})
```

**Step 7: Create minimal renderer**

```html
<!-- src/renderer/index.html -->
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>ClawFlow</title>
</head>
<body>
  <div id="root"></div>
  <script type="module" src="./src/main.tsx"></script>
</body>
</html>
```

```tsx
// src/renderer/src/main.tsx
import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
```

```tsx
// src/renderer/src/App.tsx
export default function App() {
  return <div style={{ color: '#cdd6f4', background: '#1a1b26', height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
    <h1>ClawFlow</h1>
  </div>
}
```

**Step 8: Create .gitignore**

```
node_modules/
out/
dist/
data/
.clawflow/
*.db
*.db-journal
```

**Step 9: Add scripts to package.json**

Add to `package.json`:
```json
{
  "main": "out/main/index.js",
  "scripts": {
    "dev": "electron-vite dev",
    "build": "electron-vite build",
    "preview": "electron-vite preview"
  }
}
```

**Step 10: Verify the app launches**

```bash
cd C:/Users/dutte/OneDrive/Desktop/Projects/ClawFlow
pnpm dev
```

Expected: Electron window opens showing "ClawFlow" centered on a dark background.

**Step 11: Commit**

```bash
git add -A
git commit -m "feat: scaffold Electron + React project with electron-vite"
```

---

### Task 2: Shared Types

**Files:**
- Create: `src/shared/types.ts`

**Step 1: Write the shared types**

```typescript
// src/shared/types.ts

// --- Pipeline ---

export type Tier = 'L1' | 'L2' | 'L3'

export type Priority = 'low' | 'medium' | 'high' | 'critical'

export type TaskStatus =
  | 'backlog'
  | 'brainstorming'
  | 'design_review'
  | 'planning'
  | 'implementing'
  | 'code_review'
  | 'verifying'
  | 'done'
  | 'blocked'

export type PipelineStage =
  | 'brainstorm'
  | 'design_review'
  | 'plan'
  | 'implement'
  | 'code_review'
  | 'verify'
  | 'done'

export type HandoffStatus = 'completed' | 'blocked' | 'needs_intervention'

export interface Handoff {
  stage: PipelineStage
  agent: string
  model: string
  timestamp: string
  status: HandoffStatus
  summary: string
  keyDecisions: string
  openQuestions: string
  filesModified: string
  nextStageNeeds: string
  warnings: string
}

export interface ReviewScore {
  quality: number
  errorHandling: number
  types: number
  security: number
  performance: number
  coverage: number
  average: number
}

export interface TestResults {
  passed: boolean
  lintErrors: number
  buildErrors: number
  testsPassed: number
  testsFailed: number
  details: string
}

export interface AgentLogEntry {
  timestamp: string
  agent: string
  model: string
  action: string
  details: string
}

// --- Task ---

export interface Task {
  id: number
  title: string
  description: string
  tier: Tier
  status: TaskStatus
  priority: Priority
  autoMode: boolean
  createdAt: string
  startedAt: string | null
  completedAt: string | null
  currentAgent: string | null
  brainstormOutput: string | null
  designReview: object | null
  plan: object | null
  planReviewCount: number
  implementationNotes: object | null
  reviewComments: object | null
  reviewScore: number | null
  implReviewCount: number
  testResults: TestResults | null
  verifyResult: string | null
  commitHash: string | null
  handoffs: Handoff[]
  agentLog: AgentLogEntry[]
}

export interface CreateTaskInput {
  title: string
  description: string
  tier: Tier
  priority: Priority
  autoMode?: boolean
}

// --- Project ---

export interface Project {
  name: string
  path: string
  dbPath: string
  createdAt: string
  lastOpened: string
}

export interface ProjectStats {
  backlog: number
  inProgress: number
  done: number
  blocked: number
  completionRate: number
  avgReviewScore: number | null
  circuitBreakerTrips: number
}

// --- Pipeline Config ---

export interface StageConfig {
  stage: PipelineStage
  skill: string
  model: 'claude-opus-4-6' | 'claude-sonnet-4-6'
  maxTurns: number
  pauses: boolean
  autoApproveThreshold: number | null
  template: string
}

// --- IPC ---

export type IpcChannel =
  | 'projects:list'
  | 'projects:register'
  | 'projects:open'
  | 'projects:delete'
  | 'tasks:list'
  | 'tasks:create'
  | 'tasks:get'
  | 'tasks:update'
  | 'tasks:delete'
  | 'pipeline:start'
  | 'pipeline:step'
  | 'pipeline:approve'
  | 'pipeline:reject'
  | 'pipeline:intervene'
  | 'pipeline:stream'
  | 'pipeline:status'
  | 'pipeline:approval-request'

// --- SDK Streaming ---

export interface StreamEvent {
  taskId: number
  agent: string
  type: 'text' | 'tool_use' | 'tool_result' | 'status' | 'error' | 'complete'
  content: string
  timestamp: string
}

export interface ApprovalRequest {
  requestId: string
  taskId: number
  toolUseId: string
  toolName: string
  toolInput: Record<string, unknown>
}
```

**Step 2: Commit**

```bash
git add src/shared/types.ts
git commit -m "feat: add shared TypeScript types for pipeline, tasks, projects, IPC"
```

---

### Task 3: Pipeline Constants & Rules

**Files:**
- Create: `src/shared/constants.ts`
- Create: `src/shared/pipeline-rules.ts`

**Step 1: Write pipeline constants**

```typescript
// src/shared/constants.ts
import type { PipelineStage, StageConfig, Tier } from './types'

export const TIER_STAGES: Record<Tier, PipelineStage[]> = {
  L1: ['plan', 'implement', 'done'],
  L2: ['brainstorm', 'plan', 'implement', 'verify', 'done'],
  L3: ['brainstorm', 'design_review', 'plan', 'implement', 'code_review', 'verify', 'done']
}

export const STAGE_CONFIGS: Record<PipelineStage, StageConfig> = {
  brainstorm: {
    stage: 'brainstorm',
    skill: 'brainstorming',
    model: 'claude-opus-4-6',
    maxTurns: 50,
    pauses: true,
    autoApproveThreshold: null,
    template: 'brainstorm-agent.md'
  },
  design_review: {
    stage: 'design_review',
    skill: 'design-review',
    model: 'claude-opus-4-6',
    maxTurns: 40,
    pauses: true,
    autoApproveThreshold: null,
    template: 'design-review-agent.md'
  },
  plan: {
    stage: 'plan',
    skill: 'writing-plans',
    model: 'claude-opus-4-6',
    maxTurns: 30,
    pauses: true,
    autoApproveThreshold: 4.0,
    template: 'plan-agent.md'
  },
  implement: {
    stage: 'implement',
    skill: 'test-driven-development',
    model: 'claude-opus-4-6',
    maxTurns: 100,
    pauses: false,
    autoApproveThreshold: null,
    template: 'implement-agent.md'
  },
  code_review: {
    stage: 'code_review',
    skill: 'requesting-code-review',
    model: 'claude-sonnet-4-6',
    maxTurns: 20,
    pauses: true,
    autoApproveThreshold: 4.0,
    template: 'code-review-agent.md'
  },
  verify: {
    stage: 'verify',
    skill: 'verification-before-completion',
    model: 'claude-sonnet-4-6',
    maxTurns: 15,
    pauses: false,
    autoApproveThreshold: null,
    template: 'verify-agent.md'
  },
  done: {
    stage: 'done',
    skill: 'finishing-a-development-branch',
    model: 'claude-sonnet-4-6',
    maxTurns: 10,
    pauses: true,
    autoApproveThreshold: null,
    template: 'completion-agent.md'
  }
}

export const CIRCUIT_BREAKER_LIMIT = 3

export const STATUS_TO_STAGE: Record<string, PipelineStage> = {
  brainstorming: 'brainstorm',
  design_review: 'design_review',
  planning: 'plan',
  implementing: 'implement',
  code_review: 'code_review',
  verifying: 'verify',
  done: 'done'
}

export const STAGE_TO_STATUS: Record<PipelineStage, string> = {
  brainstorm: 'brainstorming',
  design_review: 'design_review',
  plan: 'planning',
  implement: 'implementing',
  code_review: 'code_review',
  verify: 'verifying',
  done: 'done'
}
```

**Step 2: Write pipeline transition rules**

```typescript
// src/shared/pipeline-rules.ts
import type { PipelineStage, Task, Tier } from './types'
import { TIER_STAGES, CIRCUIT_BREAKER_LIMIT } from './constants'

export interface TransitionResult {
  allowed: boolean
  nextStage: PipelineStage | null
  reason: string
}

export function getNextStage(tier: Tier, currentStage: PipelineStage): PipelineStage | null {
  const stages = TIER_STAGES[tier]
  const currentIndex = stages.indexOf(currentStage)
  if (currentIndex === -1 || currentIndex === stages.length - 1) return null
  return stages[currentIndex + 1]
}

export function getFirstStage(tier: Tier): PipelineStage {
  return TIER_STAGES[tier][0]
}

export function canTransition(task: Task, targetStage: PipelineStage): TransitionResult {
  const stages = TIER_STAGES[task.tier]

  if (!stages.includes(targetStage)) {
    return { allowed: false, nextStage: null, reason: `Stage ${targetStage} is not part of tier ${task.tier}` }
  }

  // Check circuit breakers
  if (targetStage === 'plan' && task.planReviewCount >= CIRCUIT_BREAKER_LIMIT) {
    return { allowed: false, nextStage: null, reason: `Circuit breaker: plan rejected ${task.planReviewCount} times` }
  }
  if (targetStage === 'implement' && task.implReviewCount >= CIRCUIT_BREAKER_LIMIT) {
    return { allowed: false, nextStage: null, reason: `Circuit breaker: implementation rejected ${task.implReviewCount} times` }
  }

  return { allowed: true, nextStage: targetStage, reason: 'ok' }
}

export function shouldAutoApprove(stage: PipelineStage, score: number | null, autoMode: boolean): boolean {
  if (!autoMode) return false
  if (score === null) return false

  const thresholds: Partial<Record<PipelineStage, number>> = {
    plan: 4.0,
    code_review: 4.0
  }

  const threshold = thresholds[stage]
  if (!threshold) return false
  return score >= threshold
}

export function isCircuitBreakerTripped(task: Task): boolean {
  return task.planReviewCount >= CIRCUIT_BREAKER_LIMIT || task.implReviewCount >= CIRCUIT_BREAKER_LIMIT
}
```

**Step 3: Commit**

```bash
git add src/shared/constants.ts src/shared/pipeline-rules.ts
git commit -m "feat: add pipeline constants, stage configs, and transition rules"
```

---

### Task 4: Database Layer

**Files:**
- Create: `src/main/db.ts`

**Step 1: Write the database manager**

```typescript
// src/main/db.ts
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

  // Initialize project DB
  initProjectDb(dbPath)

  // Write project config into project directory
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
```

**Step 2: Commit**

```bash
git add src/main/db.ts
git commit -m "feat: add database layer with project registry and per-project task storage"
```

---

### Task 5: Template Engine

**Files:**
- Create: `src/main/template-engine.ts`
- Create: `src/templates/_handoff.md`

**Step 1: Write the handoff protocol template**

```markdown
<!-- src/templates/_handoff.md -->

## Handoff Protocol (MANDATORY)

Before completing your work, you MUST produce a HANDOFF block in this exact format. This is parsed by ClawFlow to coordinate the pipeline. Do not skip or modify the format.

### HANDOFF
- **Status**: [completed | blocked | needs_intervention]
- **Summary**: [2-3 sentence summary of what you did]
- **Key Decisions**: [decisions made and why]
- **Open Questions**: [anything unresolved, or "none"]
- **Files Modified**: [list of files touched, or "none"]
- **Next Stage Needs**: [what the next agent needs to know]
- **Warnings**: [gotchas, risks, or concerns for downstream agents]
```

**Step 2: Write the template engine**

```typescript
// src/main/template-engine.ts
import fs from 'fs'
import path from 'path'
import type { Task, Handoff } from '../shared/types'
import type { PipelineStage } from '../shared/types'
import { STAGE_CONFIGS } from '../shared/constants'

const TEMPLATES_DIR = path.join(__dirname, '../../src/templates')

export function loadTemplate(stage: PipelineStage): string {
  const config = STAGE_CONFIGS[stage]
  const templatePath = path.join(TEMPLATES_DIR, config.template)

  if (!fs.existsSync(templatePath)) {
    throw new Error(`Template not found: ${templatePath}`)
  }

  let template = fs.readFileSync(templatePath, 'utf-8')

  // Append handoff protocol
  const handoffPath = path.join(TEMPLATES_DIR, '_handoff.md')
  if (fs.existsSync(handoffPath)) {
    template += '\n\n' + fs.readFileSync(handoffPath, 'utf-8')
  }

  return template
}

export function fillTemplate(template: string, task: Task): string {
  const replacements: Record<string, string> = {
    '{{title}}': task.title,
    '{{description}}': task.description,
    '{{tier}}': task.tier,
    '{{priority}}': task.priority,
    '{{timestamp}}': new Date().toISOString(),
    '{{brainstorm_output}}': task.brainstormOutput ?? 'N/A',
    '{{design_review}}': task.designReview ? JSON.stringify(task.designReview, null, 2) : 'N/A',
    '{{plan}}': task.plan ? JSON.stringify(task.plan, null, 2) : 'N/A',
    '{{implementation_notes}}': task.implementationNotes ? JSON.stringify(task.implementationNotes, null, 2) : 'N/A',
    '{{review_comments}}': task.reviewComments ? JSON.stringify(task.reviewComments, null, 2) : 'N/A',
    '{{review_score}}': task.reviewScore?.toString() ?? 'N/A',
    '{{test_results}}': task.testResults ? JSON.stringify(task.testResults, null, 2) : 'N/A',
    '{{verify_result}}': task.verifyResult ?? 'N/A',
    '{{previous_handoff}}': formatPreviousHandoff(task.handoffs),
    '{{handoff_chain}}': formatHandoffChain(task.handoffs)
  }

  let filled = template
  for (const [placeholder, value] of Object.entries(replacements)) {
    filled = filled.replaceAll(placeholder, value)
  }
  return filled
}

export function constructPrompt(stage: PipelineStage, task: Task): string {
  const template = loadTemplate(stage)
  return fillTemplate(template, task)
}

export function parseHandoff(output: string): Partial<Handoff> | null {
  const handoffMatch = output.match(/### HANDOFF\s*\n([\s\S]*?)(?=\n###\s|\n##\s|$)/)
  if (!handoffMatch) return null

  const block = handoffMatch[1]

  const extract = (label: string): string => {
    const match = block.match(new RegExp(`-\\s*\\*\\*${label}\\*\\*:\\s*(.+)`, 'i'))
    return match ? match[1].trim() : ''
  }

  return {
    status: extract('Status') as Handoff['status'] || 'completed',
    summary: extract('Summary'),
    keyDecisions: extract('Key Decisions'),
    openQuestions: extract('Open Questions'),
    filesModified: extract('Files Modified'),
    nextStageNeeds: extract('Next Stage Needs'),
    warnings: extract('Warnings')
  }
}

function formatPreviousHandoff(handoffs: Handoff[]): string {
  if (handoffs.length === 0) return 'No previous stages.'
  const last = handoffs[handoffs.length - 1]
  return [
    `> **${last.agent}** \`${last.model}\` · ${last.timestamp}`,
    `- **Status**: ${last.status}`,
    `- **Summary**: ${last.summary}`,
    `- **Key Decisions**: ${last.keyDecisions}`,
    `- **Open Questions**: ${last.openQuestions}`,
    `- **Files Modified**: ${last.filesModified}`,
    `- **Next Stage Needs**: ${last.nextStageNeeds}`,
    `- **Warnings**: ${last.warnings}`
  ].join('\n')
}

function formatHandoffChain(handoffs: Handoff[]): string {
  if (handoffs.length === 0) return 'No handoff history.'
  return handoffs.map((h, i) =>
    `**Stage ${i + 1}: ${h.stage}** (${h.agent})\n${h.summary}`
  ).join('\n\n')
}
```

**Step 3: Commit**

```bash
git add src/main/template-engine.ts src/templates/_handoff.md
git commit -m "feat: add template engine with placeholder filling and handoff parsing"
```

---

### Task 6: Pipeline Engine

**Files:**
- Create: `src/main/pipeline-engine.ts`

**Step 1: Write the pipeline engine**

```typescript
// src/main/pipeline-engine.ts
import type { Task, PipelineStage, Handoff, AgentLogEntry } from '../shared/types'
import { STAGE_CONFIGS, TIER_STAGES, STAGE_TO_STATUS } from '../shared/constants'
import { getNextStage, getFirstStage, canTransition, isCircuitBreakerTripped } from '../shared/pipeline-rules'
import { getTask, updateTask, appendAgentLog, appendHandoff } from './db'
import { constructPrompt, parseHandoff } from './template-engine'
import { EventEmitter } from 'events'

export interface PipelineEvents {
  'stage:start': { taskId: number; stage: PipelineStage; agent: string }
  'stage:complete': { taskId: number; stage: PipelineStage; result: string }
  'stage:pause': { taskId: number; stage: PipelineStage; reason: string }
  'stage:error': { taskId: number; stage: PipelineStage; error: string }
  'circuit-breaker': { taskId: number; stage: PipelineStage; count: number }
  'stream': { taskId: number; agent: string; content: string; type: string }
  'approval-request': { taskId: number; requestId: string; toolName: string; toolInput: Record<string, unknown> }
}

export class PipelineEngine extends EventEmitter {
  private dbPath: string
  private projectPath: string
  private runSdkSession: SdkRunner | null = null

  constructor(dbPath: string, projectPath: string) {
    super()
    this.dbPath = dbPath
    this.projectPath = projectPath
  }

  setSdkRunner(runner: SdkRunner) {
    this.runSdkSession = runner
  }

  async startTask(taskId: number): Promise<void> {
    const task = getTask(this.dbPath, taskId)
    if (!task) throw new Error(`Task ${taskId} not found`)
    if (task.status !== 'backlog') throw new Error(`Task ${taskId} is not in backlog (status: ${task.status})`)

    const firstStage = getFirstStage(task.tier)
    const status = STAGE_TO_STATUS[firstStage]

    updateTask(this.dbPath, taskId, {
      status,
      startedAt: new Date().toISOString()
    })

    await this.runStage(taskId, firstStage)
  }

  async stepTask(taskId: number): Promise<void> {
    const task = getTask(this.dbPath, taskId)
    if (!task) throw new Error(`Task ${taskId} not found`)

    const currentStage = Object.entries(STAGE_TO_STATUS)
      .find(([, status]) => status === task.status)?.[0] as PipelineStage | undefined

    if (!currentStage) throw new Error(`Task ${taskId} has invalid status: ${task.status}`)
    if (currentStage === 'done') throw new Error(`Task ${taskId} is already done`)

    await this.runStage(taskId, currentStage)
  }

  async runFullPipeline(taskId: number): Promise<void> {
    const task = getTask(this.dbPath, taskId)
    if (!task) throw new Error(`Task ${taskId} not found`)

    if (task.status === 'backlog') {
      await this.startTask(taskId)
    }

    let currentTask = getTask(this.dbPath, taskId)!

    while (currentTask.status !== 'done' && currentTask.status !== 'blocked') {
      const currentStage = Object.entries(STAGE_TO_STATUS)
        .find(([, status]) => status === currentTask.status)?.[0] as PipelineStage | undefined

      if (!currentStage || currentStage === 'done') break

      const config = STAGE_CONFIGS[currentStage]

      // Check if this stage pauses and we're not in auto mode
      if (config.pauses && !currentTask.autoMode) {
        this.emit('stage:pause', {
          taskId,
          stage: currentStage,
          reason: `Stage ${currentStage} requires approval`
        })
        return // Pause — UI will call approve/reject to continue
      }

      await this.runStage(taskId, currentStage)

      // Refresh task state
      currentTask = getTask(this.dbPath, taskId)!

      // Check for circuit breaker
      if (isCircuitBreakerTripped(currentTask)) {
        updateTask(this.dbPath, taskId, { status: 'blocked' })
        this.emit('circuit-breaker', {
          taskId,
          stage: currentStage,
          count: Math.max(currentTask.planReviewCount, currentTask.implReviewCount)
        })
        return
      }
    }
  }

  async approveStage(taskId: number): Promise<void> {
    const task = getTask(this.dbPath, taskId)
    if (!task) throw new Error(`Task ${taskId} not found`)

    const currentStage = Object.entries(STAGE_TO_STATUS)
      .find(([, status]) => status === task.status)?.[0] as PipelineStage | undefined

    if (!currentStage) return

    const nextStage = getNextStage(task.tier, currentStage)
    if (!nextStage) {
      updateTask(this.dbPath, taskId, { status: 'done', completedAt: new Date().toISOString() })
      return
    }

    const transition = canTransition(task, nextStage)
    if (!transition.allowed) {
      this.emit('stage:error', { taskId, stage: currentStage, error: transition.reason })
      return
    }

    updateTask(this.dbPath, taskId, { status: STAGE_TO_STATUS[nextStage] })

    if (task.autoMode) {
      await this.runFullPipeline(taskId)
    }
  }

  async rejectStage(taskId: number, feedback: string): Promise<void> {
    const task = getTask(this.dbPath, taskId)
    if (!task) throw new Error(`Task ${taskId} not found`)

    const currentStage = Object.entries(STAGE_TO_STATUS)
      .find(([, status]) => status === task.status)?.[0] as PipelineStage | undefined

    if (!currentStage) return

    // Increment rejection counter
    if (currentStage === 'plan' || currentStage === 'design_review') {
      updateTask(this.dbPath, taskId, { planReviewCount: task.planReviewCount + 1 })
    } else if (currentStage === 'code_review') {
      updateTask(this.dbPath, taskId, { implReviewCount: task.implReviewCount + 1 })
    }

    appendAgentLog(this.dbPath, taskId, {
      timestamp: new Date().toISOString(),
      agent: 'human',
      model: 'human',
      action: 'reject',
      details: feedback
    })

    // Re-run the stage with feedback
    await this.runStage(taskId, currentStage, feedback)
  }

  private async runStage(taskId: number, stage: PipelineStage, feedback?: string): Promise<void> {
    if (!this.runSdkSession) throw new Error('SDK runner not configured')

    const task = getTask(this.dbPath, taskId)
    if (!task) throw new Error(`Task ${taskId} not found`)

    const config = STAGE_CONFIGS[stage]
    let prompt = constructPrompt(stage, task)

    if (feedback) {
      prompt += `\n\n## Human Feedback\n\n${feedback}`
    }

    updateTask(this.dbPath, taskId, { currentAgent: config.skill })

    this.emit('stage:start', { taskId, stage, agent: config.skill })

    appendAgentLog(this.dbPath, taskId, {
      timestamp: new Date().toISOString(),
      agent: config.skill,
      model: config.model,
      action: 'stage_start',
      details: `Starting ${stage}`
    })

    try {
      const result = await this.runSdkSession({
        prompt,
        model: config.model,
        maxTurns: config.maxTurns,
        cwd: this.projectPath,
        taskId,
        autoMode: task.autoMode,
        onStream: (content, type) => {
          this.emit('stream', { taskId, agent: config.skill, content, type })
        },
        onApprovalRequest: (requestId, toolName, toolInput) => {
          this.emit('approval-request', { taskId, requestId, toolName, toolInput })
        }
      })

      // Parse handoff from result
      const handoffData = parseHandoff(result.output)
      if (handoffData) {
        const handoff: Handoff = {
          stage,
          agent: config.skill,
          model: config.model,
          timestamp: new Date().toISOString(),
          status: handoffData.status ?? 'completed',
          summary: handoffData.summary ?? '',
          keyDecisions: handoffData.keyDecisions ?? '',
          openQuestions: handoffData.openQuestions ?? '',
          filesModified: handoffData.filesModified ?? '',
          nextStageNeeds: handoffData.nextStageNeeds ?? '',
          warnings: handoffData.warnings ?? ''
        }
        appendHandoff(this.dbPath, taskId, handoff)

        // Check handoff status
        if (handoff.status === 'blocked') {
          updateTask(this.dbPath, taskId, { status: 'blocked' })
          this.emit('stage:pause', { taskId, stage, reason: `Agent reported blocked: ${handoff.summary}` })
          return
        }

        if (handoff.status === 'needs_intervention' || (handoff.openQuestions && handoff.openQuestions !== 'none')) {
          this.emit('stage:pause', { taskId, stage, reason: `Agent needs intervention: ${handoff.openQuestions}` })
          return
        }
      }

      // Store stage-specific output
      this.storeStageOutput(taskId, stage, result)

      appendAgentLog(this.dbPath, taskId, {
        timestamp: new Date().toISOString(),
        agent: config.skill,
        model: config.model,
        action: 'stage_complete',
        details: `Completed ${stage}. Cost: $${result.cost.toFixed(4)}`
      })

      this.emit('stage:complete', { taskId, stage, result: result.output })

      // Auto-advance if stage doesn't pause
      if (!config.pauses || task.autoMode) {
        const nextStage = getNextStage(task.tier, stage)
        if (nextStage) {
          const transition = canTransition(getTask(this.dbPath, taskId)!, nextStage)
          if (transition.allowed) {
            updateTask(this.dbPath, taskId, { status: STAGE_TO_STATUS[nextStage] })
          }
        } else {
          updateTask(this.dbPath, taskId, { status: 'done', completedAt: new Date().toISOString() })
        }
      }
    } catch (error: any) {
      appendAgentLog(this.dbPath, taskId, {
        timestamp: new Date().toISOString(),
        agent: config.skill,
        model: config.model,
        action: 'stage_error',
        details: error.message
      })
      this.emit('stage:error', { taskId, stage, error: error.message })
    } finally {
      updateTask(this.dbPath, taskId, { currentAgent: null })
    }
  }

  private storeStageOutput(taskId: number, stage: PipelineStage, result: SdkResult): void {
    const updates: Record<string, any> = {}

    switch (stage) {
      case 'brainstorm':
        updates.brainstormOutput = result.output
        break
      case 'design_review':
        updates.designReview = { verdict: 'pending_parse', raw: result.output }
        break
      case 'plan':
        updates.plan = { raw: result.output }
        break
      case 'implement':
        updates.implementationNotes = { raw: result.output }
        break
      case 'code_review':
        updates.reviewComments = { raw: result.output }
        break
      case 'verify':
        updates.verifyResult = result.output
        break
    }

    if (Object.keys(updates).length > 0) {
      updateTask(this.dbPath, taskId, updates)
    }
  }
}

// --- Types for SDK integration (implemented in sdk-manager.ts) ---

export interface SdkRunnerParams {
  prompt: string
  model: string
  maxTurns: number
  cwd: string
  taskId: number
  autoMode: boolean
  onStream: (content: string, type: string) => void
  onApprovalRequest: (requestId: string, toolName: string, toolInput: Record<string, unknown>) => void
}

export interface SdkResult {
  output: string
  cost: number
  turns: number
  sessionId: string
}

export type SdkRunner = (params: SdkRunnerParams) => Promise<SdkResult>
```

**Step 2: Commit**

```bash
git add src/main/pipeline-engine.ts
git commit -m "feat: add pipeline engine with state machine, circuit breakers, and stage orchestration"
```

---

### Task 7: Agent Templates (Initial Set)

**Files:**
- Create: `src/templates/brainstorm-agent.md`
- Create: `src/templates/plan-agent.md`
- Create: `src/templates/implement-agent.md`
- Create: `src/templates/code-review-agent.md`
- Create: `src/templates/verify-agent.md`
- Create: `src/templates/completion-agent.md`

**Step 1: Write all six templates**

Each template follows the same structure: identity, skill instruction, task context, previous handoff, output format. See the design document's SDK Integration section for the exact template format with `{{placeholder}}` slots.

**brainstorm-agent.md** — Invokes `brainstorming` skill, receives task title/description, outputs design doc.

**plan-agent.md** — Invokes `writing-plans` skill, receives brainstorm output + design review, outputs numbered task breakdown.

**implement-agent.md** — Invokes `test-driven-development` + `subagent-driven-development`, receives plan, outputs implementation notes. Rules: touch only what plan requires, TDD, frequent commits.

**code-review-agent.md** — Invokes `requesting-code-review`, receives implementation notes + plan, scores 6 dimensions (quality, error handling, types, security, performance, coverage), outputs JSON verdict with auto-approve/reject thresholds.

**verify-agent.md** — Invokes `verification-before-completion`, receives implementation notes + test results, runs actual commands, outputs JSON pass/fail with counts.

**completion-agent.md** — Invokes `finishing-a-development-branch`, receives verify result + handoff chain, ensures commits, records hash, presents integration options.

**Step 2: Commit**

```bash
git add src/templates/
git commit -m "feat: add all six agent templates with skill instructions and handoff protocol"
```

---

### Task 8: Phase 1 Integration — Wire DB + Engine into Main Process

**Files:**
- Modify: `src/main/index.ts`
- Create: `src/main/ipc-handlers.ts`
- Modify: `src/preload/index.ts`

**Step 1: Write IPC handlers**

```typescript
// src/main/ipc-handlers.ts
import { ipcMain, dialog } from 'electron'
import {
  listProjects, registerProject, openProject, deleteProject,
  listTasks, createTask, getTask, updateTask, deleteTask,
  getProjectStats
} from './db'
import type { CreateTaskInput } from '../shared/types'

export function registerIpcHandlers() {
  // --- Projects ---
  ipcMain.handle('projects:list', () => listProjects())
  ipcMain.handle('projects:register', (_e, name: string, projectPath: string) => registerProject(name, projectPath))
  ipcMain.handle('projects:open', (_e, name: string) => { openProject(name); return true })
  ipcMain.handle('projects:delete', (_e, name: string) => { deleteProject(name); return true })

  // --- Tasks ---
  ipcMain.handle('tasks:list', (_e, dbPath: string) => listTasks(dbPath))
  ipcMain.handle('tasks:create', (_e, dbPath: string, input: CreateTaskInput) => createTask(dbPath, input))
  ipcMain.handle('tasks:get', (_e, dbPath: string, taskId: number) => getTask(dbPath, taskId))
  ipcMain.handle('tasks:update', (_e, dbPath: string, taskId: number, updates: Record<string, any>) => updateTask(dbPath, taskId, updates))
  ipcMain.handle('tasks:delete', (_e, dbPath: string, taskId: number) => { deleteTask(dbPath, taskId); return true })
  ipcMain.handle('tasks:stats', (_e, dbPath: string) => getProjectStats(dbPath))

  // --- Filesystem ---
  ipcMain.handle('fs:pick-directory', async () => {
    const result = await dialog.showOpenDialog({ properties: ['openDirectory'] })
    return result.canceled ? null : result.filePaths[0]
  })
}
```

**Step 2: Update main process to register handlers**

Add `import { registerIpcHandlers } from './ipc-handlers'` and call `registerIpcHandlers()` inside `app.whenReady().then(...)`.

**Step 3: Update preload to expose IPC**

```typescript
// src/preload/index.ts
import { contextBridge, ipcRenderer } from 'electron'
import type { CreateTaskInput } from '../shared/types'

contextBridge.exposeInMainWorld('api', {
  projects: {
    list: () => ipcRenderer.invoke('projects:list'),
    register: (name: string, path: string) => ipcRenderer.invoke('projects:register', name, path),
    open: (name: string) => ipcRenderer.invoke('projects:open', name),
    delete: (name: string) => ipcRenderer.invoke('projects:delete', name)
  },
  tasks: {
    list: (dbPath: string) => ipcRenderer.invoke('tasks:list', dbPath),
    create: (dbPath: string, input: CreateTaskInput) => ipcRenderer.invoke('tasks:create', dbPath, input),
    get: (dbPath: string, taskId: number) => ipcRenderer.invoke('tasks:get', dbPath, taskId),
    update: (dbPath: string, taskId: number, updates: Record<string, any>) => ipcRenderer.invoke('tasks:update', dbPath, taskId, updates),
    delete: (dbPath: string, taskId: number) => ipcRenderer.invoke('tasks:delete', dbPath, taskId),
    stats: (dbPath: string) => ipcRenderer.invoke('tasks:stats', dbPath)
  },
  pipeline: {
    start: (taskId: number) => ipcRenderer.invoke('pipeline:start', taskId),
    step: (taskId: number) => ipcRenderer.invoke('pipeline:step', taskId),
    approve: (taskId: number) => ipcRenderer.invoke('pipeline:approve', taskId),
    reject: (taskId: number, feedback: string) => ipcRenderer.invoke('pipeline:reject', taskId, feedback),
    resolveApproval: (requestId: string, approved: boolean, message?: string) =>
      ipcRenderer.invoke('pipeline:resolve-approval', requestId, approved, message),
    onStream: (callback: (event: any) => void) => {
      ipcRenderer.on('pipeline:stream', (_e, data) => callback(data))
      return () => ipcRenderer.removeAllListeners('pipeline:stream')
    },
    onApprovalRequest: (callback: (event: any) => void) => {
      ipcRenderer.on('pipeline:approval-request', (_e, data) => callback(data))
      return () => ipcRenderer.removeAllListeners('pipeline:approval-request')
    },
    onStatusChange: (callback: (event: any) => void) => {
      ipcRenderer.on('pipeline:status', (_e, data) => callback(data))
      return () => ipcRenderer.removeAllListeners('pipeline:status')
    }
  },
  fs: {
    pickDirectory: () => ipcRenderer.invoke('fs:pick-directory')
  }
})
```

**Step 4: Verify build compiles**

```bash
pnpm build
```

Expected: Build succeeds with no TypeScript errors.

**Step 5: Commit**

```bash
git add -A
git commit -m "feat: wire IPC handlers for projects, tasks, and pipeline into Electron main"
```

---

## Phase 2: Electron Shell + Dashboard + Kanban Board

### Task 9: Theme & Base Styles

**Files:**
- Create: `src/renderer/src/theme.ts`
- Create: `src/renderer/src/index.css`

**Step 1: Write theme tokens**

```typescript
// src/renderer/src/theme.ts
export const colors = {
  bg: '#1a1b26',
  surface: '#24273a',
  elevated: '#2a2d3d',
  border: '#363a4f',
  text: {
    primary: '#cdd6f4',
    secondary: '#a6adc8',
    muted: '#6c7086'
  },
  accent: {
    teal: '#89b4fa',
    gold: '#f9e2af',
    green: '#a6e3a1',
    red: '#f38ba8',
    peach: '#fab387',
    mauve: '#cba6f7'
  },
  tier: { L1: '#a6e3a1', L2: '#89b4fa', L3: '#cba6f7' },
  priority: { low: '#6c7086', medium: '#89b4fa', high: '#fab387', critical: '#f38ba8' },
  status: {
    backlog: '#6c7086', brainstorming: '#cba6f7', design_review: '#f9e2af',
    planning: '#89b4fa', implementing: '#fab387', code_review: '#f9e2af',
    verifying: '#a6e3a1', done: '#a6e3a1', blocked: '#f38ba8'
  }
} as const

export const fonts = {
  ui: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
  mono: "'JetBrains Mono', 'Fira Code', monospace"
} as const
```

**Step 2: Write base CSS with TailwindCSS v4 theme**

```css
/* src/renderer/src/index.css */
@import "tailwindcss";

@theme {
  --color-bg: #1a1b26;
  --color-surface: #24273a;
  --color-elevated: #2a2d3d;
  --color-border: #363a4f;
  --color-text-primary: #cdd6f4;
  --color-text-secondary: #a6adc8;
  --color-text-muted: #6c7086;
  --color-accent-teal: #89b4fa;
  --color-accent-gold: #f9e2af;
  --color-accent-green: #a6e3a1;
  --color-accent-red: #f38ba8;
  --color-accent-peach: #fab387;
  --color-accent-mauve: #cba6f7;
  --font-family-ui: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
  --font-family-mono: 'JetBrains Mono', 'Fira Code', monospace;
}

body {
  margin: 0;
  background-color: var(--color-bg);
  color: var(--color-text-primary);
  font-family: var(--font-family-ui);
  -webkit-font-smoothing: antialiased;
}

::-webkit-scrollbar { width: 6px; height: 6px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: var(--color-border); border-radius: 3px; }
::-webkit-scrollbar-thumb:hover { background: var(--color-text-muted); }
```

**Step 3: Import CSS in main.tsx**

Add `import './index.css'` to `src/renderer/src/main.tsx`.

**Step 4: Commit**

```bash
git add src/renderer/src/theme.ts src/renderer/src/index.css src/renderer/src/main.tsx
git commit -m "feat: add Tokyo Night theme tokens and base TailwindCSS styles"
```

---

### Task 10: Zustand Stores

**Files:**
- Create: `src/renderer/src/stores/projectStore.ts`
- Create: `src/renderer/src/stores/taskStore.ts`
- Create: `src/renderer/src/stores/pipelineStore.ts`
- Create: `src/renderer/src/stores/layoutStore.ts`

**Step 1: Write all four stores**

- **projectStore**: projects list, currentProject, stats, CRUD operations via `window.api.projects.*`
- **taskStore**: tasks list, selectedTaskId, filter, CRUD operations via `window.api.tasks.*`, `getTasksByStatus()` helper
- **pipelineStore**: activeTaskId, streaming state, streamEvents array, approvalRequest, pipeline control methods (start/step/approve/reject), IPC event listeners
- **layoutStore**: current view (`projects | dashboard | task-detail`), activityFeedOpen toggle

**Step 2: Commit**

```bash
git add src/renderer/src/stores/
git commit -m "feat: add Zustand stores for projects, tasks, pipeline, and layout"
```

---

### Task 11: Project Selector Screen

**Files:**
- Create: `src/renderer/src/components/ProjectSelector/ProjectSelector.tsx`
- Create: `src/renderer/src/components/ProjectSelector/ProjectCard.tsx`
- Create: `src/renderer/src/components/ProjectSelector/RegisterProjectModal.tsx`
- Modify: `src/renderer/src/App.tsx`

**Step 1: Build ProjectCard, RegisterProjectModal, and ProjectSelector components**

**Step 2: Wire into App.tsx with view routing based on layoutStore.view**

**Step 3: Verify the project selector renders**

```bash
pnpm dev
```

Expected: App shows "ClawFlow" header, empty project list, "Register Project" button opens folder picker.

**Step 4: Commit**

```bash
git add -A
git commit -m "feat: add project selector screen with register project flow"
```

---

### Task 12: Dashboard Shell & Metrics Row

**Files:**
- Create: `src/renderer/src/components/Dashboard/Dashboard.tsx`
- Create: `src/renderer/src/components/Dashboard/TopBar.tsx`
- Create: `src/renderer/src/components/Dashboard/MetricsRow.tsx`
- Modify: `src/renderer/src/App.tsx`

**Step 1: Build TopBar, MetricsRow, Dashboard shell**

**Step 2: Wire into App.tsx view routing**

**Step 3: Verify dashboard renders with metrics after selecting a project**

```bash
pnpm dev
```

**Step 4: Commit**

```bash
git add -A
git commit -m "feat: add dashboard shell with top bar and metrics row"
```

---

### Task 13: Kanban Board

**Files:**
- Create: `src/renderer/src/components/KanbanBoard/KanbanBoard.tsx`
- Create: `src/renderer/src/components/KanbanBoard/KanbanColumn.tsx`
- Create: `src/renderer/src/components/KanbanBoard/TaskCard.tsx`
- Modify: `src/renderer/src/components/Dashboard/Dashboard.tsx`

**Step 1: Build TaskCard (title, tier badge, priority color, agent indicator, time-in-stage)**

**Step 2: Build KanbanColumn (header with count, scrollable task list)**

**Step 3: Build KanbanBoard (columns for all statuses)**

**Step 4: Integrate into Dashboard**

**Step 5: Verify board renders with columns, test task creation**

```bash
pnpm dev
```

**Step 6: Commit**

```bash
git add -A
git commit -m "feat: add kanban board with columns and task cards"
```

---

### Task 14: Create Task Modal

**Files:**
- Create: `src/renderer/src/components/common/Modal.tsx`
- Create: `src/renderer/src/components/Dashboard/CreateTaskModal.tsx`
- Modify: `src/renderer/src/components/Dashboard/TopBar.tsx`

**Step 1: Build Modal and CreateTaskModal (title, description, tier, priority, auto mode)**

**Step 2: Wire "+" button in TopBar**

**Step 3: Verify task creation flow**

```bash
pnpm dev
```

**Step 4: Commit**

```bash
git add -A
git commit -m "feat: add create task modal with tier, priority, and auto mode options"
```

---

### Task 15: Task Detail View

**Files:**
- Create: `src/renderer/src/components/TaskDetail/TaskDetail.tsx`
- Create: `src/renderer/src/components/TaskDetail/TaskTimeline.tsx`
- Create: `src/renderer/src/components/TaskDetail/StageTabs.tsx`
- Create: `src/renderer/src/components/TaskDetail/HandoffChain.tsx`
- Create: `src/renderer/src/components/TaskDetail/AgentLog.tsx`
- Modify: `src/renderer/src/App.tsx`

**Step 1: Build TaskTimeline (horizontal progress bar with stages)**

**Step 2: Build StageTabs (tab bar for completed stages with output display)**

**Step 3: Build HandoffChain (collapsible accordion of handoffs)**

**Step 4: Build AgentLog (scrollable, searchable audit trail)**

**Step 5: Build TaskDetail composing all sub-components**

**Step 6: Wire into App.tsx — clicking TaskCard navigates to detail view**

**Step 7: Verify task detail renders**

```bash
pnpm dev
```

**Step 8: Commit**

```bash
git add -A
git commit -m "feat: add task detail view with timeline, stage tabs, handoff chain, and agent log"
```

---

## Phase 3: SDK Integration + Handoff Protocol

### Task 16: SDK Manager

**Files:**
- Create: `src/main/sdk-manager.ts`
- Modify: `src/main/index.ts`

**Step 1: Write the SDK manager**

The SDK manager wraps `query()` from `@anthropic-ai/claude-agent-sdk`. Key responsibilities:
- Launch SDK sessions with constructed prompts, model, maxTurns, cwd
- Stream responses via IPC to the renderer
- Route tool approval requests to the UI (auto-approve reads, defer writes to UI)
- Handle `bypassPermissions` mode for auto tasks
- Parse result messages for cost and turn count
- Manage pending approval promises with `resolveApproval()`

Use the `query()` API (stable V1, not the alpha V2 `SDKSession`). Pattern:

```typescript
const q = query({ prompt, options: { cwd, model, maxTurns, abortController, ... } })
for await (const message of q) { /* handle each SDKMessage */ }
```

**Step 2: Wire into main process — create engine per project, set SDK runner**

**Step 3: Verify build compiles**

```bash
pnpm build
```

**Step 4: Commit**

```bash
git add -A
git commit -m "feat: add SDK manager with streaming, tool approval routing, and session management"
```

---

### Task 17: Pipeline IPC Handlers

**Files:**
- Modify: `src/main/ipc-handlers.ts`
- Modify: `src/main/index.ts`

**Step 1: Add pipeline IPC handlers (start, step, approve, reject, resolve-approval)**

**Step 2: Update main process to create engine per project with SDK runner**

**Step 3: Add approval resolution to preload**

**Step 4: Commit**

```bash
git add -A
git commit -m "feat: add pipeline IPC handlers for start, step, approve, reject, and tool approval"
```

---

### Task 18: Connect Pipeline to UI

**Files:**
- Modify: `src/renderer/src/components/TaskDetail/TaskDetail.tsx`
- Modify: `src/renderer/src/stores/pipelineStore.ts`

**Step 1: Subscribe pipelineStore to IPC stream and approval events**

**Step 2: Add pipeline action buttons to TaskDetail (Start/Step/Approve/Reject)**

**Step 3: Show streaming output in TaskDetail as a scrolling log**

**Step 4: Verify end-to-end pipeline flow**

```bash
pnpm dev
```

**Step 5: Commit**

```bash
git add -A
git commit -m "feat: connect pipeline engine to UI with streaming output and action buttons"
```

---

### Task 19: Handoff Display & Auto-Refresh

**Files:**
- Modify: `src/renderer/src/components/TaskDetail/HandoffChain.tsx`
- Modify: `src/renderer/src/components/KanbanBoard/KanbanBoard.tsx`
- Modify: `src/renderer/src/components/Dashboard/MetricsRow.tsx`

**Step 1: Update HandoffChain to render real handoff data with color-coded status, warning icons, question icons**

**Step 2: Add auto-refresh polling (5s default, 2s when streaming)**

**Step 3: Update MetricsRow to reflect live stats**

**Step 4: Commit**

```bash
git add -A
git commit -m "feat: add handoff display and auto-refresh polling for live pipeline updates"
```

---

## Phase 4: Intervention Panel + Activity Feed + Polish

### Task 20: Intervention Panel

**Files:**
- Create: `src/renderer/src/components/InterventionPanel/InterventionPanel.tsx`
- Create: `src/renderer/src/components/InterventionPanel/PlanReviewGate.tsx`
- Create: `src/renderer/src/components/InterventionPanel/CodeReviewGate.tsx`
- Create: `src/renderer/src/components/InterventionPanel/CircuitBreakerPanel.tsx`
- Create: `src/renderer/src/components/InterventionPanel/OpenQuestionsPanel.tsx`
- Modify: `src/renderer/src/components/TaskDetail/TaskDetail.tsx`

**Step 1: Build PlanReviewGate (markdown plan display, approve/reject, feedback textarea)**

**Step 2: Build CodeReviewGate (score bars, review comments, approve/reject)**

**Step 3: Build CircuitBreakerPanel (rejection history, retry/change/override actions)**

**Step 4: Build OpenQuestionsPanel (questions display, response field, submit)**

**Step 5: Build InterventionPanel router (determines which sub-panel based on task state)**

**Step 6: Integrate into TaskDetail**

**Step 7: Verify intervention flow**

```bash
pnpm dev
```

**Step 8: Commit**

```bash
git add -A
git commit -m "feat: add intervention panel with plan review, code review, circuit breaker, and Q&A gates"
```

---

### Task 21: Activity Feed

**Files:**
- Create: `src/renderer/src/components/ActivityFeed/ActivityFeed.tsx`
- Create: `src/renderer/src/components/ActivityFeed/ActivityEntry.tsx`
- Modify: `src/renderer/src/components/Dashboard/Dashboard.tsx`

**Step 1: Build ActivityEntry (timestamp, agent badge, action icon, content preview, clickable)**

**Step 2: Build ActivityFeed (collapsible sidebar, aggregated events, filters)**

**Step 3: Integrate into Dashboard as right sidebar (320px, collapsible)**

**Step 4: Verify live activity feed during pipeline execution**

```bash
pnpm dev
```

**Step 5: Commit**

```bash
git add -A
git commit -m "feat: add real-time activity feed sidebar with filtering and task navigation"
```

---

### Task 22: Tool Approval UI

**Files:**
- Create: `src/renderer/src/components/common/ApprovalDialog.tsx`
- Modify: `src/renderer/src/components/TaskDetail/TaskDetail.tsx`

**Step 1: Build ApprovalDialog (tool name, input preview, allow/deny buttons)**

**Step 2: Wire to pipelineStore.approvalRequest state**

**Step 3: Verify tool approval flow in gated mode**

**Step 4: Commit**

```bash
git add -A
git commit -m "feat: add tool approval dialog for gated pipeline mode"
```

---

### Task 23: Window Chrome & Polish

**Files:**
- Modify: `src/main/index.ts`
- Create: `src/renderer/src/components/common/TitleBar.tsx`
- Modify: `src/renderer/src/App.tsx`

**Step 1: Add custom draggable title bar with wordmark and window controls**

**Step 2: Add window state persistence (size/position saved to ~/.clawflow/window-state.json)**

**Step 3: Add loading states (skeleton loaders)**

**Step 4: Add empty states ("No projects yet", "No tasks", "No activity")**

**Step 5: Commit**

```bash
git add -A
git commit -m "feat: add custom title bar, window state persistence, loading and empty states"
```

---

### Task 24: Error Handling & Edge Cases

**Files:**
- Create: `src/renderer/src/components/common/ErrorBoundary.tsx`
- Create: `src/renderer/src/components/common/Toast.tsx`
- Modify: `src/main/sdk-manager.ts`
- Modify: `src/main/pipeline-engine.ts`

**Step 1: Build ErrorBoundary (catches render errors, styled error screen, reload button)**

**Step 2: Build Toast notification system (bottom-right stack, auto-dismiss 5s)**

**Step 3: Add SDK error recovery (network retry with backoff, rate limit handling)**

**Step 4: Add pipeline error states (blocked on error, error in agent_log, retry button)**

**Step 5: Commit**

```bash
git add -A
git commit -m "feat: add error boundary, toast notifications, SDK error recovery, and pipeline error states"
```

---

### Task 25: Final Integration & Verification

**Files:**
- No new files — integration testing and fixes only

**Step 1: Full pipeline smoke test**

1. Launch app, register test project, create L2 task
2. Start pipeline, watch it progress through all stages
3. Verify handoff chain populated, agent log has full trail, metrics update

**Step 2: Gated mode test**

1. Create task with autoMode off, start pipeline
2. Verify pauses at each gate, approve through each
3. Verify final completion gate

**Step 3: Circuit breaker test**

1. Reject code review 3 times
2. Verify circuit breaker trips, task blocked, CircuitBreakerPanel appears

**Step 4: Fix any issues found during testing**

**Step 5: Final commit**

```bash
git add -A
git commit -m "feat: complete ClawFlow integration — pipeline, UI, and SDK fully wired"
```

---

## Summary

| Phase | Tasks | What It Delivers |
|-------|-------|-----------------|
| Phase 1 | Tasks 1-8 | Scaffold, types, DB, templates, pipeline engine, IPC — the core without UI |
| Phase 2 | Tasks 9-15 | Theme, stores, project selector, dashboard, kanban board, task detail — the visual layer |
| Phase 3 | Tasks 16-19 | SDK manager, pipeline IPC, streaming, handoff display — the AI integration |
| Phase 4 | Tasks 20-25 | Intervention panel, activity feed, tool approval, polish, error handling — production readiness |

**Total: 25 tasks across 4 phases.**
