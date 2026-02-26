# Task Todo List Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Capture Claude's internal TaskCreate/TodoWrite/TaskUpdate tool calls during pipeline runs and display them as a read-only, per-task, stage-grouped checklist in the UI.

**Architecture:** Parse `tool_use` blocks in the SDK runner, persist todos as a JSON column on the tasks table keyed by pipeline stage, stream updates over a new IPC channel, and render as a compact badge on kanban cards + collapsible accordion in task detail.

**Tech Stack:** Electron IPC, better-sqlite3, Zustand, React/Tailwind

**Design Doc:** `docs/plans/2026-02-25-task-todo-list-design.md`

---

### Task 1: Add TodoItem type and extend Task interface

**Files:**
- Modify: `src/shared/types.ts:74-102` (Task interface)

**Step 1: Add TodoItem interface**

Add after the `AgentLogEntry` interface (around line 43):

```typescript
export interface TodoItem {
  id: string
  subject: string
  status: 'pending' | 'in_progress' | 'completed'
  createdAt: string
  updatedAt: string
}
```

**Step 2: Add todos field to Task interface**

Add after the `agentLog` field (line 101):

```typescript
todos: Record<string, TodoItem[]> | null
```

**Step 3: Commit**

```bash
git add src/shared/types.ts
git commit -m "feat(types): add TodoItem interface and todos field to Task"
```

---

### Task 2: Add DB migration and wire todos through data layer

**Files:**
- Modify: `src/main/db.ts:425-431` (migrateTasksTable)
- Modify: `src/main/db.ts:448-478` (rowToTask)
- Modify: `src/main/db.ts:85-103` (handleRestart reset in TaskDetail — will be handled in Task 7)

**Step 1: Add migration for todos column**

In `migrateTasksTable()`, add after the `pr_url` migration (around line 431):

```typescript
if (!colNames.has('todos')) db.prepare('ALTER TABLE tasks ADD COLUMN todos TEXT').run()
```

**Step 2: Add todos to rowToTask conversion**

In `rowToTask()`, add after the `agentLog` line (around line 477):

```typescript
todos: safeJsonParse(row.todos) ?? null
```

**Step 3: Verify updateTask handles todos automatically**

The existing `updateTask()` function already handles any key via `camelToSnake()` and `JSON.stringify()` for objects. No changes needed — passing `{ todos: {...} }` will serialize correctly.

**Step 4: Commit**

```bash
git add src/main/db.ts
git commit -m "feat(db): add todos column migration and row mapping"
```

---

### Task 3: Parse todo tool_use blocks in SDK runner

**Files:**
- Modify: `src/main/sdk-manager.ts:177-202` (tool_use block handler)

**Step 1: Add todo parser helper above the run function**

Add a helper that extracts todo data from tool_use blocks. Place it near the top of the file (after imports):

```typescript
interface ParsedTodo {
  type: 'create' | 'update' | 'write'
  item?: { id: string; subject: string; status: 'pending' | 'in_progress' | 'completed' }
  items?: { id: string; subject: string; status: 'pending' | 'in_progress' | 'completed' }[]
}

function parseTodoToolUse(toolName: string, input: any): ParsedTodo | null {
  if (toolName === 'TaskCreate' || toolName === 'TodoCreate') {
    return {
      type: 'create',
      item: {
        id: input.taskId || input.id || crypto.randomUUID(),
        subject: input.subject || input.title || input.description || 'Untitled',
        status: 'pending'
      }
    }
  }
  if (toolName === 'TaskUpdate' || toolName === 'TodoUpdate') {
    return {
      type: 'update',
      item: {
        id: input.taskId || input.id || '',
        subject: input.subject || input.title || '',
        status: input.status || 'pending'
      }
    }
  }
  if (toolName === 'TodoWrite') {
    const todos = Array.isArray(input.todos) ? input.todos : []
    return {
      type: 'write',
      items: todos.map((t: any) => ({
        id: t.id || crypto.randomUUID(),
        subject: t.subject || t.title || t.content || 'Untitled',
        status: t.status || 'pending'
      }))
    }
  }
  return null
}
```

