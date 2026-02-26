# Task Card UX Improvements Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add awaiting-approval glow effect on Kanban cards, collapsible Done column with archive system, and newest-first sorting across all columns.

**Architecture:** Pure frontend changes. New `archivedAt` field on Task type flows through to backend persistence. Glow uses CSS keyframes + conditional Tailwind class. Archive drawer follows the ActivityFeed toggle pattern (layoutStore boolean + conditional render). Sorting is applied at the KanbanBoard level before passing tasks to columns.

**Tech Stack:** React, Zustand, Tailwind CSS, Electron IPC (for persist)

**Design doc:** `docs/plans/2026-02-26-task-card-ux-improvements-design.md`

---

### Task 1: Add glow-pulse keyframes to CSS

**Files:**
- Modify: `src/renderer/src/index.css`

**Step 1: Add the keyframes animation after the `@theme` block**

Add after the closing `}` of the `@theme` block:

```css
@keyframes glow-pulse {
  0%, 100% {
    box-shadow: 0 0 8px 2px rgba(249, 226, 175, 0.3);
  }
  50% {
    box-shadow: 0 0 16px 6px rgba(249, 226, 175, 0.6);
  }
}
```

**Step 2: Verify the animation renders**

Temporarily add the class to any element to visually confirm the glow looks right. Remove after confirming.

**Step 3: Commit**

```bash
git add src/renderer/src/index.css
git commit -m "style: add glow-pulse keyframes for awaiting-approval effect"
```

---

### Task 2: Expose awaitingReview to TaskCard and apply glow

**Files:**
- Modify: `src/renderer/src/components/KanbanBoard/TaskCard.tsx`
- Modify: `src/renderer/src/stores/pipelineStore.ts`

**Step 1: Ensure awaitingReview is accessible from pipelineStore**

The store already has `awaitingReview: Record<number, boolean>` at line 9. TaskCard already imports `usePipelineStore` (line 43). Just need to subscribe to the right slice.

In `TaskCard.tsx`, add after existing store subscriptions (~line 46):

```tsx
const awaitingReview = usePipelineStore((s) => s.awaitingReview[task.id] ?? false)
```

**Step 2: Also check handoff-based awaiting review**

The `isAwaitingReviewFromHandoffs` function lives in `InterventionPanel.tsx` (lines 21-31). Extract it to a shared utility so TaskCard can use it too.

Create: `src/renderer/src/utils/taskHelpers.ts`

```tsx
import type { Task } from '@shared/types'

export function isAwaitingReviewFromHandoffs(task: Task): boolean {
  if (!task.handoffs || task.handoffs.length === 0) return false
  const lastHandoff = task.handoffs[task.handoffs.length - 1]
  const reviewStages = ['brainstorming', 'planning', 'design_review', 'code_review']
  return (
    lastHandoff.status === 'completed' &&
    reviewStages.includes(task.status) &&
    (!lastHandoff.openQuestions || lastHandoff.openQuestions.length === 0)
  )
}
```

Update `InterventionPanel.tsx` to import from the shared util instead of its local copy.

**Step 3: Apply glow class in TaskCard**

In `TaskCard.tsx`, compute the combined awaiting state and apply to the card div:

```tsx
const isAwaitingFromHandoffs = isAwaitingReviewFromHandoffs(task)
const isAwaiting = awaitingReview || isAwaitingFromHandoffs
```

On the outer card `<div>`, add conditional class:

```tsx
className={`... ${isAwaiting ? 'animate-[glow-pulse_2s_ease-in-out_infinite]' : ''}`}
```

This uses Tailwind's arbitrary animation syntax to reference our keyframes.

**Step 4: Verify visually**

Create or use an existing task that enters awaiting-review state. Confirm the gold glow pulses on the Kanban card.

**Step 5: Commit**

```bash
git add src/renderer/src/components/KanbanBoard/TaskCard.tsx src/renderer/src/utils/taskHelpers.ts src/renderer/src/components/InterventionPanel/InterventionPanel.tsx src/renderer/src/stores/pipelineStore.ts
git commit -m "feat: add pulsing gold glow to task cards awaiting approval"
```

---

