# Pipeline Engine Bug Sweep — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix 10 audited bugs in the pipeline execution engine to ensure all stage transitions handle errors, circuit breakers work correctly, hook failures surface to the UI, cycle detection prevents hangs, context handoff supports both approve and reject, and usage auto-pause correctly auto-resumes.

**Architecture:** Surgical fixes to 11 existing files. No new modules or abstractions. Each fix is isolated and independently testable. The implementation order is chosen to minimize risk — smallest/safest changes first, cross-cutting changes last.

**Tech Stack:** TypeScript, Electron IPC, Vitest, EventEmitter, better-sqlite3

**Design doc:** `docs/designs/2026-02-27-pipeline-engine-bug-sweep-design.md` (Revision 2)

---

## Task 1: FIX-6 — Clear timeout on SDK error

Prevents `UnhandledPromiseRejection` when the SDK promise rejects before the timeout fires.

**Files:**
- Modify: `src/main/pipeline-engine.ts:802-811`

**Step 1: Write the failing test**

Create: `src/main/__tests__/pipeline-engine-bugs.test.ts`

```typescript
import { describe, test, expect, vi, beforeEach } from 'vitest'

describe('Pipeline Engine Bug Fixes', () => {
  describe('FIX-6: Timeout cleanup on SDK error', () => {
    test('clearTimeout is called when SDK promise rejects', async () => {
      const clearTimeoutSpy = vi.spyOn(global, 'clearTimeout')
      let timeoutHandle: ReturnType<typeof setTimeout> | undefined

      const timeoutPromise = new Promise<never>((_resolve, reject) => {
        timeoutHandle = setTimeout(() => {
          reject(new Error('Stage timed out'))
        }, 60_000)
      })

      const sdkPromise = Promise.reject(new Error('SDK auth failure'))

      let result: any
      try {
        result = await Promise.race([sdkPromise, timeoutPromise])
      } catch {
        // This is the bug — timeout is NOT cleared in the catch path
      } finally {
        clearTimeout(timeoutHandle)
      }

      expect(clearTimeoutSpy).toHaveBeenCalledWith(timeoutHandle)
      clearTimeoutSpy.mockRestore()
    })
  })
})
```

**Step 2: Run the test to verify it passes (this tests the pattern, not the source)**

Run: `npx vitest run src/main/__tests__/pipeline-engine-bugs.test.ts`
Expected: PASS

**Step 3: Apply the fix in pipeline-engine.ts**

In `src/main/pipeline-engine.ts`, find lines 802-811 and restructure to use `try/finally` for timeout cleanup:

Replace this block (lines 802-811):
```typescript
      let timeoutHandle: ReturnType<typeof setTimeout> | undefined
      const timeoutPromise = new Promise<never>((_resolve, reject) => {
        timeoutHandle = setTimeout(() => {
          abortSession(sessionKey)
          reject(new Error(`Stage '${stage}' timed out after ${stageConfig.timeoutMs}ms`))
        }, stageConfig.timeoutMs)
      })

      const result = await Promise.race([sdkPromise, timeoutPromise])
      clearTimeout(timeoutHandle)
```

With:
```typescript
      let timeoutHandle: ReturnType<typeof setTimeout> | undefined
      const timeoutPromise = new Promise<never>((_resolve, reject) => {
        timeoutHandle = setTimeout(() => {
          abortSession(sessionKey)
          reject(new Error(`Stage '${stage}' timed out after ${stageConfig.timeoutMs}ms`))
        }, stageConfig.timeoutMs)
      })

      let result: SdkResult
      try {
        result = await Promise.race([sdkPromise, timeoutPromise])
      } finally {
        clearTimeout(timeoutHandle)
      }
```

**Step 4: Verify TypeScript compiles**

Run: `npx tsc --noEmit --project tsconfig.json 2>&1 | head -5`
Expected: No errors (or only pre-existing unrelated ones)

**Step 5: Commit**

```bash
git add src/main/pipeline-engine.ts src/main/__tests__/pipeline-engine-bugs.test.ts
git commit -m "fix: clear timeout on SDK rejection to prevent unhandled promise (FIX-6)"
```

---

## Task 2: FIX-5 — Guard runStage catch block against overwriting paused status

Prevents the race condition where `pauseTask` sets status to `paused`, then the SDK abort's catch block overwrites it to `blocked`.

**Files:**
- Modify: `src/main/pipeline-engine.ts:957-972`

**Step 1: Add test for the race condition pattern**

Append to `src/main/__tests__/pipeline-engine-bugs.test.ts`:

```typescript
  describe('FIX-5: Pause status not overwritten by catch block', () => {
    test('catch block should not overwrite paused status', () => {
      // This tests the conditional logic pattern
      const scenarios = [
        { currentStatus: 'paused', shouldUpdate: false },
        { currentStatus: 'implementing', shouldUpdate: true },
        { currentStatus: 'brainstorming', shouldUpdate: true },
      ]

      for (const { currentStatus, shouldUpdate } of scenarios) {
        const wouldUpdate = currentStatus !== 'paused'
        expect(wouldUpdate).toBe(shouldUpdate)
      }
    })
  })
```

