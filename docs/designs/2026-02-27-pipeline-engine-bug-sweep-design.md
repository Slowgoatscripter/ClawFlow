# Design Document: Pipeline Engine Bug Sweep

**Task:** Bug sweep — Pipeline engine (stages, circuit breaker, hooks, task graph)
**Tier:** L2 | **Priority:** High
**Author:** Brainstormer Agent
**Date:** 2026-02-27
**Revision:** 2 — incorporates reviewer decisions on all open questions

---

## 1. Problem Statement

The pipeline execution engine (`pipeline-engine.ts` and its supporting modules) has several categories of bugs that can leave tasks in unrecoverable states, silently swallow errors, or produce confusing behavior. This document catalogs each bug found during audit, proposes fix approaches, and recommends an implementation strategy.

---

## 2. Bugs Found (Ordered by Severity)

### BUG-1: No auto-resume after usage limit window resets (Critical)

**File:** `src/main/usage-monitor.ts`, `src/main/index.ts`
**Acceptance criteria:** _"Usage monitor auto-pause correctly resumes tasks when the window resets"_

**Problem:** When `UsageMonitor` emits `limit-approaching` (utilization ≥ 95%), `pauseAllTasks('usage_limit')` is called. However, there is **no code** that detects when utilization drops back below the threshold and auto-resumes. The `poll()` method only emits `limit-approaching` when over threshold — it never emits a "limit-cleared" event. Tasks paused with `pauseReason: 'usage_limit'` remain paused forever until the user manually resumes each one.

**Evidence:**
- `UsageMonitor.poll()` (line 97-103): only checks `fiveHour.utilization >= this.threshold`
- No inverse check exists anywhere in the codebase
- `pauseTask` stores `pauseReason: 'usage_limit'` but nothing reads it back for auto-resume
- A `usage.autoResume` setting key already exists (defaults to `false`) — indicating the intent was always there, just never implemented

---

### BUG-2: Context handoff has no abort/reject path (Critical)

**File:** `src/main/pipeline-engine.ts` (line 912-923), `src/renderer/src/stores/pipelineStore.ts` (line 119)
**Acceptance criteria:** _"Context handoff approval flow correctly resumes or aborts the task on both user choices"_

**Problem:** When the context budget check fails and `stage:context_handoff` is emitted, the pipeline pauses and waits for `approveContextHandoff()`. The renderer has a `dismissContextHandoff()` method, but this only clears the UI state (`contextHandoff: null`). It **never notifies the pipeline engine**. The task is left in a state where:
- `runStage` has already returned (line 923)
- The stage's status is still the current active status (e.g., `implementing`)
- The pipeline won't auto-advance (the `runStage` already exited)
- There's no method to skip the handoff and just continue in the same session or advance normally

The task is effectively **stuck in limbo** with no recovery path except manual restart.

---

### BUG-3: `approveContextHandoff()` has no error handling (High)

**File:** `src/main/pipeline-engine.ts` (line 511-585)
**Acceptance criteria:** _"All stage transitions have error handling that sets task to a recoverable failed state"_

**Problem:** The `approveContextHandoff()` method calls `this.sdkRunner()` (line 536) to generate a rich handoff document. This call is **not wrapped in try/catch**. If the SDK runner fails (network error, timeout, abort), the error propagates directly to the IPC handler, leaving the task in an inconsistent state:
- `activeSessionId` and `richHandoff` are never updated
- The task can't resume because the session state is ambiguous
- The status is never set to `blocked`, so `stepTask()` won't work as a retry mechanism

---

### BUG-4: Task graph cycle detection is never invoked at creation, and silently swallowed at update (High)

**File:** `src/main/task-graph.ts`, `src/main/db.ts`, `src/main/pipeline-engine.ts`
**Acceptance criteria:** _"Task graph cycle detection throws a clear error, not a hang"_

**Problem:** `validateNoCycles()` exists in `task-graph.ts` and correctly implements DFS cycle detection. However:

