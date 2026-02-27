# Usage-Aware Pause/Resume Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add per-task pause/resume, API usage monitoring with auto-pause at 95%, and context window bars on task cards.

**Architecture:** New `UsageMonitor` service polls Anthropic OAuth API for utilization data. `PipelineEngine` gains `pauseTask()`/`resumeTask()` methods that abort/resume SDK sessions. Renderer gets context bars on cards and a usage indicator in the top bar.

**Tech Stack:** Electron IPC, Anthropic OAuth API, keytar for credential access, Zustand stores, React components.

**Design doc:** `docs/plans/2026-02-26-usage-pause-resume-design.md`

---

### Task 1: Add `paused` Status to Type System

**Files:**
- Modify: `src/shared/types.ts:9-18` (TaskStatus), `src/shared/types.ts:82-112` (Task interface)
- Modify: `src/renderer/src/theme.ts:21-25` (status colors)

**Step 1: Add `paused` to TaskStatus union**

In `src/shared/types.ts`, add `'paused'` to the TaskStatus type:

```ts
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
  | 'paused'
```

**Step 2: Add pause fields to Task interface**

In `src/shared/types.ts`, add to the Task interface before the closing `}`:

```ts
  pausedFromStatus: TaskStatus | null
  pauseReason: 'manual' | 'usage_limit' | null
```

**Step 3: Add paused color to theme**

In `src/renderer/src/theme.ts`, add to the `status` object:

```ts
  status: {
    backlog: '#6c7086', brainstorming: '#cba6f7', design_review: '#f9e2af',
    planning: '#89b4fa', implementing: '#fab387', code_review: '#f9e2af',
    verifying: '#a6e3a1', done: '#a6e3a1', blocked: '#f38ba8',
    paused: '#9399b2'
  }
```

`#9399b2` is Catppuccin Mocha `overlay1` — a muted blue-grey that reads as "inactive/sleeping."

**Step 4: Commit**

```bash
git add src/shared/types.ts src/renderer/src/theme.ts
git commit -m "feat: add paused status to type system and theme"
```

---

### Task 2: Add Usage Types and Settings

**Files:**
- Create: `src/shared/usage-types.ts`
- Modify: `src/shared/settings.ts:4-14` (SETTING_KEYS), `src/shared/settings.ts:27-37` (SettingsState), `src/shared/settings.ts:39-49` (DEFAULT_SETTINGS)

**Step 1: Create usage types file**

Create `src/shared/usage-types.ts`:

```ts
export interface UsageBucket {
  utilization: number
  resetsAt: string
}

export interface UsageSnapshot {
  connected: boolean
  error: string | null
  fiveHour: { utilization: number; countdown: string } | null
  sevenDay: { utilization: number; countdown: string } | null
  sevenDayOpus: { utilization: number; countdown: string } | null
  sevenDaySonnet: { utilization: number; countdown: string } | null
}

export interface ContextUpdate {
  taskId: number
  stage: string
  contextTokens: number
  contextMax: number
}
```

**Step 2: Add usage settings keys**

In `src/shared/settings.ts`, add to SETTING_KEYS:

```ts
  'usage.autoPauseThreshold': 'usage.autoPauseThreshold',
  'usage.autoResume': 'usage.autoResume',
  'usage.monitorEnabled': 'usage.monitorEnabled',
```

**Step 3: Add usage fields to SettingsState**

In `src/shared/settings.ts`, add to the SettingsState interface:

```ts
  autoPauseThreshold: number
  autoResume: boolean
  usageMonitorEnabled: boolean
```

**Step 4: Add defaults to DEFAULT_SETTINGS**

```ts
  autoPauseThreshold: 95,
  autoResume: false,
  usageMonitorEnabled: true,
```

**Step 5: Commit**

```bash
git add src/shared/usage-types.ts src/shared/settings.ts
git commit -m "feat: add usage types and settings for pause/resume"
```

---

### Task 3: Add DB Support for Pause Fields

**Files:**
- Modify: `src/main/db.ts` — Add columns to CREATE TABLE and to `updateTask`/`getTask` field mappings

**Step 1: Check current DB schema**

Read `src/main/db.ts` to find the `CREATE TABLE tasks` statement and the `updateTask`/`getTask` functions. Identify exact lines for insertion.

**Step 2: Add columns to tasks table**

In the `CREATE TABLE IF NOT EXISTS tasks` statement, add:

```sql
  paused_from_status TEXT DEFAULT NULL,
  pause_reason TEXT DEFAULT NULL,
```

**Step 3: Add fields to updateTask**