**Step 2: Add todo state tracking and emit logic inside the run function**

Inside the function that runs SDK sessions, before the message loop, add state tracking:

```typescript
const todoState: Record<string, Array<{ id: string; subject: string; status: string; createdAt: string; updatedAt: string }>> = {}
let todoPersistTimer: ReturnType<typeof setTimeout> | null = null
const currentStage = params.stage || 'implement'
```

**Step 3: Intercept todo tool_use blocks in the existing loop**

Inside the `else if (block.type === 'tool_use')` branch (around line 191), add before the existing `params.onStream` call:

```typescript
const parsed = parseTodoToolUse(block.name, block.input)
if (parsed) {
  const now = new Date().toISOString()
  if (!todoState[currentStage]) todoState[currentStage] = []
  const stageTodos = todoState[currentStage]

  if (parsed.type === 'create' && parsed.item) {
    stageTodos.push({ ...parsed.item, createdAt: now, updatedAt: now })
  } else if (parsed.type === 'update' && parsed.item) {
    const existing = stageTodos.find(t => t.id === parsed.item!.id)
    if (existing) {
      if (parsed.item.subject) existing.subject = parsed.item.subject
      if (parsed.item.status) existing.status = parsed.item.status
      existing.updatedAt = now
    }
  } else if (parsed.type === 'write' && parsed.items) {
    todoState[currentStage] = parsed.items.map(t => ({ ...t, createdAt: now, updatedAt: now }))
  }

  // Emit to renderer
  win.webContents.send('pipeline:todos-updated', {
    taskId: params.taskId,
    stage: currentStage,
    todos: todoState[currentStage]
  })

  // Debounced persist to DB
  if (todoPersistTimer) clearTimeout(todoPersistTimer)
  todoPersistTimer = setTimeout(() => {
    const dbPath = params.dbPath
    if (dbPath) {
      const { updateTask } = require('./db')
      updateTask(dbPath, params.taskId, { todos: todoState })
    }
  }, 500)
}
```

**Step 4: Commit**

```bash
git add src/main/sdk-manager.ts
git commit -m "feat(sdk): parse TaskCreate/TodoWrite tool calls and emit todo updates"
```

---

### Task 4: Register IPC channel in preload

**Files:**
- Modify: `src/preload/index.ts:27-41` (pipeline section)

**Step 1: Add onTodosUpdated listener**

Add inside the `pipeline` namespace, after `onStatusChange` (around line 41):

```typescript
onTodosUpdated: (callback: (event: any) => void) => {
  const handler = (_e: any, data: any) => callback(data)
  ipcRenderer.on('pipeline:todos-updated', handler)
  return () => { ipcRenderer.removeListener('pipeline:todos-updated', handler) }
},
```

**Step 2: Commit**

```bash
git add src/preload/index.ts
git commit -m "feat(preload): register pipeline:todos-updated IPC channel"
```

---

### Task 5: Add todos state to pipeline store

**Files:**
- Modify: `src/renderer/src/stores/pipelineStore.ts:1-105`

**Step 1: Add todos state and setter**

Add to the `PipelineState` interface:

```typescript
todosByTaskId: Record<number, Record<string, any[]>>
```

Add to the initial state:

```typescript
todosByTaskId: {},
```

**Step 2: Add listener in setupListeners**

Inside `setupListeners()`, after the `cleanupStatus` listener, add:

```typescript
const cleanupTodos = window.api.pipeline.onTodosUpdated((event: any) => {
  set(state => ({
    todosByTaskId: {
      ...state.todosByTaskId,
      [event.taskId]: {
        ...(state.todosByTaskId[event.taskId] || {}),
        [event.stage]: event.todos
      }
    }
  }))
})
```

Update the cleanup return to include it:

```typescript
return () => {
  cleanupStream()
  cleanupApproval()
  cleanupStatus()
  cleanupTodos()
}
```

**Step 3: Commit**

```bash
git add src/renderer/src/stores/pipelineStore.ts
git commit -m "feat(store): add todosByTaskId state and IPC listener"
```