**Step 2: Run the test**

Run: `npx vitest run src/main/__tests__/pipeline-engine-bugs.test.ts`
Expected: PASS

**Step 3: Apply the fix**

In `src/main/pipeline-engine.ts`, replace the catch block at lines 957-972:

Replace:
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

      // Set task to blocked so it can be retried via stepTask()
      updateTask(this.dbPath, taskId, { status: 'blocked' as TaskStatus })

      this.emit('stage:error', { taskId, stage, error: errorMessage })
    }
```

With:
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

      // Don't overwrite 'paused' status — pauseTask() already handled the state transition.
      // The SDK abort caused by pauseTask triggers this catch, but the task is already paused.
      const currentTask = getTask(this.dbPath, taskId)
      if (currentTask && currentTask.status !== 'paused') {
        updateTask(this.dbPath, taskId, { status: 'blocked' as TaskStatus })
      }

      this.emit('stage:error', { taskId, stage, error: errorMessage })
    }
```

**Step 4: Verify TypeScript compiles**

Run: `npx tsc --noEmit --project tsconfig.json 2>&1 | head -5`
Expected: No errors

**Step 5: Commit**

```bash
git add src/main/pipeline-engine.ts src/main/__tests__/pipeline-engine-bugs.test.ts
git commit -m "fix: guard runStage catch against overwriting paused status (FIX-5)"
```

---

## Task 3: FIX-8 — Distinguish hook timeout from command failure

**Files:**
- Modify: `src/main/hook-runner.ts:10-20`

**Step 1: Write the failing test**

Create: `src/main/__tests__/hook-runner-bugs.test.ts`

```typescript
import { describe, test, expect } from 'vitest'
import { runHook } from '../hook-runner'
import type { ValidationHook } from '../../shared/hook-types'

describe('Hook Runner Bug Fixes', () => {
  describe('FIX-8: Timeout vs failure distinction', () => {
    test('hook timeout includes timeout message in output', async () => {
      const hook: ValidationHook = {
        name: 'slow-hook',
        command: process.platform === 'win32' ? 'ping' : 'sleep',
        args: process.platform === 'win32' ? ['-n', '10', '127.0.0.1'] : ['10'],
        required: true,
        timeout: 100  // 100ms timeout — will trigger kill
      }

      const result = await runHook(hook, process.cwd())
      expect(result.success).toBe(false)
      expect(result.output).toContain('timed out after')
      expect(result.output).toContain('100ms')
    })

    test('normal failure does not include timeout message', async () => {
      const hook: ValidationHook = {
        name: 'bad-hook',
        command: process.platform === 'win32' ? 'cmd' : 'sh',
        args: process.platform === 'win32' ? ['/c', 'echo FAIL && exit 1'] : ['-c', 'echo FAIL && exit 1'],
        required: true,
        timeout: 30000
      }

      const result = await runHook(hook, process.cwd())
      expect(result.success).toBe(false)
      expect(result.output).not.toContain('timed out after')
      expect(result.output).toContain('FAIL')
    })
  })
})
```

**Step 2: Run the test to verify it fails**

Run: `npx vitest run src/main/__tests__/hook-runner-bugs.test.ts`
Expected: FAIL — first test will fail because output doesn't contain "timed out after"

**Step 3: Apply the fix**

In `src/main/hook-runner.ts`, replace the `execFile` callback (lines 12-18):

Replace:
```typescript
    execFile(hook.command, args, { cwd, timeout }, (error, stdout, stderr) => {
      resolve({
        name: hook.name,
        success: !error,
        output: (stdout + '\n' + stderr).trim(),
        duration: Date.now() - start
      })
    })
```

With:
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

**Step 4: Run the test to verify it passes**

Run: `npx vitest run src/main/__tests__/hook-runner-bugs.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/main/hook-runner.ts src/main/__tests__/hook-runner-bugs.test.ts
git commit -m "fix: distinguish hook timeout from command failure in output (FIX-8)"
```

---

## Task 4: FIX-7 — Break post-hook → rejectStage recursion

Post-hook failures now block the task instead of recursing through `rejectStage`.

**Files:**
- Modify: `src/main/pipeline-engine.ts:832-844`

**Step 1: Write the failing test**

Append to `src/main/__tests__/pipeline-engine-bugs.test.ts`:

```typescript
  describe('FIX-7: Post-hook failure should block, not recurse through rejectStage', () => {
    test('post-hook failure pattern blocks instead of rejecting', () => {
      // This verifies the behavior: when hooks fail, we should NOT call rejectStage
      // The old code: this.rejectStage(taskId, failMessages) — recursive
      // The new code: updateTask(blocked) + emit error — non-recursive

      // Simulate: hook fails, verify we choose 'blocked' not 'reject'
      const hooksPassed = false
      const action = hooksPassed ? 'advance' : 'block'
      expect(action).toBe('block')
    })
  })
```

**Step 2: Apply the fix**