### Task 3: Add `archivedAt` field to Task type and backend persistence

**Files:**
- Modify: `src/shared/types.ts` (~line 111, add field to Task interface)
- Modify: backend database/persistence layer (find the SQLite schema or task storage file)

**Step 1: Find the database schema**

Search for `CREATE TABLE` or task persistence logic in `src/main/`. Identify where Task rows are stored and the migration/schema file.

**Step 2: Add `archivedAt` to the Task interface**

In `src/shared/types.ts`, add to the Task interface:

```tsx
archivedAt: string | null
```

**Step 3: Add database column**

Add `archivedAt TEXT` column to the tasks table (nullable, default null). Follow the existing migration pattern if one exists, or add directly to schema.

**Step 4: Update any task query/load logic**

Ensure `archivedAt` is included in SELECT queries and mapped to the Task object when loading from DB.

**Step 5: Add IPC handler for archiving**

In the main process, add handlers:
- `archive-task` — sets `archivedAt` to current ISO timestamp
- `unarchive-task` — sets `archivedAt` to null
- `archive-all-done` — sets `archivedAt` on all tasks where `status = 'done'` and `archivedAt IS NULL`

**Step 6: Expose in preload API**

Add `archiveTask`, `unarchiveTask`, `archiveAllDone` to the preload bridge.

**Step 7: Commit**

```bash
git add src/shared/types.ts src/main/ src/preload/
git commit -m "feat: add archivedAt field to Task with IPC handlers"
```

---

### Task 4: Add archive actions to the task store

**Files:**
- Modify: `src/renderer/src/stores/taskStore.ts`

**Step 1: Find the task store**

Read `src/renderer/src/stores/taskStore.ts` to understand existing actions (create, update, delete patterns).

**Step 2: Add archive actions**

```tsx
archiveTask: async (taskId: number) => {
  await window.api.archiveTask(taskId)
  set((state) => ({
    tasks: state.tasks.map((t) =>
      t.id === taskId ? { ...t, archivedAt: new Date().toISOString() } : t
    )
  }))
},

unarchiveTask: async (taskId: number) => {
  await window.api.unarchiveTask(taskId)
  set((state) => ({
    tasks: state.tasks.map((t) =>
      t.id === taskId ? { ...t, archivedAt: null } : t
    )
  }))
},

archiveAllDone: async () => {
  await window.api.archiveAllDone()
  const now = new Date().toISOString()
  set((state) => ({
    tasks: state.tasks.map((t) =>
      t.status === 'done' && !t.archivedAt ? { ...t, archivedAt: now } : t
    )
  }))
},
```

**Step 3: Add a computed getter for archived vs active tasks**

Add selectors or derive in components:

```tsx
// Active tasks (not archived) — used by KanbanBoard
const activeTasks = tasks.filter((t) => !t.archivedAt)

// Archived tasks — used by ArchiveDrawer
const archivedTasks = tasks.filter((t) => t.archivedAt)
```

**Step 4: Commit**

```bash
git add src/renderer/src/stores/taskStore.ts
git commit -m "feat: add archive/unarchive actions to task store"
```

---

### Task 5: Newest-first sorting in KanbanBoard

**Files:**
- Modify: `src/renderer/src/components/KanbanBoard/KanbanBoard.tsx` (lines 20-29)

**Step 1: Add sort function**

```tsx
function sortTasksNewestFirst(tasks: Task[], status: TaskStatus): Task[] {
  return [...tasks].sort((a, b) => {
    const getTime = (t: Task) => {
      if (status === 'done' && t.completedAt) return new Date(t.completedAt).getTime()
      if (t.startedAt) return new Date(t.startedAt).getTime()
      return new Date(t.createdAt).getTime()
    }
    return getTime(b) - getTime(a) // descending — newest first
  })
}
```

**Step 2: Apply sort when passing tasks to columns**

Change the column render (line 24) from:

```tsx
tasks={tasks.filter((t) => t.status === status)}
```

To:

```tsx
tasks={sortTasksNewestFirst(tasks.filter((t) => t.status === status && !t.archivedAt), status)}
```

This also filters out archived tasks from the board.

**Step 3: Verify sort order**