1. **`createTask()` (db.ts line 266):** No cycle validation whatsoever. Circular dependencies can be created directly.
2. **`addTaskDependencies()` (db.ts line 564):** Has cycle validation but **silently returns** with a `console.warn` on cycle detection — the caller gets no error and no indication the dependencies were not added.
3. **`startTask()` and `runFullPipeline()`:** No cycle checks. Tasks with circular dependencies remain stuck in `backlog` with `areDependenciesMet()` returning `false` forever. There is no error message — just a silent deadlock.

**Reviewer decision:** Validate at **both** task creation and task update.

---

### BUG-5: Race condition between `pauseTask` and `runStage` error handler (High)

**File:** `src/main/pipeline-engine.ts` (line 425-452, 957-972)
**Acceptance criteria:** _"All stage transitions have error handling that sets task to a recoverable failed state"_

**Problem:** `pauseTask()` does two things:
1. Calls `abortSession(sessionKey)` — this causes the SDK runner to reject
2. Sets status to `paused` with `pausedFromStatus` saved

But `runStage`'s catch block (line 957-969) **unconditionally** sets status to `blocked` when the SDK runner rejects. Since both run concurrently:
1. `pauseTask` sets status → `paused`
2. SDK abort causes `runStage` catch → sets status → `blocked`

The `paused` status is overwritten by `blocked`. The `pausedFromStatus` is left set, but the status is wrong. `resumeTask()` will fail with "Task is not paused".

---

### BUG-6: Timeout timer not cleared on SDK error (unhandled rejection) (Medium)

**File:** `src/main/pipeline-engine.ts` (line 802-811, 957-972)
**Acceptance criteria:** _"All stage transitions have error handling"_

**Problem:** In `runStage`, a timeout promise races against the SDK promise (line 810). `clearTimeout(timeoutHandle)` is at line 811, inside the `try` block — it only executes when the SDK promise resolves successfully. If the SDK promise rejects first (network error, auth failure, etc.):
1. The error goes to the `catch` block
2. The timeout timer **continues running**
3. When it fires, it calls `abortSession` (harmless) then rejects the `timeoutPromise`
4. Since `Promise.race` has already settled, this rejection is **unhandled**

This produces `UnhandledPromiseRejection` warnings in Node and could crash in strict mode.

---

### BUG-7: Post-hook failure triggers recursive `runStage` → `rejectStage` → `runStage` (Medium)

**File:** `src/main/pipeline-engine.ts` (line 828-845, 385)
**Acceptance criteria:** _"Hook runner failures are surfaced to the UI with the actual error output"_

**Problem:** When post-stage hooks fail, the code calls `this.rejectStage(taskId, failMessages)` (line 842). `rejectStage` increments the rejection counter and then calls `this.runStage(taskId, currentStage, enhancedFeedback)` (line 385). If post-hooks fail again → `rejectStage` → `runStage` → post-hooks fail → repeat.

This recurses until `CIRCUIT_BREAKER_LIMIT` (3) is hit. The result is:
- 3 nested async call stacks
- 3 rejection counter increments (from one logical failure)
- Confusing agent log with 3 error entries
- Circuit breaker trips for what might be a single hook misconfiguration

**Reviewer decision:** The behavior change (block instead of auto-retry) is acceptable **without a feature flag**. The blocking behavior is strictly safer and the old behavior was a bug.

---

### BUG-8: Hook runner doesn't distinguish timeout from failure (Low)

**File:** `src/main/hook-runner.ts` (line 10-21)
**Acceptance criteria:** _"Hook runner failures are surfaced to the UI with the actual error output"_

**Problem:** `execFile` with `timeout` option kills the process on timeout, producing an error with `error.killed === true`. But the hook result only reports `success: false` with whatever partial output was captured. The user sees a generic failure with possibly empty output, not a clear "Hook timed out after Xms" message.

---

### BUG-9: Circuit breaker `canTransition` check is narrower than counter increment scope (Low)

**File:** `src/shared/pipeline-rules.ts` (line 21-36)
**Acceptance criteria:** _"Circuit breaker correctly increments rejection count and halts at limit=3"_

