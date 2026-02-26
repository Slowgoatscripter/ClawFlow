# Task Todo List — Live Claude Progress Display

**Date:** 2026-02-25
**Status:** Approved

## Problem

During pipeline runs, Claude creates internal todo lists (via TaskCreate/TodoWrite) to track its work, but ClawFlow doesn't capture or display them. Users have no visibility into what Claude has left to do within a given stage.

## Solution

Parse Claude's TaskCreate/TaskUpdate/TodoWrite tool_use blocks from the SDK stream, persist them per-task per-stage, and display them as a read-only checklist in the UI.

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Storage | JSON column on tasks table | Lightweight, no new tables, fits existing patterns |
| Capture method | Parse tool_use blocks from SDK stream | Structured JSON, most reliable |
| Display location | Kanban card badge + task detail accordion | Compact overview + full detail |
| Interaction | Read-only | No sync complexity, always reflects Claude's actual state |
| Stage history | Stacked accordion by stage | Current stage expanded, previous collapsed |
| Persistence | DB-persisted | Survives app restart, enables stage history |

## Data Model

```typescript
interface TodoItem {
  id: string
  subject: string
  status: 'pending' | 'in_progress' | 'completed'
  createdAt: string
  updatedAt: string
}

// Stored as JSON in tasks.todos column
// Record<PipelineStage, TodoItem[]>
```

DB migration: `ALTER TABLE tasks ADD COLUMN todos TEXT DEFAULT NULL`

Task interface gains: `todos: Record<string, TodoItem[]> | null`

## Parsing & Capture

In `src/main/sdk-manager.ts`, filter tool_use blocks for:

- **TaskCreate** → new TodoItem (status: pending)
- **TaskUpdate** → update existing item's status
- **TodoWrite** → bulk replacement of full todo list

On each change:
1. Emit IPC `pipeline:todos-updated` with `{ taskId, stage, todos }`
2. Persist to DB (debounced 500ms to batch rapid creates)

## IPC

New channel: `pipeline:todos-updated → { taskId: string, stage: string, todos: TodoItem[] }`

Registered in preload alongside existing pipeline channels.

## Renderer State

Existing task store gains:

```typescript
todosByTaskId: Record<string, Record<string, TodoItem[]>>
setTodos(taskId: string, stage: string, todos: TodoItem[]): void
```

Hydrated from DB on load. Updated in real-time via IPC listener.

## UI Components

### Kanban Card Badge (TaskCard.tsx)

Compact progress indicator showing completed/total for current stage:

```
┌─────────────────────────────┐
│ Add user authentication  L2 │
│ ● high   agent-planner      │
│ 3/7 tasks   5m              │
└─────────────────────────────┘
```

Only renders when todos exist. Muted text, same style as time-in-stage.

### Task Detail Accordion

Collapsible sections grouped by stage. Current stage expanded, previous collapsed:

```
▼ Implementing (3/7)
  ✓ Set up auth middleware
  ✓ Create user model
  ● Implement login endpoint          ← in_progress (accent + pulse)
  ○ Implement logout endpoint
  ○ Add JWT token generation
  ○ Write integration tests
  ○ Update API docs

▶ Planning (5/5) ✓
▶ Brainstorming (3/3) ✓
```

Status icons:
- ✓ completed — muted/green
- ● in_progress — accent color, subtle pulse
- ○ pending — muted/dim

Read-only. Accordion headers toggle expand/collapse.

## Scope Boundaries

**In scope:** Parsing tool_use blocks, DB persistence, IPC streaming, kanban badge, detail accordion.

**Out of scope:** Master/aggregated todo list across tasks, interactive editing, text-based regex parsing, workshop session todos (pipeline only).