In the `updateTask` function, add `paused_from_status` and `pause_reason` to the set of updatable fields, mapping from camelCase (`pausedFromStatus`, `pauseReason`) to snake_case columns.

**Step 4: Add fields to task row mapping**

In whichever function maps DB rows to the `Task` interface (likely `getTask` or a row mapper), add:

```ts
  pausedFromStatus: row.paused_from_status,
  pauseReason: row.pause_reason,
```

**Step 5: Commit**

```bash
git add src/main/db.ts
git commit -m "feat: add paused_from_status and pause_reason columns to tasks table"
```

---

### Task 4: Add pauseTask and resumeTask to PipelineEngine

**Files:**
- Modify: `src/main/pipeline-engine.ts` — Add two new public methods and a new emit event

**Step 1: Add `pauseTask` method**

Insert after line 345 (before the private methods section) in `src/main/pipeline-engine.ts`:

```ts
  /**
   * Pause a running task — aborts the SDK session and saves state for resume.
   */
  async pauseTask(taskId: number, reason: 'manual' | 'usage_limit' = 'manual'): Promise<Task> {
    const task = this.getTaskOrThrow(taskId)

    // Only pause tasks that are actively running
    const activeStatuses = ['brainstorming', 'design_review', 'planning', 'implementing', 'code_review', 'verifying']
    if (!activeStatuses.includes(task.status)) {
      throw new Error(`Task ${taskId} cannot be paused (status: ${task.status})`)
    }

    const sessionKey = `${taskId}-${task.currentAgent}`
    abortSession(sessionKey)

    appendAgentLog(this.dbPath, taskId, {
      timestamp: new Date().toISOString(),
      agent: 'pipeline-engine',
      model: 'system',
      action: 'pause',
      details: `Task paused (${reason}). Was in status: ${task.status}, stage: ${task.currentAgent}`
    })

    updateTask(this.dbPath, taskId, {
      pausedFromStatus: task.status,
      pauseReason: reason,
      status: 'paused' as TaskStatus
    })

    this.emit('stage:paused', { taskId, reason })
    return this.getTaskOrThrow(taskId)
  }
```

**Step 2: Add `resumeTask` method**

Insert after `pauseTask`:

```ts
  /**
   * Resume a paused task — restores status and re-runs the stage with session resume.
   */
  async resumeTask(taskId: number): Promise<Task> {
    const task = this.getTaskOrThrow(taskId)

    if (task.status !== 'paused') {
      throw new Error(`Task ${taskId} is not paused (status: ${task.status})`)
    }

    const resumeStatus = task.pausedFromStatus ?? 'implementing'
    const currentStage = task.currentAgent as PipelineStage

    appendAgentLog(this.dbPath, taskId, {
      timestamp: new Date().toISOString(),
      agent: 'pipeline-engine',
      model: 'system',
      action: 'resume',
      details: `Task resumed. Restoring status: ${resumeStatus}, stage: ${currentStage}`
    })

    updateTask(this.dbPath, taskId, {
      status: resumeStatus as TaskStatus,
      pausedFromStatus: null,
      pauseReason: null
    })

    // Resume the stage with the saved session ID
    const sessionId = this.sessionIds.get(taskId)
    await this.runStage(taskId, currentStage, undefined, sessionId ?? undefined, 'Please continue where you left off.')
    return this.getTaskOrThrow(taskId)
  }
```

**Step 3: Add `pauseAllTasks` method**

Insert after `resumeTask`:

```ts
  /**
   * Pause all currently running tasks (used by auto-pause on usage limit).
   */
  async pauseAllTasks(reason: 'manual' | 'usage_limit' = 'usage_limit'): Promise<number> {
    const { listTasks } = await import('./db')
    const tasks = listTasks(this.dbPath)
    const activeStatuses = ['brainstorming', 'design_review', 'planning', 'implementing', 'code_review', 'verifying']
    const running = tasks.filter(t => activeStatuses.includes(t.status))

    let pausedCount = 0
    for (const task of running) {
      try {
        await this.pauseTask(task.id, reason)
        pausedCount++
      } catch {
        // Task may have finished between list and pause — skip
      }
    }
    return pausedCount
  }
```

**Step 4: Check the `runStage` method signature**

Read the `runStage` method signature to confirm it already accepts `resumeSessionId` and `userResponse` parameters. It should look like:

```ts
private async runStage(taskId: number, stage: PipelineStage, feedback?: string, resumeSessionId?: string, userResponse?: string)
```

