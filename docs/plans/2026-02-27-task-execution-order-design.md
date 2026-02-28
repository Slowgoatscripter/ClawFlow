# Task Execution Order Visibility

**Date:** 2026-02-27
**Status:** Approved

## Problem

Task execution order is not visible to users. Tasks display in creation order with no sequencing cues, no indication of what runs next, and no visualization of dependency relationships.

## Solution

Three visual features that make execution order obvious:

1. **Sequence numbers** on every task card
2. **"NEXT" indicator** on the next task to execute
3. **Dependency flow arrows** between tasks

All powered by a computed queue order (no schema changes).

## Design

### Queue Order Computation

New utility function `computeExecutionOrder(tasks): TaskId[]` in `src/main/task-graph.ts`.

**Algorithm:** Topological sort (Kahn's algorithm) with tie-breaking:
1. Dependencies first — tasks with no unfinished dependencies before blocked ones
2. Priority — critical > high > medium > low
3. Creation time — earlier-created tasks first

**Two scopes:**
- Within-group: only tasks in that group
- Global: all non-done, non-archived tasks

Exposed via IPC so the renderer can request computed order.

### Sequence Numbers

Small badge in the top-left corner of each task card: `#1`, `#2`, `#3`.

- Within groups: numbered relative to the group (group-local order)
- Color-coded:
  - Cyan — currently running
  - White — queued and ready
  - Muted/dim — blocked by dependencies
- Appears in both `CanvasTaskLane.tsx` (canvas) and `GroupTab.tsx` (sidebar)

### "NEXT" Indicator

Bright cyan "NEXT" pill badge next to the sequence number.

- Only one task in the entire system has this at a time
- Shows on the first *waiting* task in the global queue
- Not shown if a task is already running (running state is its own indicator)
- Moves automatically when a task completes
- Appears in both canvas and group tab views

### Dependency Flow Arrows

**Canvas view:**
- SVG arrows from prerequisite task to dependent task
- Rendered in a layer behind task cards
- Simple bezier curves to avoid overlapping cards
- Color-coded:
  - Green — dependency satisfied (prerequisite completed)
  - Amber — dependency pending (blocking)

**Group tab sidebar:**
- Vertical connector lines between tasks (git-log style)
- Dot connectors linking dependency to dependent
- Same green/amber coloring
- "Blocked by #N" text badge on blocked tasks

**New component:** `CanvasDependencyArrows.tsx` — SVG overlay reading task positions from DOM.

## Files to Modify

| File | Change |
|------|--------|
| `src/main/task-graph.ts` | Add `computeExecutionOrder()` |
| `src/main/index.ts` (or IPC handler) | Expose execution order via IPC |
| `src/renderer/src/stores/canvasStore.ts` | Store computed order, expose position lookups |
| `src/renderer/src/components/Canvas/CanvasTaskLane.tsx` | Add sequence number badge |
| `src/renderer/src/components/Canvas/CanvasGroup.tsx` | Pass order data to task lanes |
| `src/renderer/src/components/Canvas/Canvas.tsx` | Render dependency arrows overlay |
| `src/renderer/src/components/Canvas/CanvasDependencyArrows.tsx` | New — SVG arrow overlay |
| `src/renderer/src/components/WorkshopPanel/GroupTab.tsx` | Add sequence numbers + connector lines |

## Approach

Computed at runtime — no database schema changes. Order is always in sync with the actual dependency graph and task states. Numbers update dynamically as tasks complete.
