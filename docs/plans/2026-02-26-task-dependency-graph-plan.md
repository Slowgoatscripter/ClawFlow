# Task Dependency Graph Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add cross-task dependency tracking, an artifact registry, and smart parallel execution so pipeline tasks that depend on each other execute in the correct order with shared context.

**Architecture:** A new TaskGraph module manages a DAG of task dependencies. The workshop AI infers dependencies when suggesting tasks. Completed tasks register their artifacts (files, exports, types) in the DB. Dependent tasks receive this context in their prompts and start only after prerequisites are merged to the base branch.

**Tech Stack:** TypeScript, better-sqlite3, Electron IPC, React (Zustand stores)

---

### Task 1: Add dependency and artifact fields to data model

**Files:**
- Modify: `src/shared/types.ts:83-125` (Task, CreateTaskInput, WorkshopSuggestedTask interfaces)
- Modify: `src/shared/types.ts:315-374` (IpcChannel type)

**Step 1: Add TaskArtifacts interface**

Add above the `Task` interface (before line 83):

```typescript
export interface TaskArtifacts {
  filesCreated: string[]
  filesModified: string[]
  exportsAdded: string[]
  typesAdded: string[]
  summary: string
}
```

**Step 2: Add fields to Task interface**

Add after `richHandoff` (line 116):

```typescript
  dependencyIds: number[]
  artifacts: TaskArtifacts | null
```

**Step 3: Add field to CreateTaskInput**

Add after `autoMode` (line 124):

```typescript
  dependencyIds?: number[]
```

**Step 4: Add dependsOn to WorkshopSuggestedTask**

Add after `linkedArtifactIds` (line 310):

```typescript
  dependsOn?: number[]
```

**Step 5: Add IPC channel**

Add after `'pipeline:context-update'` (line 367):

```typescript
  | 'tasks:get-dependencies'
```

**Step 6: Commit**

```bash
git add src/shared/types.ts
git commit -m "feat: add dependency and artifact types to data model"
```

---

### Task 2: Add DB schema and migration for dependencies and artifacts

**Files:**
- Modify: `src/main/db.ts:105-201` (schema), `src/main/db.ts:224-232` (createTask), `src/main/db.ts:532-544` (migrations), `src/main/db.ts:581-617` (rowToTask)

**Step 1: Add columns to migration function**

In `migrateTasksTable()`, after the last `if (!colNames.has(...))` block (after line 543):

```typescript
  if (!colNames.has('dependency_ids'))
    db.prepare("ALTER TABLE tasks ADD COLUMN dependency_ids TEXT NOT NULL DEFAULT '[]'").run()
  if (!colNames.has('artifacts'))
    db.prepare('ALTER TABLE tasks ADD COLUMN artifacts TEXT').run()
```

**Step 2: Add task_dependencies join table**

In `initProjectDb()`, after the existing table creation statements (after the `workshop_task_links` table ~line 194):

```sql
CREATE TABLE IF NOT EXISTS task_dependencies (
  task_id INTEGER NOT NULL,
  depends_on_task_id INTEGER NOT NULL,
  PRIMARY KEY (task_id, depends_on_task_id),
  FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
  FOREIGN KEY (depends_on_task_id) REFERENCES tasks(id) ON DELETE CASCADE
)
```

**Step 3: Update createTask to accept dependencyIds**

In `createTask()` (lines 224-232), after inserting the task, add dependency rows:

```typescript
export function createTask(dbPath: string, input: CreateTaskInput): Task {
  const db = getProjectDb(dbPath)
  const result = db.prepare(`
    INSERT INTO tasks (title, description, tier, priority, auto_mode, dependency_ids)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    input.title, input.description, input.tier, input.priority,
    input.autoMode ? 1 : 0,
    JSON.stringify(input.dependencyIds ?? [])
  )

  const taskId = result.lastInsertRowid as number

  if (input.dependencyIds?.length) {
    const insertDep = db.prepare(
      'INSERT INTO task_dependencies (task_id, depends_on_task_id) VALUES (?, ?)'
    )
    for (const depId of input.dependencyIds) {
      insertDep.run(taskId, depId)
    }
  }

  return getTask(dbPath, result.lastInsertRowid as number)!
}
```

**Step 4: Update rowToTask to include new fields**

In `rowToTask()` (lines 581-617), add after `richHandoff`:

```typescript
  dependencyIds: JSON.parse(row.dependency_ids || '[]'),
  artifacts: row.artifacts ? JSON.parse(row.artifacts) : null,