Create a few tasks, start them at different times. Confirm newest appear at top of each column.

**Step 4: Commit**

```bash
git add src/renderer/src/components/KanbanBoard/KanbanBoard.tsx
git commit -m "feat: sort Kanban columns newest-first, filter archived tasks"
```

---

### Task 6: Collapsible Done column

**Files:**
- Modify: `src/renderer/src/components/KanbanBoard/KanbanColumn.tsx`

**Step 1: Add collapse state for Done column**

In `KanbanColumn.tsx`, add local state:

```tsx
const [collapsed, setCollapsed] = useState(status === 'done') // default collapsed for done
```

**Step 2: Add toggle to Done column header**

Add a clickable chevron to the column header, only for the Done column:

```tsx
{status === 'done' && (
  <button
    onClick={() => setCollapsed(!collapsed)}
    className="text-text-muted hover:text-text-secondary transition-colors"
  >
    <svg className={`w-3.5 h-3.5 transition-transform ${collapsed ? '' : 'rotate-180'}`}
      viewBox="0 0 20 20" fill="currentColor">
      <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" />
    </svg>
  </button>
)}
```

**Step 3: Conditionally render card list**

Wrap the card list div:

```tsx
{!(status === 'done' && collapsed) && (
  <div className="flex flex-col gap-2 overflow-y-auto flex-1 pr-1">
    {tasks.map((task) => (
      <TaskCard key={task.id} task={task} />
    ))}
  </div>
)}
```

**Step 4: Add "Archive All" button to Done column header**

When status is `done` and there are tasks, show an archive-all button:

```tsx
{status === 'done' && tasks.length > 0 && (
  <button
    onClick={() => archiveAllDone()}
    className="text-[10px] text-text-muted hover:text-accent-gold transition-colors"
    title="Archive all done tasks"
  >
    Archive All
  </button>
)}
```

Import `useTaskStore` to access `archiveAllDone`.

**Step 5: Add per-card archive button to TaskCard**

In `TaskCard.tsx`, when `task.status === 'done'`, show a small archive icon in the top-right:

```tsx
{task.status === 'done' && (
  <button
    onClick={(e) => { e.stopPropagation(); archiveTask(task.id) }}
    className="absolute top-1.5 right-1.5 text-text-muted hover:text-accent-gold opacity-0 group-hover:opacity-100 transition-opacity"
    title="Archive"
  >
    <svg className="w-3.5 h-3.5" /* archive box icon */ />
  </button>
)}
```

Add `group` class to the card's outer div and `relative` for positioning.

**Step 6: Verify collapse and archive**

- Done column starts collapsed, click chevron to expand
- Archive All clears done tasks from board
- Per-card archive button appears on hover, removes single card
- Archived tasks no longer appear on the board

**Step 7: Commit**

```bash
git add src/renderer/src/components/KanbanBoard/KanbanColumn.tsx src/renderer/src/components/KanbanBoard/TaskCard.tsx
git commit -m "feat: collapsible Done column with per-card and bulk archive"
```

---

### Task 7: Archive Drawer component

**Files:**
- Create: `src/renderer/src/components/ArchiveDrawer/ArchiveDrawer.tsx`
- Modify: `src/renderer/src/stores/layoutStore.ts` (add `archiveDrawerOpen` state)
- Modify: `src/renderer/src/index.css` (add slide-in animation)

**Step 1: Add drawer state to layoutStore**

In `layoutStore.ts`, add:

```tsx
archiveDrawerOpen: boolean
// initialized as false

toggleArchiveDrawer: () => set((s) => ({ archiveDrawerOpen: !s.archiveDrawerOpen }))
```

**Step 2: Add slide-in keyframes to index.css**

```css
@keyframes slide-in-right {
  from { transform: translateX(100%); }
  to { transform: translateX(0); }
}
```

**Step 3: Build the ArchiveDrawer component**

