# Task Execution Order Visibility — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make task execution order obvious to users via sequence numbers, a "NEXT" indicator, and dependency flow arrows — both on the canvas and in the group tab sidebar.

**Architecture:** Compute execution order at runtime using topological sort (Kahn's algorithm) with priority/creation-time tie-breaking. Expose via IPC. Render sequence badges, NEXT pill, and SVG dependency arrows in existing canvas and group tab components.

**Tech Stack:** TypeScript, React, Zustand, Electron IPC, SVG

---

### Task 1: Add `computeExecutionOrder()` to task-graph.ts

**Files:**
- Modify: `src/main/task-graph.ts`

**Step 1: Write the function**

Add to the end of `src/main/task-graph.ts`:

```typescript
const PRIORITY_RANK: Record<string, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3
}

export interface ExecutionOrderResult {
  global: number[]          // all non-done task IDs in execution order
  byGroup: Record<number, number[]>  // groupId -> ordered task IDs within group
}

/**
 * Compute execution order using Kahn's algorithm (topological sort).
 * Tie-breaking: priority (critical first), then createdAt (earliest first).
 */
export function computeExecutionOrder(tasks: Task[]): ExecutionOrderResult {
  // Filter to non-done tasks
  const activeTasks = tasks.filter(t => t.status !== 'done')
  const taskMap = new Map(activeTasks.map(t => [t.id, t]))

  // Build in-degree map
  const inDegree = new Map<number, number>()
  const dependents = new Map<number, number[]>() // depId -> tasks that depend on it

  for (const task of activeTasks) {
    inDegree.set(task.id, 0)
    dependents.set(task.id, [])
  }

  for (const task of activeTasks) {
    const deps = (task.dependencyIds ?? []).filter(id => taskMap.has(id))
    inDegree.set(task.id, deps.length)
    for (const depId of deps) {
      dependents.get(depId)?.push(task.id)
    }
  }

  // Comparator for tie-breaking
  const compare = (a: number, b: number): number => {
    const ta = taskMap.get(a)!
    const tb = taskMap.get(b)!
    const pa = PRIORITY_RANK[ta.priority] ?? 2
    const pb = PRIORITY_RANK[tb.priority] ?? 2
    if (pa !== pb) return pa - pb
    return new Date(ta.createdAt).getTime() - new Date(tb.createdAt).getTime()
  }

  // Kahn's algorithm with sorted frontier
  const result: number[] = []
  const frontier = activeTasks
    .filter(t => inDegree.get(t.id) === 0)
    .map(t => t.id)
    .sort(compare)

  while (frontier.length > 0) {
    const current = frontier.shift()!
    result.push(current)

    for (const depId of dependents.get(current) ?? []) {
      const newDegree = (inDegree.get(depId) ?? 1) - 1
      inDegree.set(depId, newDegree)
      if (newDegree === 0) {
        // Insert in sorted position
        const idx = frontier.findIndex(id => compare(depId, id) < 0)
        if (idx === -1) frontier.push(depId)
        else frontier.splice(idx, 0, depId)
      }
    }
  }

  // Build per-group ordering
  const byGroup: Record<number, number[]> = {}
  for (const taskId of result) {
    const task = taskMap.get(taskId)!
    if (task.groupId != null) {
      if (!byGroup[task.groupId]) byGroup[task.groupId] = []
      byGroup[task.groupId].push(taskId)
    }
  }

  return { global: result, byGroup }
}
```

**Step 2: Commit**

```bash
git add src/main/task-graph.ts
git commit -m "feat: add computeExecutionOrder() with topological sort"
```

---

### Task 2: Expose execution order via IPC

**Files:**
- Modify: `src/main/ipc-handlers.ts`
- Modify: `src/preload/index.ts`

**Step 1: Add IPC handler**

In `src/main/ipc-handlers.ts`, add near the other task handlers:

```typescript
import { computeExecutionOrder } from './task-graph'

ipcMain.handle('tasks:execution-order', (_e, dbPath: string) => {
  const tasks = listTasks(dbPath)
  return computeExecutionOrder(tasks)
})
```

**Step 2: Add preload bridge**

In `src/preload/index.ts`, inside the `tasks` object, add:

```typescript
executionOrder: (dbPath: string) => ipcRenderer.invoke('tasks:execution-order', dbPath),
```

**Step 3: Commit**

```bash
git add src/main/ipc-handlers.ts src/preload/index.ts
git commit -m "feat: expose task execution order via IPC"
```

---

### Task 3: Add execution order state to canvasStore

**Files:**
- Modify: `src/renderer/src/stores/canvasStore.ts`

**Step 1: Add state and refresh logic**

Add to the `CanvasState` interface:

```typescript
executionOrder: number[]               // global ordered task IDs
groupExecutionOrder: Record<number, number[]>  // per-group ordered task IDs
nextTaskId: number | null              // first waiting task in global queue

refreshExecutionOrder: (dbPath: string) => Promise<void>
```

Add defaults in the store creation:

```typescript
executionOrder: [],
groupExecutionOrder: {},
nextTaskId: null,
```

Add the refresh function:

```typescript
refreshExecutionOrder: async (dbPath: string) => {
  const result = await window.api.tasks.executionOrder(dbPath)
  // Find first task that is not currently running (status != implementing/brainstorming/etc)
  // The "next" task is the first backlog task in the global order
  const allTasks = await window.api.tasks.list(dbPath)
  const taskMap = new Map(allTasks.map(t => [t.id, t]))
  const runningStatuses = new Set(['brainstorming', 'design_review', 'planning', 'implementing', 'code_review', 'verifying'])
  const nextId = result.global.find(id => {
    const t = taskMap.get(id)
    return t && t.status === 'backlog'
  }) ?? null

  set({
    executionOrder: result.global,
    groupExecutionOrder: result.byGroup,
    nextTaskId: nextId
  })
},
```

**Step 2: Call refreshExecutionOrder inside refreshAll**

At the end of the existing `refreshAll` method, after the `set(...)` call, add:

```typescript
// Refresh execution order
const orderResult = await window.api.tasks.executionOrder(dbPath)
const taskMap = new Map(tasks.map(t => [t.id, t]))
const nextId = orderResult.global.find(id => {
  const t = taskMap.get(id)
  return t && t.status === 'backlog'
}) ?? null

set((s) => ({
  ...s,
  executionOrder: orderResult.global,
  groupExecutionOrder: orderResult.byGroup,
  nextTaskId: nextId
}))
```

**Step 3: Commit**

```bash
git add src/renderer/src/stores/canvasStore.ts
git commit -m "feat: store computed execution order in canvasStore"
```

---

### Task 4: Add sequence number badges to CanvasTaskLane

**Files:**
- Modify: `src/renderer/src/components/Canvas/CanvasTaskLane.tsx`

**Step 1: Add sequence number badge**

Import the canvasStore at the top:

```typescript
import { useCanvasStore } from '../../stores/canvasStore'
```

Inside the `CanvasTaskLane` component, before the `content` variable, compute the position:

```typescript
const executionOrder = useCanvasStore((s) => s.executionOrder)
const groupExecutionOrder = useCanvasStore((s) => s.groupExecutionOrder)
const nextTaskId = useCanvasStore((s) => s.nextTaskId)

// Determine sequence number (within-group for grouped, global for standalone)
const orderList = task.groupId != null
  ? (groupExecutionOrder[task.groupId] ?? [])
  : executionOrder
const seqIndex = orderList.indexOf(task.id)
const seqNumber = seqIndex >= 0 ? seqIndex + 1 : null

const isNext = task.id === nextTaskId
const isRunning = ['brainstorming', 'design_review', 'planning', 'implementing', 'code_review', 'verifying'].includes(task.status)
const isBlocked = task.status === 'blocked'
const isDone = task.status === 'done'
```

In the `content` JSX, add the sequence badge and NEXT pill before the title. Replace the existing title row:

```tsx
<div className="flex items-center justify-between gap-2 mb-0.5">
  <div className="flex items-center gap-1.5 min-w-0">
    {/* Sequence number badge */}
    {seqNumber != null && !isDone && (
      <span
        className="flex-shrink-0 text-[9px] font-bold w-4 h-4 flex items-center justify-center rounded"
        style={{
          backgroundColor: isRunning
            ? 'color-mix(in srgb, var(--color-accent-cyan) 20%, transparent)'
            : isBlocked
              ? 'color-mix(in srgb, var(--color-text-muted) 15%, transparent)'
              : 'color-mix(in srgb, var(--color-text-primary) 15%, transparent)',
          color: isRunning
            ? 'var(--color-accent-cyan)'
            : isBlocked
              ? 'var(--color-text-muted)'
              : 'var(--color-text-primary)',
        }}
      >
        {seqNumber}
      </span>
    )}
    {/* NEXT pill */}
    {isNext && (
      <span
        className="flex-shrink-0 text-[8px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full"
        style={{
          backgroundColor: 'color-mix(in srgb, var(--color-accent-cyan) 20%, transparent)',
          color: 'var(--color-accent-cyan)',
          border: '1px solid color-mix(in srgb, var(--color-accent-cyan) 35%, transparent)',
        }}
      >
        next
      </span>
    )}
    <span
      className="text-xs font-medium truncate"
      style={{ color: 'var(--color-text-primary)' }}
    >
      {task.title}
    </span>
  </div>
  {task.currentAgent && (
    <span
      className="text-[10px] px-1.5 py-0.5 rounded-full shrink-0"
      style={{
        backgroundColor: 'var(--color-accent-cyan)22',
        color: 'var(--color-accent-cyan)'
      }}
    >
      {task.currentAgent}
    </span>
  )}
</div>
```

**Step 2: Commit**

```bash
git add src/renderer/src/components/Canvas/CanvasTaskLane.tsx
git commit -m "feat: add sequence number and NEXT badge to canvas task lanes"
```

---

### Task 5: Add sequence numbers and connector lines to GroupTab

**Files:**
- Modify: `src/renderer/src/components/WorkshopPanel/GroupTab.tsx`

**Step 1: Add sequence badge to TaskCard**

Update `TaskCard` to accept and display a sequence number and next/blocked state. Add new props:

```typescript
function TaskCard({
  task,
  contextTokens,
  contextMax,
  seqNumber,
  isNext,
}: {
  task: Task
  contextTokens?: number
  contextMax?: number
  seqNumber?: number | null
  isNext?: boolean
})
```

In the TaskCard JSX, add the badge before the title in Row 1:

```tsx
{/* Row 1: Seq + Title + stage chip */}
<div className="flex items-start gap-2">
  <div className="flex-1 min-w-0">
    <div className="flex items-center gap-1.5">
      {seqNumber != null && task.status !== 'done' && (
        <span
          className="flex-shrink-0 text-[9px] font-bold w-4 h-4 flex items-center justify-center rounded"
          style={{
            backgroundColor: ['brainstorming', 'design_review', 'planning', 'implementing', 'code_review', 'verifying'].includes(task.status)
              ? 'color-mix(in srgb, var(--color-accent-cyan) 20%, transparent)'
              : task.status === 'blocked'
                ? 'color-mix(in srgb, var(--color-text-muted) 15%, transparent)'
                : 'color-mix(in srgb, var(--color-text-primary) 15%, transparent)',
            color: ['brainstorming', 'design_review', 'planning', 'implementing', 'code_review', 'verifying'].includes(task.status)
              ? 'var(--color-accent-cyan)'
              : task.status === 'blocked'
                ? 'var(--color-text-muted)'
                : 'var(--color-text-primary)',
          }}
        >
          {seqNumber}
        </span>
      )}
      {isNext && (
        <span
          className="flex-shrink-0 text-[8px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full"
          style={{
            backgroundColor: 'color-mix(in srgb, var(--color-accent-cyan) 20%, transparent)',
            color: 'var(--color-accent-cyan)',
            border: '1px solid color-mix(in srgb, var(--color-accent-cyan) 35%, transparent)',
          }}
        >
          next
        </span>
      )}
      <p
        className="text-[11px] font-medium leading-tight truncate"
        style={{ color: 'var(--color-text-primary)' }}
      >
        {task.title}
      </p>
    </div>
    ...existing agent name...
  </div>
  ...existing stage badge...
</div>
```

**Step 2: Add dependency connector lines to GroupSection**

In `GroupSection`, import canvasStore and compute ordering:

```typescript
const groupExecutionOrder = useCanvasStore((s) => s.groupExecutionOrder)
const nextTaskId = useCanvasStore((s) => s.nextTaskId)
const orderList = groupExecutionOrder[group.id] ?? []
```

Replace the task card mapping to include connectors and sequence data:

```tsx
{tasks.length > 0 ? (
  <div className="flex flex-col gap-0 pl-2">
    {tasks
      .sort((a, b) => {
        const ai = orderList.indexOf(a.id)
        const bi = orderList.indexOf(b.id)
        return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi)
      })
      .map((task, index) => {
        const ctx = contextByTaskId[task.id]
        const seqIndex = orderList.indexOf(task.id)
        const seqNumber = seqIndex >= 0 ? seqIndex + 1 : null
        const isNext = task.id === nextTaskId
        const isLast = index === tasks.length - 1
        const hasDeps = (task.dependencyIds ?? []).length > 0
        const depsAllDone = (task.dependencyIds ?? []).every(depId =>
          tasks.find(t => t.id === depId)?.status === 'done'
        )

        return (
          <div key={task.id} className="relative">
            {/* Connector line from previous task */}
            {index > 0 && (
              <div
                className="absolute left-[7px] -top-1 w-0.5 h-2"
                style={{
                  backgroundColor: hasDeps && !depsAllDone
                    ? 'var(--color-accent-amber)'
                    : 'var(--color-accent-green)',
                  opacity: 0.5
                }}
              />
            )}
            {/* Connector dot */}
            {tasks.length > 1 && (
              <div
                className="absolute left-[4px] top-3 w-2 h-2 rounded-full"
                style={{
                  backgroundColor: hasDeps && !depsAllDone
                    ? 'var(--color-accent-amber)'
                    : 'var(--color-accent-green)',
                  opacity: 0.6
                }}
              />
            )}
            {/* Connector line to next task */}
            {!isLast && (
              <div
                className="absolute left-[7px] bottom-0 w-0.5 h-2"
                style={{
                  backgroundColor: 'var(--color-accent-green)',
                  opacity: 0.3
                }}
              />
            )}
            <div className={tasks.length > 1 ? 'ml-5 mb-2' : 'mb-2'}>
              <TaskCard
                task={task}
                contextTokens={ctx?.tokens}
                contextMax={ctx?.max}
                seqNumber={seqNumber}
                isNext={isNext}
              />
              {/* Blocked-by badge */}
              {hasDeps && !depsAllDone && (
                <div
                  className="text-[9px] mt-1 px-1.5 py-0.5 rounded"
                  style={{
                    color: 'var(--color-accent-amber)',
                    backgroundColor: 'color-mix(in srgb, var(--color-accent-amber) 10%, transparent)',
                  }}
                >
                  Blocked by #{tasks.find(t => task.dependencyIds?.includes(t.id) && t.status !== 'done')
                    ? orderList.indexOf(tasks.find(t => task.dependencyIds?.includes(t.id) && t.status !== 'done')!.id) + 1
                    : '?'}
                </div>
              )}
            </div>
          </div>
        )
      })}
  </div>
) : (
  ...existing empty state...
)}
```

**Step 3: Commit**

```bash
git add src/renderer/src/components/WorkshopPanel/GroupTab.tsx
git commit -m "feat: add sequence numbers and dependency connectors to GroupTab"
```

---

### Task 6: Create CanvasDependencyArrows component

**Files:**
- Create: `src/renderer/src/components/Canvas/CanvasDependencyArrows.tsx`

**Step 1: Create the SVG overlay component**

```typescript
import { useEffect, useRef, useState } from 'react'
import { useCanvasStore } from '../../stores/canvasStore'

interface Arrow {
  fromId: number
  toId: number
  satisfied: boolean
}

interface Point {
  x: number
  y: number
}

export function CanvasDependencyArrows() {
  const groups = useCanvasStore((s) => s.groups)
  const groupTasks = useCanvasStore((s) => s.groupTasks)
  const standaloneTasks = useCanvasStore((s) => s.standaloneTasks)
  const [arrows, setArrows] = useState<(Arrow & { from: Point; to: Point })[]>([])
  const containerRef = useRef<HTMLDivElement>(null)

  // Collect all tasks
  const allTasks = [
    ...standaloneTasks,
    ...groups.flatMap(g => groupTasks[g.id] ?? [])
  ]

  useEffect(() => {
    // Build arrow list from dependency relationships
    const arrowDefs: Arrow[] = []
    const taskMap = new Map(allTasks.map(t => [t.id, t]))

    for (const task of allTasks) {
      for (const depId of task.dependencyIds ?? []) {
        if (taskMap.has(depId)) {
          arrowDefs.push({
            fromId: depId,
            toId: task.id,
            satisfied: taskMap.get(depId)!.status === 'done'
          })
        }
      }
    }

    if (arrowDefs.length === 0) {
      setArrows([])
      return
    }

    // Compute positions from DOM using data-task-id attributes
    const parent = containerRef.current?.closest('[data-canvas-content]')
    if (!parent) return

    const computed = arrowDefs
      .map(arrow => {
        const fromEl = parent.querySelector(`[data-task-id="${arrow.fromId}"]`)
        const toEl = parent.querySelector(`[data-task-id="${arrow.toId}"]`)
        if (!fromEl || !toEl) return null

        const parentRect = parent.getBoundingClientRect()
        const fromRect = fromEl.getBoundingClientRect()
        const toRect = toEl.getBoundingClientRect()

        return {
          ...arrow,
          from: {
            x: fromRect.right - parentRect.left,
            y: fromRect.top + fromRect.height / 2 - parentRect.top
          },
          to: {
            x: toRect.left - parentRect.left,
            y: toRect.top + toRect.height / 2 - parentRect.top
          }
        }
      })
      .filter(Boolean) as (Arrow & { from: Point; to: Point })[]

    setArrows(computed)
  }, [allTasks.map(t => `${t.id}-${t.status}`).join(',')])

  if (arrows.length === 0) return null

  return (
    <div ref={containerRef} className="absolute inset-0 pointer-events-none" style={{ zIndex: 0 }}>
      <svg className="absolute inset-0 w-full h-full overflow-visible">
        <defs>
          <marker
            id="arrow-green"
            markerWidth="6"
            markerHeight="4"
            refX="5"
            refY="2"
            orient="auto"
          >
            <polygon points="0 0, 6 2, 0 4" fill="var(--color-accent-green)" opacity="0.6" />
          </marker>
          <marker
            id="arrow-amber"
            markerWidth="6"
            markerHeight="4"
            refX="5"
            refY="2"
            orient="auto"
          >
            <polygon points="0 0, 6 2, 0 4" fill="var(--color-accent-amber)" opacity="0.6" />
          </marker>
        </defs>
        {arrows.map((arrow, i) => {
          const midX = (arrow.from.x + arrow.to.x) / 2
          const color = arrow.satisfied ? 'var(--color-accent-green)' : 'var(--color-accent-amber)'
          const markerId = arrow.satisfied ? 'arrow-green' : 'arrow-amber'

          return (
            <path
              key={i}
              d={`M ${arrow.from.x} ${arrow.from.y} C ${midX} ${arrow.from.y}, ${midX} ${arrow.to.y}, ${arrow.to.x} ${arrow.to.y}`}
              fill="none"
              stroke={color}
              strokeWidth="1.5"
              strokeOpacity="0.5"
              markerEnd={`url(#${markerId})`}
            />
          )
        })}
      </svg>
    </div>
  )
}
```

**Step 2: Commit**

```bash
git add src/renderer/src/components/Canvas/CanvasDependencyArrows.tsx
git commit -m "feat: create CanvasDependencyArrows SVG overlay component"
```

---

### Task 7: Wire dependency arrows into Canvas and add data-task-id attributes

**Files:**
- Modify: `src/renderer/src/components/Canvas/Canvas.tsx`
- Modify: `src/renderer/src/components/Canvas/CanvasTaskLane.tsx`

**Step 1: Add data-task-id to CanvasTaskLane**

In `CanvasTaskLane.tsx`, add the `data-task-id` attribute to the outermost wrapper. For standalone tasks, on the outer `<div>`. For grouped tasks, on the inner `<div>`.

For the standalone wrapper:
```tsx
<div
  data-task-id={task.id}
  className="p-3 rounded-lg"
  ...