If `runStage` does not already have `resumeSessionId`/`userResponse` params, add them. Check how `respondToQuestions` calls `runStage` — it likely already passes these.

**Step 5: Add `abortSession` import**

At the top of `pipeline-engine.ts`, ensure `abortSession` is imported from `./sdk-manager`:

```ts
import { abortSession } from './sdk-manager'
```

If not already imported, add it.

**Step 6: Commit**

```bash
git add src/main/pipeline-engine.ts
git commit -m "feat: add pauseTask, resumeTask, pauseAllTasks to pipeline engine"
```

---

### Task 5: Create Usage Monitor Service

**Files:**
- Create: `src/main/usage-monitor.ts`

**Step 1: Create the usage monitor module**

Create `src/main/usage-monitor.ts`:

```ts
import { EventEmitter } from 'events'
import https from 'https'
import type { UsageBucket, UsageSnapshot } from '../shared/usage-types'

const OAUTH_URL = 'https://api.anthropic.com/api/oauth/usage'
const POLL_INTERVAL_MS = 60_000

function formatCountdown(resetsAt: string): string {
  const diff = new Date(resetsAt).getTime() - Date.now()
  if (diff <= 0) return 'now'
  const hours = Math.floor(diff / 3_600_000)
  const minutes = Math.floor((diff % 3_600_000) / 60_000)
  if (hours > 24) {
    const days = Math.floor(hours / 24)
    const remHours = hours % 24
    return `${days}d ${remHours}h`
  }
  return `${hours}h ${minutes}m`
}

function parseBucket(raw: any): UsageBucket | null {
  if (!raw || typeof raw.utilization !== 'number') return null
  return { utilization: raw.utilization, resetsAt: raw.resets_at ?? '' }
}

function formatBucket(bucket: UsageBucket | null): { utilization: number; countdown: string } | null {
  if (!bucket) return null
  return { utilization: bucket.utilization, countdown: formatCountdown(bucket.resetsAt) }
}

export class UsageMonitor extends EventEmitter {
  private token: string | null = null
  private timer: ReturnType<typeof setInterval> | null = null
  private lastSnapshot: UsageSnapshot = {
    connected: false, error: null,
    fiveHour: null, sevenDay: null, sevenDayOpus: null, sevenDaySonnet: null
  }

  async start(): Promise<void> {
    await this.loadToken()
    if (!this.token) {
      this.lastSnapshot = { connected: false, error: 'No OAuth token found', fiveHour: null, sevenDay: null, sevenDayOpus: null, sevenDaySonnet: null }
      this.emit('snapshot', this.lastSnapshot)
      return
    }
    await this.poll()
    this.timer = setInterval(() => this.poll(), POLL_INTERVAL_MS)
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  getSnapshot(): UsageSnapshot {
    return this.lastSnapshot
  }

  private async loadToken(): Promise<void> {
    try {
      const keytar = await import('keytar')
      this.token = await keytar.default.getPassword('claude-code', 'oauth_token')
    } catch {
      this.token = null
    }
  }

  private async poll(): Promise<void> {
    if (!this.token) return

    try {
      const raw = await this.fetchUsage()
      const fiveHour = parseBucket(raw.five_hour)
      const sevenDay = parseBucket(raw.seven_day)
      const sevenDayOpus = parseBucket(raw.seven_day_opus)
      const sevenDaySonnet = parseBucket(raw.seven_day_sonnet)

      this.lastSnapshot = {
        connected: true,
        error: null,
        fiveHour: formatBucket(fiveHour),
        sevenDay: formatBucket(sevenDay),
        sevenDayOpus: formatBucket(sevenDayOpus),
        sevenDaySonnet: formatBucket(sevenDaySonnet)
      }

      this.emit('snapshot', this.lastSnapshot)

      // Check auto-pause threshold against five-hour bucket
      if (fiveHour && fiveHour.utilization >= 95) {
        this.emit('limit-approaching', {
          utilization: fiveHour.utilization,
          resetsAt: fiveHour.resetsAt,
          countdown: formatCountdown(fiveHour.resetsAt)
        })
      }
    } catch (err: any) {
      this.lastSnapshot = {
        connected: false,
        error: err.message ?? 'Unknown error',
        fiveHour: null, sevenDay: null, sevenDayOpus: null, sevenDaySonnet: null
      }
      this.emit('snapshot', this.lastSnapshot)
    }
  }

  private fetchUsage(): Promise<any> {
    return new Promise((resolve, reject) => {
      const url = new URL(OAUTH_URL)
      const req = https.request({
        hostname: url.hostname,
        path: url.pathname,
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${this.token}`,
          'anthropic-beta': 'oauth-2025-04-20'
        },
        timeout: 15_000
      }, (res) => {
        let body = ''
        res.on('data', (chunk) => { body += chunk })
        res.on('end', () => {
          if (res.statusCode === 200) {
            try { resolve(JSON.parse(body)) }
            catch { reject(new Error('Invalid JSON response')) }
          } else {
            reject(new Error(`HTTP ${res.statusCode}: ${body.slice(0, 200)}`))
          }
        })
      })
      req.on('error', reject)
      req.on('timeout', () => { req.destroy(); reject(new Error('Request timed out')) })
      req.end()
    })
  }
}
```

**Step 2: Commit**

```bash
git add src/main/usage-monitor.ts
git commit -m "feat: add usage monitor service for Anthropic API utilization"
```

---

### Task 6: Add Context Token Tracking to SDK Manager

**Files:**
- Modify: `src/main/sdk-manager.ts` — Accumulate context tokens during streaming, emit context-update events

**Step 1: Read `src/main/sdk-manager.ts` fully**

Find the `for await` loop where streaming events are processed (around lines 230-295). Look for where `block.text` is handled and where `result` is built.

**Step 2: Add token accumulation**

Inside `runSdkSessionOnce`, before the `for await` loop, add:

```ts
let contextTokens = 0
const contextMax = 200_000
```

Inside the `for await` loop, after processing each turn's response, look for where `usage` data is available. In the Claude Agent SDK, the response message includes `usage.input_tokens` and `usage.cache_read_input_tokens`. Add:

```ts
if (message.usage) {
  contextTokens = (message.usage.input_tokens ?? 0) + (message.usage.cache_read_input_tokens ?? 0)
  params.onStream?.(`__context:${contextTokens}:${contextMax}`, 'context')
}
```

This piggybacks on the existing `onStream` callback with a special `'context'` type that the pipeline engine can intercept.

**Step 3: Commit**

```bash
git add src/main/sdk-manager.ts
git commit -m "feat: track context token usage during SDK streaming"
```

---

### Task 7: Wire Context Updates Through Pipeline Engine

**Files:**
- Modify: `src/main/pipeline-engine.ts:405-407` — Intercept context stream events and emit as separate event

**Step 1: Add context-update emission in the onStream callback**

In `pipeline-engine.ts`, find the `onStream` callback passed to `sdkRunner` (around line 405):

```ts
onStream: (content: string, type: string) => {
  this.emit('stream', { taskId, stage, content, type })
},
```

Replace with:

```ts
onStream: (content: string, type: string) => {
  if (type === 'context') {
    const parts = content.replace('__context:', '').split(':')
    this.emit('context-update', {
      taskId,
      stage,
      contextTokens: parseInt(parts[0], 10),
      contextMax: parseInt(parts[1], 10)
    })
  } else {
    this.emit('stream', { taskId, stage, content, type })
  }
},
```

**Step 2: Commit**

```bash
git add src/main/pipeline-engine.ts
git commit -m "feat: emit context-update events from pipeline engine"
```

---

### Task 8: Wire IPC Channels for Pause/Resume and Usage

**Files:**
- Modify: `src/main/index.ts:185-231` — Add new IPC handlers and event wiring
- Modify: `src/shared/types.ts:310-363` — Add new IPC channels to union type

**Step 1: Add IPC channel types**

In `src/shared/types.ts`, add to the `IpcChannel` union:

```ts
  | 'pipeline:pause'
  | 'pipeline:resume'
  | 'pipeline:pause-all'
  | 'pipeline:context-update'
  | 'usage:get-snapshot'
  | 'usage:snapshot'