```tsx
export function ArchiveDrawer() {
  const { archiveDrawerOpen, toggleArchiveDrawer } = useLayoutStore()
  const tasks = useTaskStore((s) => s.tasks)
  const unarchiveTask = useTaskStore((s) => s.unarchiveTask)

  const archivedTasks = tasks
    .filter((t) => t.archivedAt)
    .sort((a, b) => new Date(b.archivedAt!).getTime() - new Date(a.archivedAt!).getTime())

  if (!archiveDrawerOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/40" onClick={toggleArchiveDrawer} />

      {/* Drawer panel */}
      <div className="relative w-96 h-full bg-surface border-l border-border
                      animate-[slide-in-right_0.2s_ease-out] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <h2 className="text-sm font-semibold text-text-primary">
            Archived Tasks ({archivedTasks.length})
          </h2>
          <button onClick={toggleArchiveDrawer} className="text-text-muted hover:text-text-secondary">
            ✕
          </button>
        </div>

        {/* Task list */}
        <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-2">
          {archivedTasks.length === 0 ? (
            <p className="text-text-muted text-xs text-center mt-8">No archived tasks</p>
          ) : (
            archivedTasks.map((task) => (
              <div key={task.id} className="bg-elevated rounded-lg p-3 border border-border">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-text-primary truncate">{task.title}</span>
                  <button
                    onClick={() => unarchiveTask(task.id)}
                    className="text-[10px] text-text-muted hover:text-accent-teal ml-2 shrink-0"
                  >
                    Unarchive
                  </button>
                </div>
                <div className="flex items-center gap-2 mt-1 text-[10px] text-text-muted">
                  <span>{task.tier}</span>
                  {task.completedAt && (
                    <span>Done {new Date(task.completedAt).toLocaleDateString()}</span>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
```

**Step 4: Commit**

```bash
git add src/renderer/src/components/ArchiveDrawer/ src/renderer/src/stores/layoutStore.ts src/renderer/src/index.css
git commit -m "feat: add archive drawer component with slide-in animation"
```

---

### Task 8: Wire archive drawer into the main UI

**Files:**
- Modify: `src/renderer/src/components/Dashboard/TopBar.tsx` (add archive button, ~line 100)
- Modify: `src/renderer/src/App.tsx` or `src/renderer/src/components/Dashboard/Dashboard.tsx` (render ArchiveDrawer)

**Step 1: Add archive icon button to TopBar**

In `TopBar.tsx`, add before the settings gear button (around line 104):

```tsx
<button
  onClick={toggleArchiveDrawer}
  className="p-1.5 rounded hover:bg-elevated text-text-muted hover:text-text-secondary transition-colors"
  title="Archived tasks"
>
  <svg className="w-4 h-4" /* archive box icon */ />
</button>
```

Import `useLayoutStore` and destructure `toggleArchiveDrawer`.

**Step 2: Render ArchiveDrawer**

In `App.tsx` (after `ToastContainer`, ~line 38) or in `Dashboard.tsx`:

```tsx
<ArchiveDrawer />
```

Rendering at App level is simplest since the drawer is a fixed overlay.

**Step 3: Verify end-to-end**

- Archive a done task from the board
- Click archive icon in TopBar → drawer slides in from right
- See archived task in drawer
- Click Unarchive → task returns to Done column on board
- Click backdrop → drawer closes

**Step 4: Commit**

```bash
git add src/renderer/src/components/Dashboard/TopBar.tsx src/renderer/src/App.tsx
git commit -m "feat: wire archive drawer into TopBar and App shell"
```

---

### Task 9: Final verification and cleanup

**Step 1: Run build**

```bash
npm run build
```

Fix any type errors or import issues.

**Step 2: Manual smoke test checklist**

- [ ] Task card glows gold when awaiting plan approval
- [ ] Glow stops when approval is given or task moves forward
- [ ] Done column starts collapsed with count shown
- [ ] Chevron toggles expand/collapse
- [ ] Archive All button archives all done tasks
- [ ] Per-card archive button appears on hover for done cards
- [ ] Archive drawer opens from TopBar icon
- [ ] Archived tasks shown newest-first in drawer
- [ ] Unarchive moves task back to Done column
- [ ] All columns sort newest-first
- [ ] No regressions on other task card interactions (click to detail, drag if applicable)

**Step 3: Final commit**

```bash
git add -A
git commit -m "fix: cleanup and polish task card UX improvements"
```