---

### Task 6: Add todo progress badge to TaskCard

**Files:**
- Modify: `src/renderer/src/components/KanbanBoard/TaskCard.tsx:1-68`

**Step 1: Import pipeline store and add todo count helper**

Add import at top:

```typescript
import { usePipelineStore } from '../../stores/pipelineStore'
```

Add helper function after `timeInStage`:

```typescript
function todoCounts(todos: Record<string, any[]> | undefined, status: string | undefined): { done: number; total: number } | null {
  if (!todos) return null
  // Find the current stage's todos (last populated stage)
  const stages = ['brainstorm', 'design_review', 'plan', 'implement', 'code_review', 'verify']
  const currentStage = stages.reverse().find(s => todos[s]?.length > 0)
  if (!currentStage) return null
  const items = todos[currentStage]
  return {
    done: items.filter((t: any) => t.status === 'completed').length,
    total: items.length
  }
}
```

**Step 2: Use in component**

Inside the `TaskCard` component, after the existing store hooks:

```typescript
const todosByTaskId = usePipelineStore((s) => s.todosByTaskId)
const counts = todoCounts(todosByTaskId[task.id] || (task.todos ?? undefined), task.status)
```

**Step 3: Add badge to JSX**

Add in the agent + time row, before the time span:

```tsx
{counts && counts.total > 0 && (
  <span className="text-xs text-text-muted">
    {counts.done}/{counts.total} tasks
  </span>
)}
```

**Step 4: Commit**

```bash
git add src/renderer/src/components/KanbanBoard/TaskCard.tsx
git commit -m "feat(ui): add todo progress badge to kanban task card"
```

---

### Task 7: Add TodoAccordion component to task detail

**Files:**
- Create: `src/renderer/src/components/TaskDetail/TodoAccordion.tsx`
- Modify: `src/renderer/src/components/TaskDetail/TaskDetail.tsx:237-260` (insert before Live Output)

**Step 1: Create TodoAccordion component**

```typescript
import { useState } from 'react'
import type { TodoItem } from '../../../../shared/types'

const stageLabels: Record<string, string> = {
  brainstorm: 'Brainstorming',
  design_review: 'Design Review',
  plan: 'Planning',
  implement: 'Implementing',
  code_review: 'Code Review',
  verify: 'Verifying'
}

const stageOrder = ['verify', 'code_review', 'implement', 'plan', 'design_review', 'brainstorm']

function StatusIcon({ status }: { status: string }) {
  if (status === 'completed') return <span className="text-accent-green">✓</span>
  if (status === 'in_progress') return <span className="text-accent-teal animate-pulse">●</span>
  return <span className="text-text-muted">○</span>
}

export function TodoAccordion({ todos, currentStage }: { todos: Record<string, TodoItem[]>; currentStage?: string }) {
  const populatedStages = stageOrder.filter(s => todos[s]?.length > 0)
  const [expanded, setExpanded] = useState<Set<string>>(
    new Set(currentStage && todos[currentStage] ? [currentStage] : populatedStages.slice(0, 1))
  )

  if (populatedStages.length === 0) return null

  const toggle = (stage: string) => {
    setExpanded(prev => {
      const next = new Set(prev)
      next.has(stage) ? next.delete(stage) : next.add(stage)
      return next
    })
  }

  return (
    <div className="space-y-2">
      <h2 className="text-sm font-semibold text-text-muted uppercase tracking-wide">Task Progress</h2>
      {populatedStages.map(stage => {
        const items = todos[stage]
        const done = items.filter(t => t.status === 'completed').length
        const allDone = done === items.length
        const isOpen = expanded.has(stage)

        return (
          <div key={stage} className="bg-elevated rounded-lg overflow-hidden">
            <button
              onClick={() => toggle(stage)}
              className="w-full flex items-center justify-between px-4 py-2.5 text-sm hover:bg-surface transition-colors"
            >
              <span className="flex items-center gap-2">
                <span className="text-text-muted">{isOpen ? '▼' : '▶'}</span>
                <span className="text-text-primary font-medium">{stageLabels[stage] || stage}</span>
                <span className="text-text-muted">({done}/{items.length})</span>
              </span>
              {allDone && <span className="text-accent-green text-xs">✓</span>}
            </button>
            {isOpen && (
              <div className="px-4 pb-3 space-y-1.5">
                {items.map(item => (
                  <div key={item.id} className="flex items-start gap-2 text-sm">
                    <StatusIcon status={item.status} />
                    <span className={item.status === 'completed' ? 'text-text-muted line-through' : 'text-text-primary'}>
                      {item.subject}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
```