**Problem:** `rejectStage` increments `planReviewCount` for stages `brainstorm`, `design_review`, `plan`, and `implReviewCount` for `implement`, `code_review`, `verify`. But `canTransition` only checks the circuit breaker for target stages `plan` and `implement`. This means:
- Rejecting `brainstorm` 3+ times trips `isCircuitBreakerTripped` inside `rejectStage` (correct)
- But if the circuit breaker is somehow reset and `canTransition` is called later to transition TO `brainstorm`, it doesn't check `planReviewCount`

In practice this isn't exploitable because `rejectStage` catches it first, but the double-check in `canTransition` is incomplete as a safety net.

---

### BUG-10: `done` stage rejections don't increment any counter (Low)

**File:** `src/main/pipeline-engine.ts` (line 308-314)

**Problem:** The `done` stage has `pauses: true`, so users can reject it. But `rejectStage`'s counter logic doesn't cover the `done` stage — neither `planReviewCount` nor `implReviewCount` is incremented. This means infinite rejections of the `done` stage are possible with no circuit breaker trip.

---

## 3. Proposed Approaches

### Approach A: Surgical Fixes (Recommended)

Fix each bug individually with minimal code changes. No new abstractions, no refactoring.

**Pros:**
- Smallest diff, easiest to review
- Low risk of introducing new bugs
- Can be done incrementally

**Cons:**
- Doesn't address underlying structural issues (e.g., lack of a formal state machine)
- Some fixes may feel patchy

**Estimated scope:** ~180-230 lines changed across 6 files

### Approach B: State Machine Refactor

Introduce a formal state machine for task status transitions. Each transition would have explicit guards, actions, and error recovery built in. This would prevent an entire class of state bugs.

**Pros:**
- Eliminates category of bugs (invalid state transitions)
- Makes the system easier to reason about
- Would catch future bugs at compile time with exhaustive matching

**Cons:**
- Large refactor touching many files
- Introduces new abstraction complexity
- Overkill for the current bug count
- Risk of regression during refactor

**Estimated scope:** ~500-700 lines changed, new state machine module

### Approach C: Surgical Fixes + Lightweight State Guard

Apply Approach A's fixes, plus add a single `transitionTo(taskId, newStatus, context)` helper that validates and logs all status changes. Not a full state machine, but a choke-point that prevents invalid transitions.

**Pros:**
- Gets the immediate fixes done
- Adds a safety net without the full refactor
- Incremental path toward Approach B if needed later

**Cons:**
- Slightly more work than Approach A
- The guard function may not cover all edge cases

**Estimated scope:** ~250-300 lines changed across 6 files

---

## 4. Recommendation: Approach A (Surgical Fixes)

**Rationale:** The bugs are well-localized and the fixes are straightforward. A state machine refactor (B) is desirable long-term but is out of scope for a bug sweep — it should be its own task. Approach C adds useful safety but mixes two concerns (bug fixing and new abstraction), which muddies the review.

---

## 5. Fix Specifications

### FIX-1: Auto-resume after usage limit clears

**File:** `src/main/usage-monitor.ts`

Add state tracking for whether we were previously over-threshold. When `poll()` detects utilization has dropped below the configurable resume threshold (with hysteresis to prevent flapping), emit `limit-cleared`:

```typescript
// In UsageMonitor class
private wasOverThreshold = false
private resumeThreshold: number  // configurable, default 80

constructor(threshold: number = 95, resumeThreshold: number = 80) {
  super()
  this.threshold = threshold
  this.resumeThreshold = resumeThreshold
}

// In poll(), after checking limit-approaching:
if (fiveHour && fiveHour.utilization >= this.threshold) {
  this.wasOverThreshold = true
  this.emit('limit-approaching', { ... })
} else if (this.wasOverThreshold && fiveHour && fiveHour.utilization < this.resumeThreshold) {
  this.wasOverThreshold = false
  this.emit('limit-cleared', {
    utilization: fiveHour.utilization,
    resetsAt: fiveHour.resetsAt
  })
}
```

