# Task Dependency Graph & Cross-Task Context

**Date:** 2026-02-26
**Status:** Approved
**Approach:** Full DAG Orchestrator (Approach A)

## Problem

Tasks created by the workshop are completely independent — no dependency tracking, no cross-task context, no ordering enforcement. When tasks are completed out of order or run concurrently, this causes:

- Mismatched function names and import paths
- Incompatible interface definitions
- Git worktree isolation hiding prior task outputs
- Merge conflicts when combining completed branches

The workshop AI may suggest tasks that form an implicit dependency graph, but that graph is invisible to the execution layer.

## Design Decisions

| Decision | Choice |
|----------|--------|
| Execution model | Smart parallel — independent tasks run concurrently, dependent tasks wait |
| Cross-task context | Artifact registry — completed tasks register what they created |
| Dependency source | Workshop AI infers dependencies automatically |
| Git integration | Auto-merge to base branch before dependent tasks start |

## 1. Data Model Changes

### WorkshopSuggestedTask update

```ts
interface WorkshopSuggestedTask {
  title: string
  description: string
  tier: 'L1' | 'L2' | 'L3'
  priority?: Priority
  linkedArtifactIds?: string[]
  dependsOn?: number[]  // indices into the same suggestion array
}
```

### New DB structure

**`task_dependencies` join table:**
- `task_id` (FK → tasks)
- `depends_on_task_id` (FK → tasks)

**`artifacts` column on `tasks` table:**
```ts
interface TaskArtifacts {
  filesCreated: string[]      // "src/services/auth.ts"
  filesModified: string[]     // files changed
  exportsAdded: string[]      // "UserAuthService", "validateToken()"
  typesAdded: string[]        // "interface User", "type AuthConfig"
  summary: string             // AI-generated 2-3 sentence summary
}
```

## 2. Task Graph Module

New `src/main/task-graph.ts` — pure logic, no side effects.

**Responsibilities:**
- Build adjacency list from task records and `task_dependencies`
- Cycle detection — reject circular dependencies at creation time
- Readiness check — `getReadyTasks()` returns tasks whose dependencies are all `done`
- Topological ordering for UI display

**Key functions:**
- `buildGraph(tasks)` → adjacency list
- `validateNoCycles(graph)` → boolean + error details
- `getReadyTasks(graph, taskStatuses)` → ready task IDs
- `getDependencyChain(taskId)` → ordered list of ancestors

## 3. Artifact Registry

**Capture:** At the end of a task's `implement` stage (or final stage before `done`), the pipeline instructs the SDK runner to produce an artifact summary via structured output in the stage prompt.

**Storage:** Parsed artifact data stored in the task's `artifacts` DB column.

**Consumption:** When a dependent task starts, the template engine collects artifacts from all dependencies via `getDependencyChain(taskId)` and injects them as `{{dependency_context}}`.

**Example injection:**
> Task "Create UserAuthService" completed. It created `src/services/auth.ts` exporting `UserAuthService` class and `validateToken()` function with interface `AuthConfig`.

## 4. Pipeline Engine Changes

### Dependency gate
- `startPipeline(taskId)` checks `taskGraph.getReadyTasks()` before allowing start
- Blocked tasks rejected with message: "Blocked by: [task names]"

### Auto-merge on completion
1. Task reaches `done` with a worktree branch
2. Merge branch into base (fast-forward or merge commit)
3. If conflicts: mark task `needs_resolution`, notify user
4. On success: clean up worktree, check if blocked tasks are now ready

### Dependency context injection
- Before constructing stage prompts, gather artifacts from all dependency tasks
- Pass to template engine as `dependency_context` variable
- `plan` and `implement` stage templates include `{{dependency_context}}`

### Execution example
```
Workshop suggests [A, B, C] where B depends on A, C is independent
→ A and C start in parallel (both ready)
→ A completes → artifacts stored → branch merged → B unblocked
→ B starts (gets A's artifacts in prompts)
→ C completes independently
```

## 5. Workshop AI Tool Update

### Tool schema change
- Add `dependsOn` as optional integer array to each task in `suggest_tasks`
- Integers reference 0-based indices within the same suggestion batch

### System prompt addition
Instruct the workshop AI: "When suggesting tasks that build on each other, specify which tasks must complete first using the dependsOn field. If task B needs functions or files created by task A, task B must depend on task A."

### Creation flow
1. Workshop AI calls `suggest_tasks` with dependency indices
2. Handler creates all tasks in DB (gets real IDs)
3. Maps batch indices → actual task IDs
4. Writes `task_dependencies` rows
5. Validates no cycles via `taskGraph.validateNoCycles()`
6. If cycles detected: log warning, strip cyclic edges (fallback to independent)

## 6. UI Changes (Kanban Board)

### Task cards
- Blocked tasks show "Blocked by: Task X" label
- "Start" button disabled for blocked tasks
- Cards animate to "Ready" when dependencies complete

### Visual indicators
- Chain-link icon on cards with dependencies
- Tooltip shows full dependency chain on hover

### Notifications
- Toast on completion + merge: "Task X merged — Task Y now ready"
- Warning toast on merge conflict: "Task X has merge conflicts — resolve before dependents can start"

## Component Summary

| Component | Change |
|-----------|--------|
| Data model | `dependsOn` field, `task_dependencies` table, `artifacts` column |
| Task graph | New `task-graph.ts` — DAG, cycles, readiness |
| Artifact registry | Capture files/exports/types, store in DB |
| Pipeline engine | Dependency gate, auto-merge, context injection |
| Workshop AI | `dependsOn` in tool schema, index-to-ID mapping |
| Template engine | New `{{dependency_context}}` variable |
| UI | Blocked state, disabled start, toasts |