```

**Step 2: Add IPC handlers in `registerPipelineIpc`**

In `src/main/index.ts`, inside the `registerPipelineIpc` function, add after the existing `ipcMain.handle` calls:

```ts
  ipcMain.handle('pipeline:pause', async (_e, taskId: number) => {
    if (!currentEngine) throw new Error('Pipeline not initialized')
    return currentEngine.pauseTask(taskId, 'manual')
  })

  ipcMain.handle('pipeline:resume', async (_e, taskId: number) => {
    if (!currentEngine) throw new Error('Pipeline not initialized')
    return currentEngine.resumeTask(taskId)
  })

  ipcMain.handle('pipeline:pause-all', async () => {
    if (!currentEngine) throw new Error('Pipeline not initialized')
    return currentEngine.pauseAllTasks('manual')
  })
```

**Step 3: Wire new pipeline events to renderer**

Inside the `pipeline:init` handler (after line 195), add:

```ts
  currentEngine.on('stage:paused', (data) =>
    mainWindow?.webContents.send('pipeline:status', { type: 'paused', ...data }))
  currentEngine.on('context-update', (data) =>
    mainWindow?.webContents.send('pipeline:context-update', data))
```

**Step 4: Add usage monitor initialization**

In `src/main/index.ts`, import and initialize the usage monitor. Add near the top:

```ts
import { UsageMonitor } from './usage-monitor'
```

Inside `registerPipelineIpc`, after `currentEngine` is created in the `pipeline:init` handler, add:

```ts
  // Usage monitoring
  const usageMonitor = new UsageMonitor()

  usageMonitor.on('snapshot', (snapshot) => {
    mainWindow?.webContents.send('usage:snapshot', snapshot)
  })

  usageMonitor.on('limit-approaching', async (data) => {
    if (!currentEngine) return
    const count = await currentEngine.pauseAllTasks('usage_limit')
    mainWindow?.webContents.send('pipeline:status', {
      type: 'usage-paused',
      pausedCount: count,
      utilization: data.utilization,
      countdown: data.countdown
    })
  })

  usageMonitor.start()

  ipcMain.handle('usage:get-snapshot', () => usageMonitor.getSnapshot())