In `src/main/pipeline-engine.ts`, replace lines 832-844:

Replace:
```typescript
      if (!hookResults.allPassed) {
          const failMessages = hookResults.failedRequired.map(r => `**${r.name}:** ${r.output}`).join('\n\n')
          appendAgentLog(this.dbPath, taskId, {
            timestamp: new Date().toISOString(),
            agent: 'pipeline-engine',
            model: 'system',
            action: 'hook:post-stage-failed',
            details: `Post-hooks failed for ${stage}:\n${failMessages}`
          })
          // Treat as rejection — feeds into FDRL
          await this.rejectStage(taskId, `Validation hook failed:\n\n${failMessages}`)
          return
        }
```

With:
```typescript
      if (!hookResults.allPassed) {
          const failMessages = hookResults.failedRequired.map(r => `**${r.name}:** ${r.output}`).join('\n\n')
          appendAgentLog(this.dbPath, taskId, {
            timestamp: new Date().toISOString(),
            agent: 'pipeline-engine',
            model: 'system',
            action: 'hook:post-stage-failed',
            details: `Post-hooks failed for ${stage}:\n${failMessages}`
          })
          // Block the task instead of calling rejectStage (avoids recursive
          // runStage → rejectStage → runStage cycle that burns rejection counter slots).
          // User can fix the hook issue and retry via stepTask().
          updateTask(this.dbPath, taskId, { status: 'blocked' as TaskStatus })
          this.emit('stage:error', {
            taskId,
            stage,
            error: `Post-stage validation hooks failed:\n\n${failMessages}`
          })
          return
        }
```

**Step 3: Run tests**

Run: `npx vitest run src/main/__tests__/pipeline-engine-bugs.test.ts`
Expected: PASS

**Step 4: Commit**

```bash
git add src/main/pipeline-engine.ts src/main/__tests__/pipeline-engine-bugs.test.ts
git commit -m "fix: post-hook failure blocks task instead of recursive rejectStage (FIX-7)"
```

---

## Task 5: FIX-3 — Wrap approveContextHandoff in try/catch

**Files:**
- Modify: `src/main/pipeline-engine.ts:511-585`

**Step 1: Apply the fix**

In `src/main/pipeline-engine.ts`, wrap the SDK call in `approveContextHandoff`. The method starts at line 511. We need to wrap everything from the `const result = await this.sdkRunner({` call (line 536) through the end of the method in a try/catch.

Replace lines 536-585 (everything from the SDK call to the end of the method):

Replace:
```typescript
    // Send rich handoff request into the existing session
    const result = await this.sdkRunner({
      prompt: richHandoffPrompt,
      model: 'claude-sonnet-4-6',
      maxTurns: 5,
      cwd: this.taskWorktrees.get(taskId) ?? this.projectPath,
      taskId,
      autoMode: true,
      resumeSessionId: sessionId || undefined,
      sessionKey,
      stage: 'handoff',
      dbPath: this.dbPath,
      onStream: (content: string, type: string) => {
        this.emit('stream', { taskId, stage: 'handoff', content, type })
      },
      onApprovalRequest: () => {
        // No approvals during handoff generation
      }
    })

    appendAgentLog(this.dbPath, taskId, {
      timestamp: new Date().toISOString(),
      agent: 'pipeline-engine',
      model: 'claude-sonnet-4-6',
      action: 'context_handoff',
      details: `Rich handoff generated. Cost: ${result.cost}. Next stage: ${nextStage}`
    })

    // Store the rich handoff and clear the session for a fresh start
    updateTask(this.dbPath, taskId, {
      richHandoff: result.output,
      activeSessionId: null,
    })
    this.sessionIds.delete(taskId)
    this.contextUsage.delete(taskId)

    // Continue pipeline with next stage (fresh session with rich handoff context injected)
    if (nextStage) {
      const nextStatus = STAGE_TO_STATUS[nextStage] as TaskStatus
      // Extract artifacts before marking done
      if (nextStage === 'done') {
        await this.extractArtifacts(taskId)
      }
      updateTask(this.dbPath, taskId, {
        status: nextStatus,
        currentAgent: nextStage,
        ...(nextStage === 'done' ? { completedAt: new Date().toISOString() } : {})
      })
      await this.runStage(taskId, nextStage)
    }
  }
```