**Reviewer decision:** The resume threshold **is configurable**. Add `usage.autoResumeThreshold` to settings.

**File:** `src/shared/settings.ts`

Add the new setting key and default:

```typescript
// In SETTING_KEYS:
'usage.autoResumeThreshold': 'usage.autoResumeThreshold',

// In SettingsState interface:
autoResumeThreshold: number

// In DEFAULT_SETTINGS:
autoResumeThreshold: 80,
```

**File:** `src/main/index.ts`

Read the setting and pass to `UsageMonitor`; also respect the existing `usage.autoResume` toggle:

```typescript
const autoResumeThreshold = Number(
  getGlobalSetting(SETTING_KEYS['usage.autoResumeThreshold']) ?? 80
)
const usageMonitor = new UsageMonitor(
  Number(getGlobalSetting(SETTING_KEYS['usage.autoPauseThreshold']) ?? 95),
  autoResumeThreshold
)

usageMonitor.on('limit-cleared', async () => {
  const autoResume = getGlobalSetting(SETTING_KEYS['usage.autoResume'])
  if (autoResume === false || autoResume === 'false' || autoResume === 0) return
  if (!currentEngine) return
  const count = await currentEngine.resumeUsagePausedTasks()
  if (count > 0) {
    mainWindow?.webContents.send('pipeline:status', {
      type: 'usage-resumed',
      resumedCount: count
    })
  }
})
```

**File:** `src/main/pipeline-engine.ts`

Add `resumeUsagePausedTasks()` method:

```typescript
async resumeUsagePausedTasks(): Promise<number> {
  const tasks = listTasks(this.dbPath)
  const paused = tasks.filter(t => t.status === 'paused' && t.pauseReason === 'usage_limit')
  let count = 0
  for (const task of paused) {
    try {
      await this.resumeTask(task.id)
      count++
    } catch { /* task may have changed state between list and resume */ }
  }
  return count
}
```

**File:** `src/renderer/src/stores/pipelineStore.ts`

Handle the `usage-resumed` status event (show a toast or notification).

---

### FIX-2: Add `rejectContextHandoff()` method + degradation warning

**Reviewer decision:** Dismissing the context handoff **should** show a degradation warning.

**File:** `src/main/pipeline-engine.ts`

```typescript
async rejectContextHandoff(taskId: number): Promise<void> {
  const task = this.getTaskOrThrow(taskId)
  const currentStage = task.currentAgent as PipelineStage
  const nextStage = getNextStage(task.tier, currentStage)

  appendAgentLog(this.dbPath, taskId, {
    timestamp: new Date().toISOString(),
    agent: 'pipeline-engine',
    model: 'system',
    action: 'context_handoff_rejected',
    details: `User rejected context handoff. Advancing to ${nextStage} in same session (context may be degraded).`
  })

  // Advance to the next stage using the existing (large) session
  if (nextStage) {
    const transition = canTransition(task, nextStage)
    if (!transition.allowed) {
      updateTask(this.dbPath, taskId, { status: 'blocked' as TaskStatus })
      this.emit('circuit-breaker', { taskId, reason: transition.reason })
      return
    }
    const nextStatus = STAGE_TO_STATUS[nextStage] as TaskStatus
    if (nextStage === 'done') {
      await this.extractArtifacts(taskId)
    }
    updateTask(this.dbPath, taskId, {
      status: nextStatus,
      currentAgent: nextStage,
      ...(nextStage === 'done' ? { completedAt: new Date().toISOString() } : {})
    })

    // Emit degradation warning for the UI before continuing
    this.emit('stage:context_degraded', {
      taskId,
      nextStage,
      message: 'Continuing without context handoff. Quality may degrade as the context window is nearly full.'
    })

    await this.runStage(taskId, nextStage)
  }
}
```

**File:** `src/main/index.ts`

Wire the IPC handler:

```typescript
ipcMain.handle('pipeline:rejectContextHandoff', async (_e, taskId: number) => {
  if (!currentEngine) throw new Error('No active pipeline engine')
  await currentEngine.rejectContextHandoff(taskId)
})

// Forward the degradation warning to the renderer
currentEngine.on('stage:context_degraded', (data) =>
  mainWindow?.webContents.send('pipeline:contextDegraded', data))
```

**File:** `src/preload/index.ts`

Expose the new IPC:

```typescript
rejectContextHandoff: (taskId: number) => ipcRenderer.invoke('pipeline:rejectContextHandoff', taskId),
onContextDegraded: (callback: (data: any) => void) => {
  const handler = (_e: any, data: any) => callback(data)
  ipcRenderer.on('pipeline:contextDegraded', handler)
  return () => ipcRenderer.removeListener('pipeline:contextDegraded', handler)
},
```

**File:** `src/renderer/src/stores/pipelineStore.ts`

Wire the dismiss action to call `rejectContextHandoff` instead of just clearing state, and show a toast:

```typescript
dismissContextHandoff: async (taskId: number) => {
  set({ contextHandoff: null, streaming: true })
  await window.api.pipeline.rejectContextHandoff(taskId)
},
```

Subscribe to the degradation event:

```typescript
const cleanupDegraded = window.api.pipeline.onContextDegraded((data) => {
  // Show a toast warning (implementation depends on UI framework)
  set({ contextDegradedWarning: data.message })
})
```

**File:** `src/renderer/src/global.d.ts`

Add type for `rejectContextHandoff` and `onContextDegraded`.

---

### FIX-3: Wrap `approveContextHandoff()` in try/catch

**File:** `src/main/pipeline-engine.ts`

Wrap the SDK runner call and the continuation logic in try/catch. On error, set task to `blocked` and emit `stage:error`:

```typescript
async approveContextHandoff(taskId: number): Promise<void> {
  // ... existing validation code ...

  try {
    const result = await this.sdkRunner({ ... })
    // ... existing post-call logic ...
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    appendAgentLog(this.dbPath, taskId, {
      timestamp: new Date().toISOString(),
      agent: 'pipeline-engine',
      model: 'system',
      action: 'context_handoff_error',
      details: `Context handoff failed: ${errorMessage}`
    })
    updateTask(this.dbPath, taskId, { status: 'blocked' as TaskStatus })
    this.emit('stage:error', { taskId, stage: currentStage, error: errorMessage })
  }
}
```

---

### FIX-4: Call `validateNoCycles()` on both task creation and dependency changes

**Reviewer decision:** Validate at **both** task creation and task update.

**File:** `src/main/db.ts`

**4a. Fix `addTaskDependencies` to throw instead of silently returning:**

```typescript
export function addTaskDependencies(dbPath: string, taskId: number, depIds: number[]): void {
  // Cycle validation: build hypothetical graph with proposed edges and check for cycles
  const allTasks = listTasks(dbPath)
  const targetTask = allTasks.find(t => t.id === taskId)
  if (targetTask) {
    const proposedDeps = [...new Set([...(targetTask.dependencyIds ?? []), ...depIds])]
    targetTask.dependencyIds = proposedDeps
    const graph = buildGraph(allTasks)
    const validation = validateNoCycles(graph)
    if (!validation.valid) {
      throw new Error(
        `Circular dependency detected: ${validation.cycle?.join(' → ')}. ` +
        `Cannot add dependencies [${depIds.join(', ')}] to task ${taskId}.`
      )
    }
  }
  // ... rest of existing code (insert into DB) ...
}
```

**4b. Add cycle validation to `createTask`:**

```typescript
export function createTask(dbPath: string, input: CreateTaskInput): Task {
  // Validate dependencies before creating the task
  if (input.dependencyIds?.length) {
    const allTasks = listTasks(dbPath)
    // Create a temporary task entry for the graph
    const tempId = Math.max(0, ...allTasks.map(t => t.id)) + 1
    const graphTasks = [
      ...allTasks,
      { id: tempId, dependencyIds: input.dependencyIds } as any
    ]
    const graph = buildGraph(graphTasks)
    const validation = validateNoCycles(graph)
    if (!validation.valid) {
      throw new Error(
        `Circular dependency detected: ${validation.cycle?.join(' → ')}. ` +
        `Cannot create task with dependencies [${input.dependencyIds.join(', ')}].`
      )
    }
  }

  const db = getProjectDb(dbPath)
  // ... existing INSERT code ...
}
```