```

**Step 5: Commit**

```bash
git add src/main/index.ts src/shared/types.ts
git commit -m "feat: wire IPC channels for pause/resume and usage monitoring"
```

---

### Task 9: Update Preload and Type Declarations

**Files:**
- Modify: `src/preload/index.ts:21-50` — Add new pipeline/usage APIs
- Modify: `src/renderer/src/global.d.ts:16-27` — Add types for new APIs

**Step 1: Add to preload pipeline section**

In `src/preload/index.ts`, add to the `pipeline` object (before the closing `},`):

```ts
  pause: (taskId: number) => ipcRenderer.invoke('pipeline:pause', taskId),
  resume: (taskId: number) => ipcRenderer.invoke('pipeline:resume', taskId),
  pauseAll: () => ipcRenderer.invoke('pipeline:pause-all'),
  onContextUpdate: (cb: (data: any) => void) => {
    const handler = (_e: any, data: any) => cb(data)
    ipcRenderer.on('pipeline:context-update', handler)
    return () => ipcRenderer.removeListener('pipeline:context-update', handler)
  },
```

**Step 2: Add usage section to preload**

After the `pipeline` section, add a new `usage` section:

```ts
usage: {
  getSnapshot: () => ipcRenderer.invoke('usage:get-snapshot'),
  onSnapshot: (cb: (data: any) => void) => {
    const handler = (_e: any, data: any) => cb(data)
    ipcRenderer.on('usage:snapshot', handler)
    return () => ipcRenderer.removeListener('usage:snapshot', handler)
  },
},
```

**Step 3: Update global.d.ts**

In `src/renderer/src/global.d.ts`, add to the `pipeline` section:

```ts
  pause: (taskId: number) => Promise<any>
  resume: (taskId: number) => Promise<any>
  pauseAll: () => Promise<number>
  onContextUpdate: (cb: (data: { taskId: number; contextTokens: number; contextMax: number }) => void) => () => void
```

Add a new `usage` section:

```ts
usage: {
  getSnapshot: () => Promise<import('../../../shared/usage-types').UsageSnapshot>
  onSnapshot: (cb: (data: import('../../../shared/usage-types').UsageSnapshot) => void) => () => void
}
```

**Step 4: Commit**

```bash
git add src/preload/index.ts src/renderer/src/global.d.ts
git commit -m "feat: expose pause/resume and usage APIs to renderer"
```

---

### Task 10: Update Pipeline Store for Pause/Resume and Context

**Files:**
- Modify: `src/renderer/src/stores/pipelineStore.ts` — Add context tracking state, pause/resume actions, new event listeners

**Step 1: Add new state fields**

Add to the `PipelineState` interface:

```ts
  contextByTaskId: Record<number, { tokens: number; max: number }>
  usageSnapshot: import('../../../shared/usage-types').UsageSnapshot | null
```

Add initial values:

```ts
  contextByTaskId: {},
  usageSnapshot: null,
```

**Step 2: Add pause/resume actions**

```ts
  pauseTask: async (taskId: number) => {
    await window.api.pipeline.pause(taskId)
  },
  resumeTask: async (taskId: number) => {
    set({ streaming: true, activeTaskId: taskId })
    await window.api.pipeline.resume(taskId)
  },
  pauseAll: async () => {
    await window.api.pipeline.pauseAll()
  },