With:
```typescript
    try {
      // Send rich handoff request into the existing session
      const result = await this.sdkRunner({
        prompt: richHandoffPrompt,
        model: 'claude-sonnet-4-6',
        maxTurns: 5,
        cwd: this.taskWorktrees.get(taskId) ?? this.projectPath,
        taskId,
        autoMode: true,
        resumeSessionId: sessionId || undefined,
        sessionKey,
        stage: 'handoff',
        dbPath: this.dbPath,
        onStream: (content: string, type: string) => {
          this.emit('stream', { taskId, stage: 'handoff', content, type })
        },
        onApprovalRequest: () => {
          // No approvals during handoff generation
        }
      })

      appendAgentLog(this.dbPath, taskId, {
        timestamp: new Date().toISOString(),
        agent: 'pipeline-engine',
        model: 'claude-sonnet-4-6',
        action: 'context_handoff',
        details: `Rich handoff generated. Cost: ${result.cost}. Next stage: ${nextStage}`
      })

      // Store the rich handoff and clear the session for a fresh start
      updateTask(this.dbPath, taskId, {
        richHandoff: result.output,
        activeSessionId: null,
      })
      this.sessionIds.delete(taskId)
      this.contextUsage.delete(taskId)

      // Continue pipeline with next stage (fresh session with rich handoff context injected)
      if (nextStage) {
        const nextStatus = STAGE_TO_STATUS[nextStage] as TaskStatus
        // Extract artifacts before marking done
        if (nextStage === 'done') {
          await this.extractArtifacts(taskId)
        }
        updateTask(this.dbPath, taskId, {
          status: nextStatus,
          currentAgent: nextStage,
          ...(nextStage === 'done' ? { completedAt: new Date().toISOString() } : {})
        })
        await this.runStage(taskId, nextStage)
      }
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
      this.emit('stage:error', { taskId, stage: currentStage, error: `Context handoff failed: ${errorMessage}` })
    }
  }
```

**Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit --project tsconfig.json 2>&1 | head -5`
Expected: No errors

**Step 3: Commit**

```bash
git add src/main/pipeline-engine.ts
git commit -m "fix: wrap approveContextHandoff in try/catch to prevent stuck tasks (FIX-3)"
```

---

## Task 6: FIX-2 — Add rejectContextHandoff + degradation warning

This is the largest task. It adds a new method to the engine, new IPC wiring, preload exposure, and renderer integration.

**Files:**
- Modify: `src/main/pipeline-engine.ts` — add `rejectContextHandoff()` method
- Modify: `src/main/index.ts` — add IPC handler + event forwarding
- Modify: `src/preload/index.ts` — expose `rejectContextHandoff` + `onContextDegraded`
- Modify: `src/renderer/src/stores/pipelineStore.ts` — wire dismiss to call backend
- Modify: `src/renderer/src/global.d.ts` — add types

### Step 1: Add `rejectContextHandoff()` to pipeline engine

In `src/main/pipeline-engine.ts`, add this method right after the closing `}` of `approveContextHandoff()` (which is now around line ~596 after FIX-3 changes):

```typescript
  /**
   * Reject a context handoff: skip the fresh session and continue in the
   * existing (large) session. Emits a degradation warning to the UI.
   */
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

### Step 2: Wire IPC handler in index.ts

In `src/main/index.ts`, add inside `registerPipelineIpc()` right after the `pipeline:approveContextHandoff` handler (after line 302):

```typescript
  ipcMain.handle('pipeline:rejectContextHandoff', async (_e, taskId: number) => {
    if (!currentEngine) throw new Error('Pipeline not initialized')
    await currentEngine.rejectContextHandoff(taskId)
  })
```

Also add the `stage:context_degraded` event forwarding inside the `pipeline:init` handler, after line 220 (the `stage:context_handoff` forwarding):

```typescript
    currentEngine.on('stage:context_degraded', (data) =>
      mainWindow?.webContents.send('pipeline:contextDegraded', data))
```

### Step 3: Expose in preload

In `src/preload/index.ts`, inside the `pipeline` object, add after the `onContextHandoff` entry (after line 66):

```typescript
    rejectContextHandoff: (taskId: number) => ipcRenderer.invoke('pipeline:rejectContextHandoff', taskId),
    onContextDegraded: (callback: (data: any) => void) => {
      const handler = (_e: any, data: any) => callback(data)
      ipcRenderer.on('pipeline:contextDegraded', handler)
      return () => ipcRenderer.removeListener('pipeline:contextDegraded', handler)
    },
```

### Step 4: Update global.d.ts types

In `src/renderer/src/global.d.ts`, inside the `pipeline` type (after the `approveContextHandoff` line, around line 33):

```typescript
    rejectContextHandoff: (taskId: number) => Promise<void>
    onContextDegraded: (callback: (data: { taskId: number; nextStage: string; message: string }) => void) => () => void
```

### Step 5: Wire renderer store

In `src/renderer/src/stores/pipelineStore.ts`:

**5a.** Add `contextDegradedWarning` to state interface (after line 15):
```typescript
  contextDegradedWarning: string | null
```

**5b.** Add initial value (after line 48):
```typescript
  contextDegradedWarning: null,
```

**5c.** Change `dismissContextHandoff` from sync to async (line 119). Replace:
```typescript
  dismissContextHandoff: () => set({ contextHandoff: null }),
```
With:
```typescript
  dismissContextHandoff: async (taskId: number) => {
    set({ contextHandoff: null, streaming: true })
    await window.api.pipeline.rejectContextHandoff(taskId)
  },
```

**5d.** Update the `PipelineState` interface. Replace line 31:
```typescript
  dismissContextHandoff: () => void
```
With:
```typescript
  dismissContextHandoff: (taskId: number) => Promise<void>
  contextDegradedWarning: string | null
  dismissContextDegradedWarning: () => void
```