```

**Step 5: Add helper functions for dependencies**

Add new exported functions:

```typescript
export function getTaskDependencies(dbPath: string, taskId: number): number[] {
  const db = getProjectDb(dbPath)
  const rows = db.prepare(
    'SELECT depends_on_task_id FROM task_dependencies WHERE task_id = ?'
  ).all(taskId) as { depends_on_task_id: number }[]
  return rows.map(r => r.depends_on_task_id)
}

export function getTaskDependents(dbPath: string, taskId: number): number[] {
  const db = getProjectDb(dbPath)
  const rows = db.prepare(
    'SELECT task_id FROM task_dependencies WHERE depends_on_task_id = ?'
  ).all(taskId) as { task_id: number }[]
  return rows.map(r => r.task_id)
}

export function setTaskArtifacts(dbPath: string, taskId: number, artifacts: TaskArtifacts): void {
  const db = getProjectDb(dbPath)
  db.prepare('UPDATE tasks SET artifacts = ? WHERE id = ?').run(JSON.stringify(artifacts), taskId)
}

export function areDependenciesMet(dbPath: string, taskId: number): boolean {
  const deps = getTaskDependencies(dbPath, taskId)
  if (deps.length === 0) return true
  const db = getProjectDb(dbPath)
  const doneCount = db.prepare(
    `SELECT COUNT(*) as cnt FROM tasks WHERE id IN (${deps.map(() => '?').join(',')}) AND status = 'done'`
  ).get(...deps) as { cnt: number }
  return doneCount.cnt === deps.length
}
```

**Step 6: Commit**

```bash
git add src/main/db.ts
git commit -m "feat: add dependency and artifact columns, join table, and helpers"
```

---

### Task 3: Create TaskGraph module

**Files:**
- Create: `src/main/task-graph.ts`

**Step 1: Create the module with DAG logic**

```typescript
// src/main/task-graph.ts
import { Task } from '../shared/types'

interface AdjacencyList {
  [taskId: number]: number[] // taskId -> list of tasks it depends on
}

interface GraphValidation {
  valid: boolean
  cycle?: number[] // task IDs forming the cycle
}

export function buildGraph(tasks: Task[]): AdjacencyList {
  const graph: AdjacencyList = {}
  for (const task of tasks) {
    graph[task.id] = task.dependencyIds ?? []
  }
  return graph
}

export function validateNoCycles(graph: AdjacencyList): GraphValidation {
  const visited = new Set<number>()
  const inStack = new Set<number>()
  const path: number[] = []

  function dfs(node: number): number[] | null {
    if (inStack.has(node)) {
      const cycleStart = path.indexOf(node)
      return path.slice(cycleStart).concat(node)
    }
    if (visited.has(node)) return null

    visited.add(node)
    inStack.add(node)
    path.push(node)

    for (const dep of graph[node] ?? []) {
      const cycle = dfs(dep)
      if (cycle) return cycle
    }

    path.pop()
    inStack.delete(node)
    return null
  }

  for (const nodeStr of Object.keys(graph)) {
    const node = Number(nodeStr)
    const cycle = dfs(node)
    if (cycle) return { valid: false, cycle }
  }

  return { valid: true }
}

export function getReadyTaskIds(
  graph: AdjacencyList,
  taskStatuses: Map<number, string>
): number[] {
  const ready: number[] = []
  for (const [taskIdStr, deps] of Object.entries(graph)) {
    const taskId = Number(taskIdStr)
    const status = taskStatuses.get(taskId)
    if (status !== 'backlog') continue // only backlog tasks can become ready

    const allDepsDone = deps.every(depId => taskStatuses.get(depId) === 'done')
    if (allDepsDone) ready.push(taskId)
  }
  return ready
}

export function getDependencyChain(
  graph: AdjacencyList,
  taskId: number
): number[] {
  const chain: number[] = []
  const visited = new Set<number>()

  function collect(id: number): void {
    for (const depId of graph[id] ?? []) {
      if (!visited.has(depId)) {
        visited.add(depId)
        collect(depId)
        chain.push(depId)
      }
    }
  }

  collect(taskId)
  return chain // topological order: earliest dependencies first
}