**4c. Add safety net in `startTask` (pipeline-engine.ts):**

```typescript
// In startTask(), after the dependency check:
const allTasks = listTasks(this.dbPath)
const graph = buildGraph(allTasks)
const validation = validateNoCycles(graph)
if (!validation.valid && validation.cycle?.includes(taskId)) {
  throw new Error(`Task ${taskId} is part of a dependency cycle: ${validation.cycle.join(' → ')}`)
}
```

---

### FIX-5: Guard `runStage` catch block against overwriting `paused` status

**File:** `src/main/pipeline-engine.ts` (line 957-972)

Check current status before overwriting:

```typescript
} catch (error) {
  const errorMessage = error instanceof Error ? error.message : String(error)

  appendAgentLog(this.dbPath, taskId, {
    timestamp: new Date().toISOString(),
    agent: stage,
    model: stageConfig.model,
    action: 'stage:error',
    details: `Error: ${errorMessage}`
  })

  // Don't overwrite 'paused' status — pauseTask() already handled the state
  const currentTask = getTask(this.dbPath, taskId)
  if (currentTask && currentTask.status !== 'paused') {
    updateTask(this.dbPath, taskId, { status: 'blocked' as TaskStatus })
  }

  this.emit('stage:error', { taskId, stage, error: errorMessage })
}
```

---

### FIX-6: Clear timeout on SDK error

**File:** `src/main/pipeline-engine.ts` (line 802-811)

Move `clearTimeout` to a `finally` block:

```typescript
let result: SdkResult
try {
  result = await Promise.race([sdkPromise, timeoutPromise])
} finally {
  clearTimeout(timeoutHandle)
}
// ... continue with result ...
```

This ensures the timeout is cleared regardless of whether the SDK promise resolves or rejects.

---

### FIX-7: Break post-hook → rejectStage recursion

**Reviewer decision:** Behavior change is acceptable **without a feature flag**. The blocking behavior is strictly safer.

**File:** `src/main/pipeline-engine.ts` (line 828-845)

Instead of calling `rejectStage` (which re-runs the stage), handle post-hook failures as a blocking error:

```typescript
if (!hookResults.allPassed) {
  const failMessages = hookResults.failedRequired
    .map(r => `**${r.name}:** ${r.output}`).join('\n\n')

  appendAgentLog(this.dbPath, taskId, {
    timestamp: new Date().toISOString(),
    agent: 'pipeline-engine',
    model: 'system',
    action: 'hook:post-stage-failed',
    details: `Post-hooks failed for ${stage}:\n${failMessages}`
  })

  // Block the task instead of calling rejectStage (avoids recursion)
  // The user can fix the hook issue and retry via stepTask()
  updateTask(this.dbPath, taskId, { status: 'blocked' as TaskStatus })
  this.emit('stage:error', {
    taskId,
    stage,
    error: `Post-stage validation hooks failed:\n\n${failMessages}`
  })
  return
}
```

This way the user sees the hook failure with the actual error output, can fix the underlying issue, and retry via `stepTask()` — without burning rejection counter slots.

---

### FIX-8: Distinguish hook timeout from command failure

**File:** `src/main/hook-runner.ts`

```typescript
execFile(hook.command, args, { cwd, timeout }, (error, stdout, stderr) => {
  let output = (stdout + '\n' + stderr).trim()

  if (error && (error as any).killed) {
    output = `Hook timed out after ${timeout}ms. Partial output:\n${output}`
  }

  resolve({
    name: hook.name,
    success: !error,
    output,
    duration: Date.now() - start
  })
})
```

---

### FIX-9: Align `canTransition` circuit breaker scope