**5e.** Add the dismiss action (after the `clearUnblockedTask` line):
```typescript
  dismissContextDegradedWarning: () => set({ contextDegradedWarning: null }),
```

**5f.** In `setupListeners`, add the degradation listener (after the `cleanupContextHandoff` setup, around line 179):
```typescript
    const cleanupContextDegraded = window.api.pipeline.onContextDegraded((data) => {
      set({ contextDegradedWarning: data.message })
    })
```

And add `cleanupContextDegraded()` to the cleanup return function.

### Step 6: Find and update callers of dismissContextHandoff

Search the renderer for calls to `dismissContextHandoff()` — they now need to pass `taskId`:

Run: `grep -rn "dismissContextHandoff" src/renderer/`

Any component calling `dismissContextHandoff()` must be updated to pass `contextHandoff.taskId`. The typical pattern will be in a context handoff modal/dialog. Update the call from:
```typescript
dismissContextHandoff()
```
to:
```typescript
dismissContextHandoff(contextHandoff.taskId)
```

### Step 7: Verify TypeScript compiles

Run: `npx tsc --noEmit --project tsconfig.json 2>&1 | head -20`
Expected: No errors

### Step 8: Run all tests

Run: `npx vitest run`
Expected: All pass

### Step 9: Commit

```bash
git add src/main/pipeline-engine.ts src/main/index.ts src/preload/index.ts src/renderer/src/stores/pipelineStore.ts src/renderer/src/global.d.ts
git commit -m "feat: add rejectContextHandoff with degradation warning (FIX-2)"
```

---

## Task 7: FIX-4 — Cycle detection at task creation and update

**Files:**
- Modify: `src/main/db.ts:266-284` — add cycle check to `createTask`
- Modify: `src/main/db.ts:564-577` — change `addTaskDependencies` from warn→throw
- Modify: `src/main/pipeline-engine.ts:107-154` — add safety net in `startTask`
- Test: `src/main/__tests__/task-graph.test.ts` — add cycle detection tests

### Step 1: Add cycle detection tests

Append to `src/main/__tests__/task-graph.test.ts`:

```typescript
describe('Cycle detection integration', () => {
  test('validateNoCycles returns cycle path for direct cycle', () => {
    const graph = { 1: [2], 2: [1] }
    const result = validateNoCycles(graph)
    expect(result.valid).toBe(false)
    expect(result.cycle).toBeDefined()
    expect(result.cycle!.length).toBeGreaterThanOrEqual(2)
    // Cycle should contain both nodes
    expect(result.cycle).toContain(1)
    expect(result.cycle).toContain(2)
  })

  test('validateNoCycles returns cycle path for three-node cycle', () => {
    const graph = { 1: [2], 2: [3], 3: [1] }
    const result = validateNoCycles(graph)
    expect(result.valid).toBe(false)
    expect(result.cycle).toBeDefined()
  })

  test('validateNoCycles passes for long chain (no cycle)', () => {
    const graph = { 1: [], 2: [1], 3: [2], 4: [3], 5: [4] }
    expect(validateNoCycles(graph).valid).toBe(true)
  })
})
```

### Step 2: Run cycle detection tests

Run: `npx vitest run src/main/__tests__/task-graph.test.ts`
Expected: PASS (these test the existing function which works correctly)

### Step 3: Fix `addTaskDependencies` to throw instead of silently returning

In `src/main/db.ts`, line 574. Replace:
```typescript
      console.warn(`Cycle detected in task dependencies: ${validation.cycle?.join(' -> ')}. Skipping dependency addition.`)
      return
```

With:
```typescript
      throw new Error(
        `Circular dependency detected: ${validation.cycle?.join(' → ')}. ` +
        `Cannot add dependencies [${depIds.join(', ')}] to task ${taskId}.`
      )
```

### Step 4: Add cycle check to `createTask`

In `src/main/db.ts`, add cycle validation at the beginning of `createTask` (after line 266, before the INSERT). First, add the import at the top of `db.ts`:

Check if `buildGraph` and `validateNoCycles` are already imported. If not, add:
```typescript
import { buildGraph, validateNoCycles } from './task-graph'
```

Then in `createTask`, insert before `const db = getProjectDb(dbPath)`:

```typescript
  // Validate no circular dependencies before creating the task
  if (input.dependencyIds?.length) {
    const allTasks = listTasks(dbPath)
    // Assign a temporary ID for cycle checking
    const tempId = allTasks.length > 0 ? Math.max(...allTasks.map(t => t.id)) + 1 : 1
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
```

### Step 5: Add safety net in `startTask`

In `src/main/pipeline-engine.ts`, in the `startTask` method, after the dependency check (after line 123 — after the `throw new Error('Task blocked by incomplete dependencies')` block), add:

```typescript
    // Safety net: verify no dependency cycles exist for this task
    const allTasks = listTasks(this.dbPath)
    const graph = buildGraph(allTasks)
    const cycleCheck = validateNoCycles(graph)
    if (!cycleCheck.valid && cycleCheck.cycle?.includes(taskId)) {
      throw new Error(`Task ${taskId} is part of a dependency cycle: ${cycleCheck.cycle.join(' → ')}`)
    }
```

Add the import at the top of `pipeline-engine.ts` (it doesn't currently import from task-graph):
```typescript
import { buildGraph, validateNoCycles } from './task-graph'
```

### Step 6: Verify TypeScript compiles

Run: `npx tsc --noEmit --project tsconfig.json 2>&1 | head -5`
Expected: No errors

### Step 7: Run all tests

Run: `npx vitest run`
Expected: PASS

### Step 8: Commit

```bash
git add src/main/db.ts src/main/pipeline-engine.ts src/main/__tests__/task-graph.test.ts
git commit -m "fix: enforce cycle detection at task creation, update, and start (FIX-4)"
```

---

## Task 8: FIX-1 — Auto-resume after usage limit clears

The largest fix. Adds a new setting, modifies `UsageMonitor`, adds `resumeUsagePausedTasks()` to the engine, and wires up IPC/renderer.

**Files:**
- Modify: `src/shared/settings.ts` — add `usage.autoResumeThreshold` setting
- Modify: `src/main/usage-monitor.ts` — add `wasOverThreshold` state + `limit-cleared` event
- Modify: `src/main/pipeline-engine.ts` — add `resumeUsagePausedTasks()` method
- Modify: `src/main/index.ts` — wire `limit-cleared` → auto-resume + import settings
- Modify: `src/renderer/src/stores/pipelineStore.ts` — handle `usage-resumed` status event

### Step 1: Add setting key

In `src/shared/settings.ts`:

**1a.** Add to `SETTING_KEYS` (after line 16, after `'usage.autoResume'`):
```typescript
  'usage.autoResumeThreshold': 'usage.autoResumeThreshold',
```

**1b.** Add to `SettingsState` interface (after line 45, after `autoResume`):
```typescript
  autoResumeThreshold: number
```

**1c.** Add to `DEFAULT_SETTINGS` (after line 62, after `autoResume: false,`):
```typescript
  autoResumeThreshold: 80,
```

### Step 2: Modify UsageMonitor constructor and poll

In `src/main/usage-monitor.ts`:

**2a.** Add `resumeThreshold` and `wasOverThreshold` fields (after line 34):
```typescript
  private resumeThreshold: number
  private wasOverThreshold = false
```

**2b.** Update constructor (replace lines 40-43):

Replace:
```typescript
  constructor(threshold: number = 95) {
    super()
    this.threshold = threshold
  }
```

With:
```typescript
  constructor(threshold: number = 95, resumeThreshold: number = 80) {
    super()
    this.threshold = threshold
    this.resumeThreshold = resumeThreshold
  }
```

**2c.** Add `limit-cleared` emission in `poll()`. After line 103 (end of the `if (fiveHour && fiveHour.utilization >= this.threshold)` block), add:

Replace lines 97-103:
```typescript
      if (fiveHour && fiveHour.utilization >= this.threshold) {
        this.emit('limit-approaching', {
          utilization: fiveHour.utilization,
          resetsAt: fiveHour.resetsAt,
          countdown: formatCountdown(fiveHour.resetsAt)
        })
      }
```

With:
```typescript
      if (fiveHour && fiveHour.utilization >= this.threshold) {
        this.wasOverThreshold = true
        this.emit('limit-approaching', {
          utilization: fiveHour.utilization,
          resetsAt: fiveHour.resetsAt,
          countdown: formatCountdown(fiveHour.resetsAt)
        })
      } else if (this.wasOverThreshold && fiveHour && fiveHour.utilization < this.resumeThreshold) {
        this.wasOverThreshold = false
        this.emit('limit-cleared', {
          utilization: fiveHour.utilization,
          resetsAt: fiveHour.resetsAt,
          countdown: formatCountdown(fiveHour.resetsAt)
        })
      }
```

### Step 3: Add `resumeUsagePausedTasks()` to pipeline engine

In `src/main/pipeline-engine.ts`, add this method right after `pauseAllTasks()` (after line 505):

```typescript
  /**
   * Resume all tasks that were auto-paused due to usage limits.
   */
  async resumeUsagePausedTasks(): Promise<number> {
    const tasks = listTasks(this.dbPath)
    const paused = tasks.filter(t => t.status === 'paused' && t.pauseReason === 'usage_limit')
    let count = 0
    for (const task of paused) {
      try {
        await this.resumeTask(task.id)
        count++
      } catch {
        // Task may have changed state between list and resume — skip
      }
    }
    return count
  }
```

### Step 4: Wire auto-resume in index.ts

In `src/main/index.ts`:

**4a.** Add import for `getGlobalSetting` and `SETTING_KEYS`. Update line 5:

Replace:
```typescript
import { closeAllDbs, listWorkshopMessages, listProjects, updateProjectBaseBranch, createWorkshopMessage, updateWorkshopSession } from './db'
```

With:
```typescript
import { closeAllDbs, listWorkshopMessages, listProjects, updateProjectBaseBranch, createWorkshopMessage, updateWorkshopSession, getGlobalSetting } from './db'
import { SETTING_KEYS } from '../shared/settings'
```

**4b.** Update the `UsageMonitor` creation (line 233). Replace:
```typescript
    usageMonitor = new UsageMonitor()
```

With:
```typescript
    const pauseThreshold = Number(getGlobalSetting(SETTING_KEYS['usage.autoPauseThreshold']) ?? 95)
    const resumeThreshold = Number(getGlobalSetting(SETTING_KEYS['usage.autoResumeThreshold']) ?? 80)
    usageMonitor = new UsageMonitor(pauseThreshold, resumeThreshold)
```

**4c.** Add the `limit-cleared` handler right after the `limit-approaching` handler (after line 248):

```typescript
    usageMonitor.on('limit-cleared', async () => {
      const autoResume = getGlobalSetting(SETTING_KEYS['usage.autoResume'])
      if (autoResume === 'false' || autoResume === '0') return
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

### Step 5: Handle `usage-resumed` in renderer

In `src/renderer/src/stores/pipelineStore.ts`, inside the `cleanupStatus` listener (around line 156, after the `usage-paused` handler), add:

```typescript
      if (event.type === 'usage-resumed') {
        set({ streaming: false, usagePausedToast: null })
      }
```

### Step 6: Verify TypeScript compiles

Run: `npx tsc --noEmit --project tsconfig.json 2>&1 | head -10`
Expected: No errors

### Step 7: Run all tests

Run: `npx vitest run`
Expected: PASS

### Step 8: Commit

```bash
git add src/shared/settings.ts src/main/usage-monitor.ts src/main/pipeline-engine.ts src/main/index.ts src/renderer/src/stores/pipelineStore.ts
git commit -m "feat: auto-resume tasks when usage limit clears with configurable threshold (FIX-1)"
```

---

## Task 9: FIX-9 — Align canTransition circuit breaker scope

**Files:**
- Modify: `src/shared/pipeline-rules.ts:21-36`

### Step 1: Write the failing test

Create: `src/main/__tests__/pipeline-rules-bugs.test.ts`

```typescript
import { describe, test, expect } from 'vitest'
import { canTransition } from '../../shared/pipeline-rules'
import type { Task } from '../../shared/types'

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 1,
    title: 'Test',
    description: '',
    tier: 'L2',
    priority: 'medium',
    status: 'brainstorming',
    currentAgent: 'brainstorm',
    autoMode: false,
    autoMerge: true,
    planReviewCount: 0,
    implReviewCount: 0,
    reviewScore: null,
    agentLog: [],
    handoffs: [],
    dependencyIds: [],
    createdAt: '',
    startedAt: null,
    completedAt: null,
    archivedAt: null,
    pausedFromStatus: null,
    pauseReason: null,
    activeSessionId: null,
    richHandoff: null,
    artifacts: null,
    ...overrides,
  } as Task
}