export function isTaskBlocked(
  graph: AdjacencyList,
  taskId: number,
  taskStatuses: Map<number, string>
): { blocked: boolean; blockedBy: number[] } {
  const deps = graph[taskId] ?? []
  const blockedBy = deps.filter(depId => taskStatuses.get(depId) !== 'done')
  return { blocked: blockedBy.length > 0, blockedBy }
}
```

**Step 2: Commit**

```bash
git add src/main/task-graph.ts
git commit -m "feat: add TaskGraph module with DAG, cycle detection, and readiness checks"
```

---

### Task 4: Add dependency gate and artifact capture to pipeline engine

**Files:**
- Modify: `src/main/pipeline-engine.ts:103-140` (startTask), `src/main/pipeline-engine.ts:726-731` (completion), `src/main/pipeline-engine.ts:829-836` (worktree cleanup)

**Step 1: Add dependency gate to startTask()**

In `startTask()`, after the backlog status check (~line 106) and before `getFirstStage()`:

```typescript
// Check dependencies are met
if (!areDependenciesMet(this.dbPath, taskId)) {
  const depIds = getTaskDependencies(this.dbPath, taskId)
  const depTasks = depIds
    .map(id => getTask(this.dbPath, id))
    .filter(t => t && t.status !== 'done')
  const names = depTasks.map(t => t!.title).join(', ')
  throw new Error(`Task blocked by incomplete dependencies: ${names}`)
}
```

Import `areDependenciesMet`, `getTaskDependencies`, `getTask` from `./db`.

**Step 2: Add artifact capture on task completion**

When a task reaches `done` status (lines 726-731), before the `updateTask` call, request artifact extraction. Add an `extractArtifacts()` method:

```typescript
private async extractArtifacts(taskId: number): Promise<void> {
  const task = getTask(this.dbPath, taskId)
  if (!task) return

  // Parse implementation notes for file changes
  const artifacts: TaskArtifacts = {
    filesCreated: [],
    filesModified: [],
    exportsAdded: [],
    typesAdded: [],
    summary: ''
  }

  // Extract from agent log - look for file write/edit tool calls
  for (const entry of task.agentLog) {
    if (entry.type === 'tool_use') {
      const input = entry.toolInput as Record<string, unknown>
      if (entry.toolName === 'write' && typeof input?.file_path === 'string') {
        artifacts.filesCreated.push(input.file_path)
      }
      if (entry.toolName === 'edit' && typeof input?.file_path === 'string') {
        artifacts.filesModified.push(input.file_path)
      }
    }
  }

  // Deduplicate: if a file was both created and modified, keep only in created
  const createdSet = new Set(artifacts.filesCreated)
  artifacts.filesModified = artifacts.filesModified.filter(f => !createdSet.has(f))

  // Build summary from implementation notes
  if (task.implementationNotes) {
    const notes = typeof task.implementationNotes === 'string'
      ? task.implementationNotes
      : JSON.stringify(task.implementationNotes)
    artifacts.summary = notes.slice(0, 500)
  }

  setTaskArtifacts(this.dbPath, taskId, artifacts)
}
```

Call `await this.extractArtifacts(taskId)` right before the final `updateTask` that sets status to `'done'`.

**Step 3: Add auto-merge on completion before worktree cleanup**

In the completion block (lines 829-836), before `cleanupWorktree`, add merge:

```typescript
if (stage === 'done' && this.gitEngine) {
  // Auto-merge completed task branch to base
  const mergeResult = await this.gitEngine.merge(taskId)
  if (!mergeResult.success) {
    this.emit('stream', {
      taskId,
      agent: 'pipeline',
      type: 'error',
      content: `Merge conflict: ${mergeResult.error}. Resolve before dependents can start.`,
      timestamp: new Date().toISOString()
    })
    // Don't cleanup worktree on conflict - user needs to resolve
    return
  }

  // Notify dependents they may be unblocked
  const dependents = getTaskDependents(this.dbPath, taskId)
  for (const depId of dependents) {
    if (areDependenciesMet(this.dbPath, depId)) {
      this.emit('task:unblocked', { taskId: depId })
    }
  }

  await this.gitEngine.cleanupWorktree(taskId)
  this.taskWorktrees.delete(taskId)
}
```

**Step 4: Commit**

```bash
git add src/main/pipeline-engine.ts
git commit -m "feat: add dependency gate, artifact capture, and auto-merge to pipeline"
```

---

### Task 5: Add dependency context injection to template engine

**Files:**
- Modify: `src/main/template-engine.ts:42-88` (fillTemplate replacements)
- Modify: `src/main/template-engine.ts:140-158` (constructPrompt)
- Modify: `src/main/pipeline-engine.ts:552-574` (where constructPrompt is called)

**Step 1: Add dependencyContext parameter to constructPrompt**

Update signature (line 140):

```typescript
export function constructPrompt(
  stage: PipelineStage,
  task: Task,
  projectPath?: string,
  dependencyContext?: string
): string {
```

After the `richHandoff` injection block (~line 155), add:

```typescript
  if (dependencyContext) {
    const depBlock = `\n\n---\n## Context from Dependency Tasks\n\n${dependencyContext}\n\n---\n\n`
    prompt = depBlock + prompt
  }
```

**Step 2: Add {{dependency_context}} to fillTemplate replacements**

In the `replacements` object (around line 82), add:

```typescript
  '{{dependency_context}}': dependencyContext ?? '',
```

This requires passing `dependencyContext` to `fillTemplate` as well — update its signature to accept an optional extra replacements map, or just add it to the main replacements.

**Step 3: Build dependency context in pipeline engine before calling constructPrompt**

In `runStage()` where `constructPrompt` is called (~line 563), build the context string:

```typescript
// Build dependency context from completed prerequisite tasks
let dependencyContext: string | undefined
if (task.dependencyIds.length > 0) {
  const depContextParts: string[] = []
  for (const depId of task.dependencyIds) {
    const depTask = getTask(this.dbPath, depId)
    if (depTask?.artifacts) {
      const a = depTask.artifacts
      const parts = [`**Task "${depTask.title}"** completed.`]
      if (a.filesCreated.length) parts.push(`Files created: ${a.filesCreated.map(f => '`' + f + '`').join(', ')}`)
      if (a.filesModified.length) parts.push(`Files modified: ${a.filesModified.map(f => '`' + f + '`').join(', ')}`)
      if (a.exportsAdded.length) parts.push(`Exports added: ${a.exportsAdded.join(', ')}`)
      if (a.typesAdded.length) parts.push(`Types added: ${a.typesAdded.join(', ')}`)
      if (a.summary) parts.push(`Summary: ${a.summary}`)
      depContextParts.push(parts.join('\n'))
    }
  }
  if (depContextParts.length) {
    dependencyContext = depContextParts.join('\n\n')
  }
}

prompt = constructPrompt(stage, task, this.projectPath, dependencyContext)
```

**Step 4: Commit**

```bash
git add src/main/template-engine.ts src/main/pipeline-engine.ts
git commit -m "feat: inject dependency context into stage prompts"
```

---

### Task 6: Update workshop AI to emit dependencies

**Files:**
- Modify: `src/templates/workshop-agent.md` (suggest_tasks tool schema)
- Modify: `src/main/workshop-engine.ts:647-683` (suggestTasks and createPipelineTask)

**Step 1: Update the suggest_tasks tool schema in workshop-agent.md**

Find the `suggest_tasks` tool definition and add `dependsOn` to the task schema:

```
suggest_tasks
- tasks: Array of task objects:
  - title: Task title
  - description: Task description
  - tier: L1, L2, or L3
  - priority: low, medium, high, or critical (optional)
  - dependsOn: Array of indices (0-based) of other tasks in this batch that must complete first (optional). Use when a task needs files, functions, or interfaces created by another task.
```

Add instruction to the system prompt section:

```
When suggesting tasks that build on each other, use the dependsOn field to indicate which tasks must complete first. For example, if task at index 2 needs functions created by task at index 0, set dependsOn: [0] on task 2. This ensures tasks execute in the correct order and later tasks receive context about what earlier tasks created.
```

**Step 2: Update suggestTasks to handle batch dependency mapping**

Replace `suggestTasks()` method (lines 647-655):

```typescript
async suggestTasks(sessionId: string, tasks: WorkshopSuggestedTask[]): Promise<void> {
  if (this.autoMode) {
    // Create all tasks first to get real IDs
    const createdTasks: { id: number; index: number }[] = []
    for (let i = 0; i < tasks.length; i++) {
      const created = await this.createPipelineTask(sessionId, tasks[i])
      createdTasks.push({ id: created.id, index: i })
    }

    // Now wire up dependencies using real IDs
    for (let i = 0; i < tasks.length; i++) {
      const depIndices = tasks[i].dependsOn ?? []
      if (depIndices.length > 0) {
        const depIds = depIndices
          .filter(idx => idx >= 0 && idx < createdTasks.length)
          .map(idx => createdTasks[idx].id)
        if (depIds.length > 0) {
          addTaskDependencies(this.dbPath, createdTasks[i].id, depIds)
        }
      }
    }
  } else {
    this.emit('tasks:suggested', { sessionId, tasks })
  }
}
```

**Step 3: Update createPipelineTask to return the created task**

Update `createPipelineTask()` to return the `Task` object:

```typescript
async createPipelineTask(
  sessionId: string,
  task: WorkshopSuggestedTask & { autoMode?: boolean }
): Promise<Task> {
  const created = createTask(this.dbPath, {
    title: task.title,
    description: task.description,
    tier: task.tier,
    priority: task.priority ?? 'medium',
    autoMode: task.autoMode,
  })
  createWorkshopTaskLink(this.dbPath, created.id, sessionId)
  // ... existing linkedArtifactIds logic ...
  this.emit('task:created', { sessionId, task: created })
  return created
}
```

**Step 4: Add `addTaskDependencies` helper to db.ts**

```typescript
export function addTaskDependencies(dbPath: string, taskId: number, depIds: number[]): void {
  const db = getProjectDb(dbPath)
  const insert = db.prepare(
    'INSERT OR IGNORE INTO task_dependencies (task_id, depends_on_task_id) VALUES (?, ?)'
  )
  const currentDeps = JSON.parse(
    (db.prepare('SELECT dependency_ids FROM tasks WHERE id = ?').get(taskId) as any)?.dependency_ids || '[]'
  )
  const allDeps = [...new Set([...currentDeps, ...depIds])]
  db.prepare('UPDATE tasks SET dependency_ids = ? WHERE id = ?').run(JSON.stringify(allDeps), taskId)
  for (const depId of depIds) {
    insert.run(taskId, depId)
  }
}
```

**Step 5: Commit**

```bash
git add src/templates/workshop-agent.md src/main/workshop-engine.ts src/main/db.ts
git commit -m "feat: workshop AI emits task dependencies with index-to-ID mapping"
```

---

### Task 7: Handle manual task creation with dependencies (non-auto mode)

**Files:**
- Modify: `src/main/workshop-engine.ts` (tasks:suggested event handler)
- Modify: `src/main/ipc-handlers.ts` (workshop:create-tasks handler)

**Step 1: Update the tasks:suggested event to carry dependency indices**

The event already emits `{ sessionId, tasks }` where `tasks` is the raw `WorkshopSuggestedTask[]` array including `dependsOn`. The renderer receives this and shows the suggested tasks for user approval.

**Step 2: Update workshop:create-tasks IPC handler**

When the user approves suggested tasks from the workshop panel, the renderer calls `workshop:create-tasks`. Update this handler to perform the same batch-create-then-wire-dependencies flow:

```typescript
ipcMain.handle('workshop:create-tasks', async (_e, dbPath: string, tasks: WorkshopSuggestedTask[]) => {
  const createdTasks: { id: number; index: number }[] = []
  for (let i = 0; i < tasks.length; i++) {
    const created = createTask(dbPath, {
      title: tasks[i].title,
      description: tasks[i].description,
      tier: tasks[i].tier,
      priority: tasks[i].priority ?? 'medium',
    })
    createdTasks.push({ id: created.id, index: i })
  }

  // Wire dependencies
  for (let i = 0; i < tasks.length; i++) {
    const depIndices = tasks[i].dependsOn ?? []
    if (depIndices.length > 0) {
      const depIds = depIndices
        .filter(idx => idx >= 0 && idx < createdTasks.length)
        .map(idx => createdTasks[idx].id)
      if (depIds.length > 0) {
        addTaskDependencies(dbPath, createdTasks[i].id, depIds)
      }
    }
  }

  return createdTasks.map(ct => getTask(dbPath, ct.id))
})
```

**Step 3: Commit**

```bash
git add src/main/ipc-handlers.ts
git commit -m "feat: handle dependencies for manually approved workshop tasks"
```

---

### Task 8: Add IPC handler for dependency queries

**Files:**
- Modify: `src/main/ipc-handlers.ts`

**Step 1: Add dependency query handler**

```typescript
ipcMain.handle('tasks:get-dependencies', (_e, dbPath: string, taskId: number) => {
  return getTaskDependencies(dbPath, taskId)
})
```

**Step 2: Commit**

```bash
git add src/main/ipc-handlers.ts
git commit -m "feat: add IPC handler for task dependency queries"
```

---

### Task 9: Update Kanban board UI for dependency-blocked tasks

**Files:**
- Modify: `src/renderer/src/components/KanbanBoard/TaskCard.tsx`
- Modify: `src/renderer/src/components/TaskDetail/TaskDetail.tsx` (Start button disable)

**Step 1: Add blocked-by-dependency indicator to TaskCard**

In `TaskCard.tsx`, add a dependency-blocked state check (~line 57):

```typescript
const hasDependencies = task.dependencyIds?.length > 0
const isDepBlocked = task.status === 'backlog' && hasDependencies &&
  task.dependencyIds.some(depId => {
    const depTask = tasks.find(t => t.id === depId)
    return depTask && depTask.status !== 'done'
  })
```

Add a visual indicator in the card body (following the existing isPaused/isRunning pattern):

```tsx
{isDepBlocked && (
  <div className="flex items-center gap-1 text-xs text-amber-400 mt-1">
    <svg className="w-3 h-3" /* lock/chain icon */ />
    <span>
      Waiting on: {task.dependencyIds
        .map(id => tasks.find(t => t.id === id))
        .filter(t => t && t.status !== 'done')
        .map(t => t!.title)
        .join(', ')}
    </span>
  </div>
)}
```

**Step 2: Disable Start button in TaskDetail for blocked tasks**

In `TaskDetail.tsx`, find the Start/Run pipeline button and add a disabled condition:

```typescript
const depsNotMet = task.dependencyIds?.length > 0 &&
  task.dependencyIds.some(depId => {
    const depTask = tasks.find(t => t.id === depId)
    return depTask && depTask.status !== 'done'
  })
```

Disable the button and show tooltip:

```tsx
<button
  disabled={depsNotMet}
  title={depsNotMet ? 'Dependencies not yet complete' : 'Start pipeline'}
  ...
>
```

**Step 3: Add unblocked notification toast**

Listen for the `task:unblocked` event in the pipeline store or a useEffect, and show a toast:

```typescript
window.api.on('task:unblocked', (_event, { taskId }) => {
  const task = tasks.find(t => t.id === taskId)
  if (task) {
    // Show toast notification
    toast(`${task.title} is now ready to start`)
  }
})
```

**Step 4: Commit**

```bash
git add src/renderer/src/components/KanbanBoard/TaskCard.tsx src/renderer/src/components/TaskDetail/TaskDetail.tsx
git commit -m "feat: show dependency-blocked state on task cards and disable start button"
```

---

### Task 10: Wire task:unblocked event through IPC to renderer

**Files:**
- Modify: `src/main/pipeline-engine.ts` (emit IPC event)
- Modify: `src/main/index.ts` (forward event to renderer)
- Modify: `src/shared/types.ts` (add IPC channel)

**Step 1: Add IPC channel**

Add to `IpcChannel` type:

```typescript
  | 'pipeline:task-unblocked'
```

**Step 2: Forward event from pipeline engine to renderer**

In `src/main/index.ts` where other pipeline events are forwarded, add:

```typescript
pipelineEngine.on('task:unblocked', ({ taskId }) => {
  mainWindow?.webContents.send('pipeline:task-unblocked', { taskId })
})
```

**Step 3: Listen in renderer pipeline store**

In `pipelineStore.ts`, add listener:

```typescript
window.api.on('pipeline:task-unblocked', (_event, { taskId }) => {
  // Refresh task list to update UI state
  get().fetchTasks()
})
```

**Step 4: Commit**

```bash
git add src/main/pipeline-engine.ts src/main/index.ts src/shared/types.ts src/renderer/src/stores/pipelineStore.ts
git commit -m "feat: wire task-unblocked event from pipeline to renderer"
```

---

### Task 11: Add cycle validation when dependencies are created

**Files:**
- Modify: `src/main/db.ts` (addTaskDependencies)
- Modify: `src/main/workshop-engine.ts` (suggestTasks)

**Step 1: Validate cycles in addTaskDependencies**

Update `addTaskDependencies` to check for cycles before inserting:

```typescript
import { buildGraph, validateNoCycles } from './task-graph'
import { listTasks } from './db'

export function addTaskDependencies(dbPath: string, taskId: number, depIds: number[]): void {
  // Build graph with proposed new edges to check for cycles
  const allTasks = listTasks(dbPath)
  const proposedTask = allTasks.find(t => t.id === taskId)
  if (proposedTask) {
    proposedTask.dependencyIds = [...new Set([...(proposedTask.dependencyIds ?? []), ...depIds])]
  }
  const graph = buildGraph(allTasks)
  const validation = validateNoCycles(graph)
  if (!validation.valid) {
    console.warn(`Cycle detected in task dependencies: ${validation.cycle?.join(' -> ')}. Skipping.`)
    return
  }

  // Proceed with insert (existing logic)
  // ...
}
```

**Step 2: Commit**

```bash
git add src/main/db.ts src/main/workshop-engine.ts
git commit -m "feat: validate no cycles when adding task dependencies"
```

---

### Task 12: Integration test — end-to-end dependency flow

**Files:**
- Create: `src/main/__tests__/task-graph.test.ts`

**Step 1: Write tests for task-graph module**

```typescript
import { buildGraph, validateNoCycles, getReadyTaskIds, getDependencyChain, isTaskBlocked } from '../task-graph'
import { Task } from '../../shared/types'

function makeTask(id: number, deps: number[] = [], status = 'backlog'): Task {
  return { id, dependencyIds: deps, status } as Task
}

describe('TaskGraph', () => {
  test('buildGraph creates adjacency list', () => {
    const tasks = [makeTask(1), makeTask(2, [1]), makeTask(3, [1, 2])]
    const graph = buildGraph(tasks)
    expect(graph[1]).toEqual([])
    expect(graph[2]).toEqual([1])
    expect(graph[3]).toEqual([1, 2])
  })

  test('validateNoCycles passes for valid DAG', () => {
    const graph = { 1: [], 2: [1], 3: [1, 2] }
    expect(validateNoCycles(graph)).toEqual({ valid: true })
  })

  test('validateNoCycles detects cycle', () => {
    const graph = { 1: [3], 2: [1], 3: [2] }
    const result = validateNoCycles(graph)
    expect(result.valid).toBe(false)
    expect(result.cycle).toBeDefined()
  })

  test('getReadyTaskIds returns only unblocked backlog tasks', () => {
    const graph = { 1: [], 2: [1], 3: [] }
    const statuses = new Map([[1, 'backlog'], [2, 'backlog'], [3, 'backlog']])
    expect(getReadyTaskIds(graph, statuses)).toEqual([1, 3])
  })

  test('getReadyTaskIds unblocks when dependency is done', () => {
    const graph = { 1: [], 2: [1], 3: [] }
    const statuses = new Map([[1, 'done'], [2, 'backlog'], [3, 'done']])
    expect(getReadyTaskIds(graph, statuses)).toEqual([2])
  })

  test('getDependencyChain returns topological order', () => {
    const graph = { 1: [], 2: [1], 3: [2] }
    expect(getDependencyChain(graph, 3)).toEqual([1, 2])
  })

  test('isTaskBlocked identifies blocking tasks', () => {
    const graph = { 1: [], 2: [1] }
    const statuses = new Map([[1, 'implementing'], [2, 'backlog']])
    expect(isTaskBlocked(graph, 2, statuses)).toEqual({ blocked: true, blockedBy: [1] })
  })
})
```

**Step 2: Run tests**

```bash
npx vitest run src/main/__tests__/task-graph.test.ts
```

**Step 3: Commit**

```bash
git add src/main/__tests__/task-graph.test.ts
git commit -m "test: add unit tests for TaskGraph module"
```

---

## Task Dependency Summary

```
Task 1  (types)          ← no deps
Task 2  (DB schema)      ← depends on Task 1
Task 3  (task-graph)     ← depends on Task 1
Task 4  (pipeline)       ← depends on Task 2, Task 3
Task 5  (templates)      ← depends on Task 2, Task 4
Task 6  (workshop AI)    ← depends on Task 2
Task 7  (manual create)  ← depends on Task 6
Task 8  (IPC handler)    ← depends on Task 2
Task 9  (UI)             ← depends on Task 1, Task 10
Task 10 (IPC events)     ← depends on Task 4
Task 11 (cycle check)    ← depends on Task 2, Task 3
Task 12 (tests)          ← depends on Task 3
```