**File:** `src/shared/pipeline-rules.ts`

Make `canTransition` check circuit breaker for all review-gated stages, not just `plan` and `implement`:

```typescript
export function canTransition(task: Task, targetStage: PipelineStage): TransitionResult {
  const stages = TIER_STAGES[task.tier]
  if (!stages.includes(targetStage)) {
    return { allowed: false, nextStage: null, reason: `Stage ${targetStage} is not part of tier ${task.tier}` }
  }

  // Check circuit breaker for any stage that uses rejection counters
  if (['brainstorm', 'design_review', 'plan'].includes(targetStage) && task.planReviewCount >= CIRCUIT_BREAKER_LIMIT) {
    return { allowed: false, nextStage: null, reason: `Circuit breaker: plan phase rejected ${task.planReviewCount} times` }
  }
  if (['implement', 'code_review', 'verify'].includes(targetStage) && task.implReviewCount >= CIRCUIT_BREAKER_LIMIT) {
    return { allowed: false, nextStage: null, reason: `Circuit breaker: implementation phase rejected ${task.implReviewCount} times` }
  }

  return { allowed: true, nextStage: targetStage, reason: 'ok' }
}
```

---

### FIX-10: Add `done` stage to rejection counter scope

**File:** `src/main/pipeline-engine.ts` (in `rejectStage`)

Add `done` to the implementation counter group since it's the final validation:

```typescript
} else if (currentStage === 'implement' || currentStage === 'code_review' || currentStage === 'verify' || currentStage === 'done') {
  updates.implReviewCount = task.implReviewCount + 1
}
```

---

## 6. Implementation Order

The fixes should be applied in this order to maximize safety:

| Order | Fix | Reason |
|-------|-----|--------|
| 1 | FIX-6 (timeout cleanup) | Smallest, prevents unhandled rejections |
| 2 | FIX-5 (pause race condition) | Critical for pause/resume reliability |
| 3 | FIX-8 (hook timeout message) | Isolated to one file, no side effects |
| 4 | FIX-7 (post-hook recursion) | Prevents counter pollution from hooks |
| 5 | FIX-3 (handoff error handling) | Prevents stuck tasks on SDK failures |
| 6 | FIX-2 (reject handoff path + degradation warning) | New method + IPC wiring + toast, medium scope |
| 7 | FIX-4 (cycle detection at creation + update) | Touches db.ts and pipeline-engine, needs careful testing |
| 8 | FIX-1 (auto-resume with configurable threshold) | Largest change: UsageMonitor + engine + settings + IPC |
| 9 | FIX-9 (canTransition scope) | Low-risk alignment fix |
| 10 | FIX-10 (done stage counter) | Minor behavior change |

---

## 7. Files to Modify

| File | Fixes |
|------|-------|
| `src/main/pipeline-engine.ts` | FIX-1, FIX-2, FIX-3, FIX-4c, FIX-5, FIX-6, FIX-7, FIX-10 |
| `src/main/usage-monitor.ts` | FIX-1 |
| `src/main/hook-runner.ts` | FIX-8 |
| `src/main/index.ts` | FIX-1, FIX-2 (IPC wiring) |
| `src/main/db.ts` | FIX-4a, FIX-4b (cycle validation in createTask + throw in addTaskDependencies) |
| `src/main/task-graph.ts` | No changes (already correct, just unused / silently consumed) |
| `src/shared/pipeline-rules.ts` | FIX-9 |
| `src/shared/settings.ts` | FIX-1 (add `usage.autoResumeThreshold` setting key + default) |
| `src/preload/index.ts` | FIX-2 (expose rejectContextHandoff + onContextDegraded) |
| `src/renderer/src/stores/pipelineStore.ts` | FIX-1 (handle usage-resumed), FIX-2 (wire rejectContextHandoff + degradation toast) |
| `src/renderer/src/global.d.ts` | FIX-2 (types for rejectContextHandoff + onContextDegraded) |

---

## 8. Testing Strategy

Each fix should be verifiable by:

1. **FIX-1:** Start a task → simulate usage threshold crossing (≥95%) → verify tasks pause → simulate usage dropping below resume threshold (configurable, default 80%) → verify tasks auto-resume. Also test: verify auto-resume does NOT fire when `usage.autoResume` setting is `false`. Verify hysteresis: tasks should not resume at 94% if threshold is 95% (must drop below `autoResumeThreshold`).
2. **FIX-2:** Trigger context handoff → dismiss in UI → verify (a) task advances to next stage in same session, (b) degradation warning toast appears, (c) task does not get stuck. Also test: approve path still works as before.
3. **FIX-3:** Trigger context handoff → simulate SDK failure → verify task goes to `blocked` with error in agent log
4. **FIX-4:** (a) Create task A depending on B, B depending on A → verify **thrown error** with cycle path. (b) Create task A, then call `addTaskDependencies` to create a cycle → verify **thrown error** (not silent return). (c) Start a task that is part of a cycle (via safety net) → verify clear error.
5. **FIX-5:** Start a stage → call `pauseTask` while running → verify final status is `paused` (not `blocked`)
6. **FIX-6:** Start a stage → simulate quick SDK failure → verify no unhandled rejection warning
7. **FIX-7:** Configure a failing post-hook → run stage → verify task goes to `blocked` (not 3x rejections). Verify rejection counter is **not** incremented. Verify error message includes the actual hook output.
8. **FIX-8:** Configure a hook with very short timeout → run → verify output says "timed out after Xms"
9. **FIX-9:** Verify `canTransition` rejects for all counter-associated stages at limit
10. **FIX-10:** Reject `done` stage 3 times → verify circuit breaker trips

---

## 9. Resolved Questions (from Revision 1)

| # | Question | Decision | Impact |
|---|----------|----------|--------|
| 1 | Should the auto-resume hysteresis threshold be configurable? | **Yes** | Added `usage.autoResumeThreshold` setting key (default 80) to `settings.ts`. `UsageMonitor` constructor accepts `resumeThreshold` parameter. |
| 2 | Should dismissing a context handoff show a degradation warning? | **Yes** | Added `stage:context_degraded` event emission in `rejectContextHandoff()`. Renderer listens for `pipeline:contextDegraded` and shows a toast. |
| 3 | Should cycle validation happen at task creation, update, or both? | **Both** | Added validation in `createTask()` (new), fixed `addTaskDependencies()` to throw instead of silently returning, kept safety net in `startTask()`. |
| 4 | Is the behavior change from auto-retry to blocking for post-hook failures acceptable without a feature flag? | **Yes** | No feature flag. Post-hook failures now block the task directly. The user retries via `stepTask()` after fixing the hook issue. |

---

## 10. Out-of-Scope Findings (for future tasks)

The audit uncovered additional issues that are beyond this bug sweep's acceptance criteria. Noting them here for future work:

1. **No concurrency guard for `runStage`:** Two concurrent `runStage` calls for the same `taskId` can overlap, causing dual SDK sessions and race conditions on DB writes. Needs a per-task mutex or lock mechanism. (Architectural — separate task.)
2. **Dangling SDK promise after timeout:** If the timeout wins `Promise.race`, the SDK promise can still resolve and write stale session/context data. The SDK promise is never cancelled. (Needs an abort controller pattern.)
3. **Only `fiveHour` bucket triggers usage warnings:** The `sevenDay`, `sevenDayOpus`, and `sevenDaySonnet` buckets are reported but never trigger `limit-approaching`. (Feature request — broader usage monitoring.)
4. **Deleted dependency = permanently stuck task:** `getReadyTaskIds` treats a missing dependency as never-done, with no error or notification. (Task graph hardening.)
5. **`resumeTask` fallback to `'implementing'`:** If `pausedFromStatus` is null (DB corruption/migration), the task silently defaults to `implementing` which may not match `currentAgent`. (Edge case hardening.)
6. **Silent JSON parse failures in `getHooksForStage`:** Misconfigured hooks produce no error — hooks just don't run. (DX improvement.)