```

**Step 3: Add context-update and usage listeners in `setupListeners`**

```ts
  const cleanupContext = window.api.pipeline.onContextUpdate((data) => {
    set((state) => ({
      contextByTaskId: {
        ...state.contextByTaskId,
        [data.taskId]: { tokens: data.contextTokens, max: data.contextMax }
      }
    }))
  })

  const cleanupUsage = window.api.usage.onSnapshot((snapshot) => {
    set({ usageSnapshot: snapshot })
  })
```

Add both cleanup functions to the returned cleanup function.

**Step 4: Handle 'paused' and 'usage-paused' status events**

In the existing `onStatusChange` handler, add cases:

```ts
  if (event.type === 'paused') {
    set({ streaming: false })
  }
  if (event.type === 'usage-paused') {
    set({ streaming: false })
    // The event contains pausedCount, utilization, countdown for UI toast
  }
```

**Step 5: Fetch initial usage snapshot in `setupListeners`**

```ts
  window.api.usage.getSnapshot().then((snapshot) => {
    set({ usageSnapshot: snapshot })
  })
```

**Step 6: Commit**

```bash
git add src/renderer/src/stores/pipelineStore.ts
git commit -m "feat: add pause/resume and context tracking to pipeline store"
```

---

### Task 11: Add Paused Column to KanbanBoard

**Files:**
- Modify: `src/renderer/src/components/KanbanBoard/KanbanBoard.tsx:5-15` — Add `'paused'` to COLUMN_ORDER

**Step 1: Add paused to column order**

In `KanbanBoard.tsx`, add `'paused'` after `'blocked'`:

```ts
const COLUMN_ORDER: TaskStatus[] = [
  'backlog',
  'brainstorming',
  'design_review',
  'planning',
  'implementing',
  'code_review',
  'verifying',
  'done',
  'blocked',
  'paused'
]
```

**Step 2: Commit**

```bash
git add src/renderer/src/components/KanbanBoard/KanbanBoard.tsx
git commit -m "feat: add paused column to kanban board"
```

---

### Task 12: Add Context Bar and Pause/Resume Buttons to TaskCard

**Files:**
- Modify: `src/renderer/src/components/KanbanBoard/TaskCard.tsx` — Add context progress bar and pause/resume button
- Modify: `src/renderer/src/index.css` — Add context bar styles

**Step 1: Read `TaskCard.tsx` fully**

Read the complete file to understand the card layout structure.

**Step 2: Add context bar to TaskCard**

Import the pipeline store and add the context bar. After the existing card content (title, tier, agent row), add:

```tsx
// Inside TaskCard component, get context data:
const context = usePipelineStore((s) => s.contextByTaskId[task.id])
const isPaused = task.status === 'paused'
const isRunning = ['brainstorming', 'design_review', 'planning', 'implementing', 'code_review', 'verifying'].includes(task.status)

// Render context bar (only for running tasks):
{context && isRunning && (
  <div className="context-bar" title={`${Math.round(context.tokens / 1000)}k / ${Math.round(context.max / 1000)}k tokens`}>
    <div
      className="context-bar-fill"
      style={{ width: `${Math.min((context.tokens / context.max) * 100, 100)}%` }}
      data-level={context.tokens / context.max > 0.8 ? 'danger' : context.tokens / context.max > 0.5 ? 'warn' : 'ok'}
    />
  </div>
)}
```

**Step 3: Add pause/resume button**

```tsx
// Inline pause button for running tasks:
{isRunning && (
  <button
    className="pause-btn"
    onClick={(e) => { e.stopPropagation(); usePipelineStore.getState().pauseTask(task.id) }}
    title="Pause task"
  >
    ⏸
  </button>
)}

// Resume button for paused tasks:
{isPaused && (
  <button
    className="resume-btn"
    onClick={(e) => { e.stopPropagation(); usePipelineStore.getState().resumeTask(task.id) }}
    title="Resume task"
  >
    ▶
  </button>
)}
```

**Step 4: Add context bar CSS**

In `src/renderer/src/index.css`, add:

```css
.context-bar {
  height: 3px;
  background: rgba(108, 112, 134, 0.3);
  border-radius: 2px;
  overflow: hidden;
  margin-top: 6px;
}

.context-bar-fill {
  height: 100%;
  border-radius: 2px;
  transition: width 0.3s ease;
}

.context-bar-fill[data-level="ok"] {
  background: #a6e3a1;
}

.context-bar-fill[data-level="warn"] {
  background: #f9e2af;
}