>
```

For the grouped wrapper:
```tsx
return <div data-task-id={task.id} className="p-2">{content}</div>
```

**Step 2: Add CanvasDependencyArrows to Canvas**

In `Canvas.tsx`, import the component:

```typescript
import { CanvasDependencyArrows } from './CanvasDependencyArrows'
```

Inside the `data-canvas-content` div, add the arrows overlay as the first child (so it renders behind content):

```tsx
<div
  data-canvas-content
  style={{
    transform: `translate(${panX}px, ${panY}px) scale(${zoom})`,
    transformOrigin: '0 0',
    willChange: 'transform'
  }}
>
  <CanvasDependencyArrows />
  {hasContent ? (
    ...existing content...
  ) : (
    ...existing empty state...
  )}
</div>
```

**Step 3: Commit**

```bash
git add src/renderer/src/components/Canvas/Canvas.tsx src/renderer/src/components/Canvas/CanvasTaskLane.tsx
git commit -m "feat: wire dependency arrows into canvas with data-task-id attributes"
```

---

### Task 8: Build and verify

**Files:**
- None (verification only)

**Step 1: Build the project**

```bash
npm run build
```

Expected: Clean build with no TypeScript errors.

**Step 2: Verify visually**

Launch the app and check:
- Task cards show sequence numbers (#1, #2, #3)
- The first backlog task shows a cyan "NEXT" pill
- Group tab sidebar shows ordered tasks with connector lines
- Canvas shows SVG arrows between dependent tasks (green = done, amber = blocking)
- Numbers update when a task completes

**Step 3: Final commit if any fixes needed**

```bash
git add -A
git commit -m "fix: address any build issues from execution order feature"
```