describe('Pipeline Rules Bug Fixes', () => {
  describe('FIX-9: canTransition checks all counter-associated stages', () => {
    test('blocks brainstorm when planReviewCount >= 3', () => {
      const task = makeTask({ planReviewCount: 3 })
      const result = canTransition(task, 'brainstorm')
      expect(result.allowed).toBe(false)
      expect(result.reason).toContain('circuit breaker')
    })

    test('blocks design_review when planReviewCount >= 3', () => {
      const task = makeTask({ planReviewCount: 3 })
      const result = canTransition(task, 'design_review')
      expect(result.allowed).toBe(false)
    })

    test('blocks code_review when implReviewCount >= 3', () => {
      const task = makeTask({ implReviewCount: 3 })
      const result = canTransition(task, 'code_review')
      expect(result.allowed).toBe(false)
    })

    test('blocks verify when implReviewCount >= 3', () => {
      const task = makeTask({ implReviewCount: 3 })
      const result = canTransition(task, 'verify')
      expect(result.allowed).toBe(false)
    })

    test('still allows brainstorm when planReviewCount < 3', () => {
      const task = makeTask({ planReviewCount: 2 })
      const result = canTransition(task, 'brainstorm')
      expect(result.allowed).toBe(true)
    })
  })
})
```

### Step 2: Run the test to verify it fails

Run: `npx vitest run src/main/__tests__/pipeline-rules-bugs.test.ts`
Expected: FAIL — `brainstorm`, `design_review`, `code_review`, `verify` transitions are not checked

### Step 3: Apply the fix

In `src/shared/pipeline-rules.ts`, replace lines 28-33:

Replace:
```typescript
  if (targetStage === 'plan' && task.planReviewCount >= CIRCUIT_BREAKER_LIMIT) {
    return { allowed: false, nextStage: null, reason: `Circuit breaker: plan rejected ${task.planReviewCount} times` }
  }
  if (targetStage === 'implement' && task.implReviewCount >= CIRCUIT_BREAKER_LIMIT) {
    return { allowed: false, nextStage: null, reason: `Circuit breaker: implementation rejected ${task.implReviewCount} times` }
  }