.context-bar-fill[data-level="danger"] {
  background: #f38ba8;
}

.pause-btn, .resume-btn {
  opacity: 0;
  transition: opacity 0.15s;
  background: none;
  border: none;
  cursor: pointer;
  font-size: 12px;
  padding: 2px 4px;
  border-radius: 4px;
}

.pause-btn:hover, .resume-btn:hover {
  background: rgba(108, 112, 134, 0.3);
}

/* Show on card hover */
[class*="TaskCard"]:hover .pause-btn,
[class*="TaskCard"]:hover .resume-btn {
  opacity: 1;
}

/* Always show resume on paused cards */
.resume-btn {
  opacity: 1 !important;
}
```

**Step 5: Commit**

```bash
git add src/renderer/src/components/KanbanBoard/TaskCard.tsx src/renderer/src/index.css
git commit -m "feat: add context bar and pause/resume buttons to task cards"
```

---

### Task 13: Add Usage Indicator to TopBar

**Files:**
- Modify: `src/renderer/src/components/Dashboard/TopBar.tsx` — Add usage indicator before settings button

**Step 1: Read TopBar.tsx fully**

Read the complete file to understand the layout.

**Step 2: Add usage indicator**

Import the pipeline store. Before the settings gear button (around line 128), add a usage indicator:

```tsx
{/* Usage indicator */}
{usageSnapshot?.connected && usageSnapshot.fiveHour && (
  <div
    className="flex items-center gap-2 px-3 py-1 rounded-lg text-xs"
    style={{
      background: colors.elevated,
      color: usageSnapshot.fiveHour.utilization > 80 ? colors.accent.red
        : usageSnapshot.fiveHour.utilization > 50 ? colors.accent.gold
        : colors.text.secondary
    }}
    title={`5hr: ${Math.round(usageSnapshot.fiveHour.utilization)}% — resets ${usageSnapshot.fiveHour.countdown}`}
  >
    <span style={{ fontSize: '10px' }}>⚡</span>
    <span>{Math.round(usageSnapshot.fiveHour.utilization)}%</span>
    <span style={{ color: colors.text.muted }}>{usageSnapshot.fiveHour.countdown}</span>
  </div>
)}
```

**Step 3: Add "Pause All" button**

Next to the usage indicator, when any tasks are running:

```tsx
{hasRunningTasks && (
  <button
    onClick={() => usePipelineStore.getState().pauseAll()}
    style={{ background: colors.elevated, color: colors.accent.gold }}
    className="px-3 py-1 rounded-lg text-xs hover:opacity-80"
    title="Pause all running tasks"
  >
    ⏸ Pause All
  </button>
)}
```

Derive `hasRunningTasks` from `useTaskStore`:

```tsx
const tasks = useTaskStore((s) => s.tasks)
const hasRunningTasks = tasks.some(t =>
  ['brainstorming', 'design_review', 'planning', 'implementing', 'code_review', 'verifying'].includes(t.status)
)
const usageSnapshot = usePipelineStore((s) => s.usageSnapshot)
```

**Step 4: Commit**

```bash
git add src/renderer/src/components/Dashboard/TopBar.tsx
git commit -m "feat: add usage indicator and pause all button to top bar"
```

---

### Task 14: Add Pause/Resume to TaskDetail

**Files:**
- Modify: `src/renderer/src/components/TaskDetail/TaskDetail.tsx:204-236` — Add pause/resume buttons to action bar

**Step 1: Update isActive check to handle paused**

At line 141, update:

```ts
const isActive = !isBacklog && !isDone && task.status !== 'blocked' && task.status !== 'paused'
const isPaused = task.status === 'paused'
```

**Step 2: Add pause button for active tasks**

Inside the action buttons `<div>` (after the Retry Stage button, around line 221), add:

```tsx
{isActive && (
  <button
    onClick={() => usePipelineStore.getState().pauseTask(task.id)}
    style={{ background: colors.accent.gold, color: colors.bg }}
    className="px-4 py-2 rounded-lg text-sm font-medium"
  >
    Pause
  </button>
)}
```

**Step 3: Add resume button for paused tasks**

```tsx
{isPaused && (
  <button
    onClick={() => usePipelineStore.getState().resumeTask(task.id)}
    style={{ background: colors.accent.green, color: colors.bg }}
    className="px-4 py-2 rounded-lg text-sm font-medium"
  >
    Resume
  </button>
)}
```

**Step 4: Show pause reason badge**

Near the status badge area, when paused:

```tsx
{isPaused && task.pauseReason && (
  <span className="text-xs px-2 py-0.5 rounded" style={{ background: colors.elevated, color: colors.text.muted }}>
    {task.pauseReason === 'usage_limit' ? 'Usage Limit' : 'Manual Pause'}
  </span>
)}
```

**Step 5: Commit**

```bash
git add src/renderer/src/components/TaskDetail/TaskDetail.tsx
git commit -m "feat: add pause/resume buttons and pause reason to task detail"
```

---

### Task 15: Add Auto-Pause Toast Notification

**Files:**
- Modify: `src/renderer/src/stores/pipelineStore.ts` — Add toast state for usage-paused events
- Modify: `src/renderer/src/App.tsx` — Render toast when auto-pause triggers

**Step 1: Add toast state to pipeline store**

Add to state:

```ts
  usagePausedToast: { pausedCount: number; utilization: number; countdown: string } | null