**Step 2: Import and render in TaskDetail**

In `TaskDetail.tsx`, add import:

```typescript
import { TodoAccordion } from './TodoAccordion'
import { usePipelineStore } from '../../stores/pipelineStore'
```

Add store hook inside the component:

```typescript
const todosByTaskId = usePipelineStore((s) => s.todosByTaskId)
```

Add JSX before the Live Output section (around line 237). Merge live todos with persisted:

```tsx
{(() => {
  const liveTodos = todosByTaskId[task.id]
  const persistedTodos = task.todos
  const merged = { ...(persistedTodos || {}), ...(liveTodos || {}) }
  return Object.keys(merged).length > 0 ? (
    <TodoAccordion todos={merged} currentStage={task.status === 'implementing' ? 'implement' : undefined} />
  ) : null
})()}
```

**Step 3: Add todos to the reset handler**

In the `handleRestart` function (around line 85), add `todos: null` to the update object.

**Step 4: Commit**

```bash
git add src/renderer/src/components/TaskDetail/TodoAccordion.tsx src/renderer/src/components/TaskDetail/TaskDetail.tsx
git commit -m "feat(ui): add TodoAccordion component to task detail view"
```

---

### Task 8: Hydrate todos from DB on app load

**Files:**
- Modify: `src/renderer/src/stores/pipelineStore.ts`

**Step 1: Add hydration from task data**

The task store already loads full task records (including the new `todos` field) via `loadTasks()`. The `todosByTaskId` in the pipeline store is for *live* streaming updates. On load, the `TaskCard` and `TaskDetail` components merge both sources:

```typescript
// Already handled in Task 6 (TaskCard) and Task 7 (TaskDetail):
const merged = { ...(task.todos || {}), ...(liveTodos || {}) }
```

No additional hydration logic needed — the DB-persisted todos come through the `Task` object, and live todos come through the pipeline store. The merge in the components handles both.

**Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

**Step 3: Commit (if any fixes needed)**

```bash
git add -A && git commit -m "fix: resolve any TypeScript errors from todo integration"
```

---

### Task 9: Build verification and final test

**Step 1: Clear caches**

```bash
rm -rf .next/ node_modules/.cache/ dist/ .turbo/
```

**Step 2: Full build**

```bash
npm run build
```

**Step 3: Manual verification checklist**

- [ ] App starts without errors
- [ ] Kanban board renders (no regressions)
- [ ] Task cards show no badge when no todos exist
- [ ] Start a pipeline run — verify tool_use blocks are parsed
- [ ] Todo badge appears on card during pipeline run
- [ ] Click into task detail — TodoAccordion renders
- [ ] Accordion expands/collapses correctly
- [ ] Restart app — persisted todos still show
- [ ] Reset task — todos are cleared

**Step 4: Final commit**

```bash
git add -A && git commit -m "feat: task todo list — live Claude progress display"
```

---

## File Ownership Summary

| File | Tasks |
|------|-------|
| `src/shared/types.ts` | 1 |
| `src/main/db.ts` | 2 |
| `src/main/sdk-manager.ts` | 3 |
| `src/preload/index.ts` | 4 |
| `src/renderer/src/stores/pipelineStore.ts` | 5, 8 |
| `src/renderer/src/components/KanbanBoard/TaskCard.tsx` | 6 |
| `src/renderer/src/components/TaskDetail/TodoAccordion.tsx` | 7 (new) |
| `src/renderer/src/components/TaskDetail/TaskDetail.tsx` | 7 |