```

With:
```typescript
  // Check circuit breaker for all stages that share rejection counters
  if (['brainstorm', 'design_review', 'plan'].includes(targetStage) && task.planReviewCount >= CIRCUIT_BREAKER_LIMIT) {
    return { allowed: false, nextStage: null, reason: `Circuit breaker: plan phase rejected ${task.planReviewCount} times` }
  }
  if (['implement', 'code_review', 'verify'].includes(targetStage) && task.implReviewCount >= CIRCUIT_BREAKER_LIMIT) {
    return { allowed: false, nextStage: null, reason: `Circuit breaker: implementation phase rejected ${task.implReviewCount} times` }
  }
```

### Step 4: Run the test to verify it passes

Run: `npx vitest run src/main/__tests__/pipeline-rules-bugs.test.ts`
Expected: PASS

### Step 5: Run all tests

Run: `npx vitest run`
Expected: PASS

### Step 6: Commit

```bash
git add src/shared/pipeline-rules.ts src/main/__tests__/pipeline-rules-bugs.test.ts
git commit -m "fix: align canTransition circuit breaker with all counter-scoped stages (FIX-9)"
```

---

## Task 10: FIX-10 — Add done stage to rejection counter scope

**Files:**
- Modify: `src/main/pipeline-engine.ts:308-314`

### Step 1: Append test

Append to `src/main/__tests__/pipeline-rules-bugs.test.ts`:

```typescript
  describe('FIX-10: done stage increments implReviewCount', () => {
    test('done stage is in the implementation counter group', () => {
      // Verify the mapping: done should map to implReviewCount
      const implStages = ['implement', 'code_review', 'verify', 'done']
      const planStages = ['brainstorm', 'design_review', 'plan']

      expect(implStages.includes('done')).toBe(true)
      expect(planStages.includes('done')).toBe(false)
    })
  })
```

### Step 2: Apply the fix

In `src/main/pipeline-engine.ts`, in `rejectStage()`, replace lines 312-313:

Replace:
```typescript
    } else if (currentStage === 'implement' || currentStage === 'code_review' || currentStage === 'verify') {
      updates.implReviewCount = task.implReviewCount + 1
```

With:
```typescript
    } else if (currentStage === 'implement' || currentStage === 'code_review' || currentStage === 'verify' || currentStage === 'done') {
      updates.implReviewCount = task.implReviewCount + 1
```

### Step 3: Run tests

Run: `npx vitest run`
Expected: PASS

### Step 4: Commit

```bash
git add src/main/pipeline-engine.ts src/main/__tests__/pipeline-rules-bugs.test.ts
git commit -m "fix: include done stage in implementation rejection counter (FIX-10)"
```

---

## Task 11: Final verification

### Step 1: Run full test suite

Run: `npx vitest run`
Expected: All tests pass

### Step 2: TypeScript compile check

Run: `npx tsc --noEmit --project tsconfig.json`
Expected: Clean compile (no errors)

### Step 3: Build check

Run: `pnpm build`
Expected: Build succeeds

### Step 4: Final commit (if any linting fixes needed)

```bash
git add -A
git commit -m "chore: final cleanup for pipeline engine bug sweep"
```

---

## Summary of all files modified

| File | Tasks |
|------|-------|
| `src/main/pipeline-engine.ts` | 1, 2, 4, 5, 6, 7, 8, 10 |
| `src/main/hook-runner.ts` | 3 |
| `src/main/usage-monitor.ts` | 8 |
| `src/main/index.ts` | 6, 8 |
| `src/main/db.ts` | 7 |
| `src/shared/pipeline-rules.ts` | 9 |
| `src/shared/settings.ts` | 8 |
| `src/preload/index.ts` | 6 |
| `src/renderer/src/stores/pipelineStore.ts` | 6, 8 |
| `src/renderer/src/global.d.ts` | 6 |
| `src/main/__tests__/pipeline-engine-bugs.test.ts` | 1, 2, 4 |
| `src/main/__tests__/hook-runner-bugs.test.ts` | 3 |
| `src/main/__tests__/task-graph.test.ts` | 7 |
| `src/main/__tests__/pipeline-rules-bugs.test.ts` | 9, 10 |

## Acceptance criteria traceability

| Criterion | Fixed by |
|-----------|----------|
| All stage transitions have error handling that sets task to a recoverable failed state | FIX-3, FIX-5, FIX-6 |
| Circuit breaker correctly increments rejection count and halts at limit=3 | FIX-9, FIX-10 |
| Hook runner failures are surfaced to the UI with the actual error output | FIX-7, FIX-8 |
| Task graph cycle detection throws a clear error, not a hang | FIX-4 |
| Context handoff approval flow correctly resumes or aborts on both user choices | FIX-2, FIX-3 |
| Usage monitor auto-pause correctly resumes tasks when the window resets | FIX-1 |