```

In the `onStatusChange` handler, when `event.type === 'usage-paused'`:

```ts
  set({
    streaming: false,
    usagePausedToast: {
      pausedCount: event.pausedCount,
      utilization: event.utilization,
      countdown: event.countdown
    }
  })
```

Add a dismiss action:

```ts
  dismissUsagePausedToast: () => set({ usagePausedToast: null }),
```

**Step 2: Render toast in App.tsx**

Read `App.tsx` to find the right place. Add a toast component at the top level:

```tsx
const usagePausedToast = usePipelineStore((s) => s.usagePausedToast)
const dismissToast = usePipelineStore((s) => s.dismissUsagePausedToast)

{usagePausedToast && (
  <div className="fixed top-4 right-4 z-50 p-4 rounded-lg shadow-lg max-w-sm"
    style={{ background: colors.elevated, border: `1px solid ${colors.accent.gold}` }}>
    <div className="flex items-start gap-3">
      <span style={{ color: colors.accent.gold }}>⚡</span>
      <div>
        <p className="text-sm font-medium" style={{ color: colors.text.primary }}>
          Usage at {Math.round(usagePausedToast.utilization)}%
        </p>
        <p className="text-xs mt-1" style={{ color: colors.text.secondary }}>
          Paused {usagePausedToast.pausedCount} running task{usagePausedToast.pausedCount !== 1 ? 's' : ''}.
          Resets in {usagePausedToast.countdown}.
        </p>
      </div>
      <button onClick={dismissToast} className="text-xs" style={{ color: colors.text.muted }}>✕</button>
    </div>
  </div>
)}
```

**Step 3: Commit**

```bash
git add src/renderer/src/stores/pipelineStore.ts src/renderer/src/App.tsx
git commit -m "feat: add auto-pause toast notification for usage limits"
```

---

### Task 16: Verify and Fix Integration

**Step 1: Run TypeScript compiler**

```bash
npx tsc --noEmit
```

Fix any type errors.

**Step 2: Run the dev build**

```bash
npm run dev
```

Verify:
- App starts without errors
- Kanban board shows paused column
- Usage indicator appears in top bar (or shows nothing gracefully if no OAuth token)

**Step 3: Manual test — pause/resume**

1. Start an L1 task
2. Wait for it to reach implementing
3. Click pause on the card
4. Verify card moves to paused column
5. Click resume
6. Verify card returns to implementing and agent continues

**Step 4: Verify error handling**

1. Confirm that if keytar/OAuth is unavailable, usage monitor degrades gracefully (no crash, just no indicator)
2. Confirm that pausing a non-running task shows an error (not a crash)

**Step 5: Final commit**

```bash
git add -A
git commit -m "fix: integration fixes for usage-aware pause/resume"
```

---

## Task Dependency Graph

```
Task 1 (types) ──┬── Task 3 (db) ──── Task 4 (engine) ──┬── Task 7 (context wiring) ──── Task 8 (IPC)
                  │                                       │
Task 2 (settings) ┘                   Task 5 (monitor) ──┘── Task 8 (IPC) ──── Task 9 (preload)
                                                                                     │
Task 6 (sdk tokens) ── Task 7 (context wiring)                                      │
                                                                               Task 10 (store)
                                                                                     │
                                                                          ┌──── Task 11 (kanban)
                                                                          ├──── Task 12 (card)
                                                                          ├──── Task 13 (topbar)
                                                                          ├──── Task 14 (detail)
                                                                          └──── Task 15 (toast)
                                                                                     │
                                                                               Task 16 (verify)
```

Tasks 1+2 are independent (parallel). Task 5+6 are independent of 3+4 (parallel). Tasks 11-15 are independent of each other (parallel).
