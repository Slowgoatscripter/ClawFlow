# Stage-Aware Task Restart — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the current "wipe everything" restart with a stage-aware restart that rolls the git worktree back to the last successful stage commit and clears only the affected DB state.

**Architecture:** Two new `GitEngine` methods handle git rollback (stash+reset and reset-to-stage-commit). A new `PipelineEngine.restartToStage()` method orchestrates the restart: aborts sessions, calls git rollback, selectively clears DB fields, and sets the task to the target stage. A new IPC channel bridges this to the renderer, where the restart button becomes a dropdown with stage options.

**Tech Stack:** Electron IPC, better-sqlite3, git CLI (via execa), React (MUI components)

**Design doc:** `docs/plans/2026-02-26-task-restart-design.md`

---

### Task 1: Add `stashAndReset()` to GitEngine

**Files:**
- Modify: `src/main/git-engine.ts` (add after `cleanupWorktree` method, ~line 175)

**Step 1: Implement `stashAndReset`**

Add this method after `cleanupWorktree()`:

```ts
async stashAndReset(taskId: number): Promise<{ stashed: boolean }> {
  const worktreePath = this.activeWorktrees.get(taskId)
  if (!worktreePath) throw new Error(`No active worktree for task ${taskId}`)

  let stashed = false

  // Check if there are uncommitted changes to stash
  const status = await this.git(worktreePath, ['status', '--porcelain'])
  if (status.stdout.trim()) {
    try {
      await this.git(worktreePath, ['stash', 'push', '-m', `task/${taskId}: restart stash`])
      stashed = true
    } catch {
      // Nothing to stash or stash failed — proceed anyway
    }
  }

  // Find merge-base (where this branch diverged from base)
  const mergeBase = await this.git(worktreePath, [
    'merge-base', this.baseBranch, 'HEAD'
  ])
  const baseCommit = mergeBase.stdout.trim()

  await this.git(worktreePath, ['reset', '--hard', baseCommit])

  return { stashed }
}
```

**Step 2: Run existing tests (if any) to verify no regressions**

Run: `npm test` (or `npx vitest run` — check package.json for test command)
Expected: All existing tests pass

**Step 3: Commit**

```bash
git add src/main/git-engine.ts
git commit -m "feat: add stashAndReset to GitEngine for full task restart"
```

---

### Task 2: Add `resetToStageCommit()` to GitEngine

**Files:**
- Modify: `src/main/git-engine.ts` (add after `stashAndReset`)

**Step 1: Implement `resetToStageCommit`**

Add this method right after `stashAndReset()`:

```ts
async resetToStageCommit(taskId: number, stage: string): Promise<void> {
  const worktreePath = this.activeWorktrees.get(taskId)
  if (!worktreePath) throw new Error(`No active worktree for task ${taskId}`)

  // Find the commit for the given stage using the commit message convention
  const commitMsg = `task/${taskId}: complete ${stage} stage`
  const log = await this.git(worktreePath, [
    'log', '--oneline', '--grep', commitMsg, '--format=%H', '-1'
  ])
  const commitHash = log.stdout.trim()

  if (!commitHash) {
    // Commit not found — fall back to stashAndReset
    console.warn(`Stage commit not found for task ${taskId} stage ${stage}, falling back to stashAndReset`)
    await this.stashAndReset(taskId)
    return
  }

  // Stash any uncommitted changes first
  const status = await this.git(worktreePath, ['status', '--porcelain'])
  if (status.stdout.trim()) {
    try {
      await this.git(worktreePath, ['stash', 'push', '-m', `task/${taskId}: restart stash before reset to ${stage}`])
    } catch {
      // Proceed even if stash fails
    }
  }

  await this.git(worktreePath, ['reset', '--hard', commitHash])
}
```

**Step 2: Commit**

```bash
git add src/main/git-engine.ts
git commit -m "feat: add resetToStageCommit to GitEngine for stage-aware rollback"
```

---

### Task 3: Add stage field clearing helper to constants

**Files:**
- Modify: `src/shared/constants.ts` (add after `STAGE_TO_STATUS` mapping, ~line 102)

**Step 1: Add the stage-to-DB-fields mapping**

```ts
/** DB fields to clear when restarting from each stage */
export const STAGE_CLEAR_FIELDS: Record<string, string[]> = {
  brainstorm: ['brainstormOutput'],
  design_review: ['designReview'],
  plan: ['plan', 'planReviewCount'],
  implement: ['implementationNotes', 'commitHash'],
  code_review: ['reviewComments', 'reviewScore', 'implReviewCount'],
  verify: ['testResults', 'verifyResult'],
  done: ['completedAt']
}

/**
 * Returns the DB update payload to clear all stage fields at and after targetStage
 * for the given tier's stage sequence.
 */
export function getClearFieldsPayload(
  tier: 'L1' | 'L2' | 'L3',
  targetStage: string
): Record<string, null | number | never[]> {
  const stages = TIER_STAGES[tier]
  const targetIndex = stages.indexOf(targetStage)
  if (targetIndex === -1) return {}

  const payload: Record<string, null | number | never[]> = {}

  for (let i = targetIndex; i < stages.length; i++) {
    const stage = stages[i]
    const fields = STAGE_CLEAR_FIELDS[stage]
    if (!fields) continue
    for (const field of fields) {
      // Reset counters to 0, everything else to null
      if (field.endsWith('Count')) {
        payload[field] = 0
      } else {
        payload[field] = null
      }
    }
  }

  // Always clear these on any restart
  payload['activeSessionId'] = null
  payload['richHandoff'] = null
  payload['currentAgent'] = null
  payload['todos'] = null
  payload['handoffs'] = []

  return payload
}
```

**Step 2: Commit**

```bash
git add src/shared/constants.ts
git commit -m "feat: add stage field clearing helper for restart logic"
```

---

### Task 4: Add `restartToStage()` to PipelineEngine

**Files:**
- Modify: `src/main/pipeline-engine.ts` (add new public method after `resumeTask`, before `private` methods)

**Step 1: Implement `restartToStage`**

Add this method. It follows the pattern of `rejectStage` (session clearing) and `startTask` (worktree + runStage):

```ts
async restartToStage(taskId: number, targetStage: PipelineStage): Promise<void> {
  const task = getTask(this.dbPath, taskId)
  if (!task) throw new Error(`Task ${taskId} not found`)

  const stages = TIER_STAGES[task.tier]
  const targetIndex = stages.indexOf(targetStage)
  if (targetIndex === -1) {
    throw new Error(`Stage ${targetStage} is not valid for tier ${task.tier}`)
  }

  // 1. Abort any active session
  const sessionKey = `${taskId}-${task.currentAgent || ''}`
  this.abortSession(sessionKey)
  this.sessionIds.delete(taskId)
  this.contextUsage.delete(taskId)

  // 2. Git rollback
  const isFirstStage = targetIndex === 0
  if (isFirstStage) {
    // Full restart — stash and reset to base branch
    if (this.gitEngine && this.taskWorktrees.has(taskId)) {
      try {
        const result = await this.gitEngine.stashAndReset(taskId)
        if (result.stashed) {
          appendAgentLog(this.dbPath, taskId, {
            timestamp: new Date().toISOString(),
            agent: 'pipeline-engine',
            model: 'system',
            action: 'restart',
            details: `Stashed uncommitted changes before full restart`
          })
        }
      } catch (err) {
        console.error(`Git stash+reset failed for task ${taskId}:`, err)
      }
    }
  } else {
    // Stage-aware reset — roll back to the commit of the stage before target
    const previousStage = stages[targetIndex - 1]
    if (this.gitEngine && this.taskWorktrees.has(taskId)) {
      try {
        await this.gitEngine.resetToStageCommit(taskId, previousStage)
      } catch (err) {
        console.error(`Git reset to stage ${previousStage} failed for task ${taskId}:`, err)
        // Fall back to stash+reset
        try {
          await this.gitEngine.stashAndReset(taskId)
        } catch {
          // Continue even if git ops fail — DB cleanup still matters
        }
      }
    }
  }

  // 3. Clear DB fields for target stage and everything after
  const clearPayload = getClearFieldsPayload(task.tier, targetStage)
  const targetStatus = STAGE_TO_STATUS[targetStage]

  updateTask(this.dbPath, taskId, {
    ...clearPayload,
    status: targetStatus,
    currentAgent: targetStage
  })

  // 4. Log the restart
  appendAgentLog(this.dbPath, taskId, {
    timestamp: new Date().toISOString(),
    agent: 'pipeline-engine',
    model: 'system',
    action: 'restart',
    details: `Restarted to stage: ${targetStage} (tier: ${task.tier})`
  })

  // 5. Emit event so renderer can update
  this.emit('pipeline:stageChange', {
    taskId,
    stage: targetStage,
    status: targetStatus,
    action: 'restart'
  })
}
```

**Step 2: Add imports at top of file**

Make sure `getClearFieldsPayload` is imported from `../../shared/constants` alongside the existing `TIER_STAGES`, `STAGE_TO_STATUS` imports.

**Step 3: Commit**

```bash
git add src/main/pipeline-engine.ts
git commit -m "feat: add restartToStage to PipelineEngine"
```

---

### Task 5: Add IPC handler and preload bridge

**Files:**
- Modify: `src/main/index.ts` (~line 283, after last pipeline handler)
- Modify: `src/preload/index.ts` (in the `pipeline` object)
- Modify: `src/shared/types.ts` (add to `IpcChannel` type if it exists)

**Step 1: Add IPC handler in `src/main/index.ts`**

After the last pipeline handler (around line 283), add:

```ts
ipcMain.handle('pipeline:restartToStage', async (_e, taskId: number, targetStage: string) => {
  if (!currentEngine) throw new Error('Pipeline not initialized')
  await currentEngine.restartToStage(taskId, targetStage as PipelineStage)
})
```

**Step 2: Add preload bridge in `src/preload/index.ts`**

In the `pipeline` section of the `api` object, add:

```ts
restartToStage: (taskId: number, stage: string) =>
  ipcRenderer.invoke('pipeline:restartToStage', taskId, stage),
```

**Step 3: Update types if needed**

If there's an `ElectronAPI` type or `IpcChannel` union in `src/shared/types.ts`, add `'pipeline:restartToStage'` to it. Also add the method signature to whatever interface describes `window.api.pipeline`.

**Step 4: Commit**

```bash
git add src/main/index.ts src/preload/index.ts src/shared/types.ts
git commit -m "feat: add pipeline:restartToStage IPC channel and preload bridge"
```

---

### Task 6: Update TaskDetail restart UI

**Files:**
- Modify: `src/renderer/src/components/TaskDetail/TaskDetail.tsx` (lines 85–111 for handler, lines 277–284 for button)

**Step 1: Replace `handleRestart` with `handleRestartToStage`**

Replace the existing `handleRestart` function (lines 85–111) with:

```ts
const [restartAnchorEl, setRestartAnchorEl] = useState<null | HTMLElement>(null)

const getCompletedStages = (): PipelineStage[] => {
  if (!task) return []
  const stages = TIER_STAGES[task.tier]
  // A stage is "completed" if its output field has data
  // 'done' is excluded — can't restart from done
  return stages.filter((stage: string) => {
    if (stage === 'done') return false
    switch (stage) {
      case 'brainstorm': return !!task.brainstormOutput
      case 'design_review': return !!task.designReview
      case 'plan': return !!task.plan
      case 'implement': return !!task.implementationNotes
      case 'code_review': return !!task.reviewComments
      case 'verify': return !!task.verifyResult
      default: return false
    }
  }) as PipelineStage[]
}

const handleRestartToStage = async (targetStage: PipelineStage) => {
  setRestartAnchorEl(null)
  try {
    await window.api.pipeline.restartToStage(task.id, targetStage)
    await loadTasks()
    pipelineStore.clearStream()
  } catch (err) {
    console.error('Failed to restart to stage:', err)
  }
}

const handleFullRestart = async () => {
  setRestartAnchorEl(null)
  const stages = TIER_STAGES[task.tier]
  const firstStage = stages[0] as PipelineStage
  try {
    await window.api.pipeline.restartToStage(task.id, firstStage)
    await loadTasks()
    pipelineStore.clearStream()
  } catch (err) {
    console.error('Failed to restart task:', err)
  }
}
```

**Step 2: Replace the restart button with a dropdown menu**

Replace the current restart button (lines 277–284) with:

```tsx
{!isBacklog && !isDone && (
  <>
    <Button
      size="small"
      color="warning"
      startIcon={<RestartAltIcon />}
      onClick={(e) => setRestartAnchorEl(e.currentTarget)}
    >
      Restart
    </Button>
    <Menu
      anchorEl={restartAnchorEl}
      open={Boolean(restartAnchorEl)}
      onClose={() => setRestartAnchorEl(null)}
    >
      <MenuItem onClick={handleFullRestart}>
        <ListItemIcon><RestartAltIcon fontSize="small" /></ListItemIcon>
        <ListItemText>Full Restart (to backlog)</ListItemText>
      </MenuItem>
      {getCompletedStages().map((stage) => (
        <MenuItem key={stage} onClick={() => handleRestartToStage(stage)}>
          <ListItemIcon><ReplayIcon fontSize="small" /></ListItemIcon>
          <ListItemText>Restart from {STAGE_TO_STATUS[stage]}</ListItemText>
        </MenuItem>
      ))}
    </Menu>
  </>
)}
```

**Step 3: Add imports at top of file**

```ts
import { TIER_STAGES, STAGE_TO_STATUS } from '../../../../shared/constants'
import { PipelineStage } from '../../../../shared/types'
import Menu from '@mui/material/Menu'
import MenuItem from '@mui/material/MenuItem'
import ListItemIcon from '@mui/material/ListItemIcon'
import ListItemText from '@mui/material/ListItemText'
import ReplayIcon from '@mui/icons-material/Replay'
// RestartAltIcon should already be imported
```

**Step 4: Commit**

```bash
git add src/renderer/src/components/TaskDetail/TaskDetail.tsx
git commit -m "feat: replace restart button with stage-aware restart dropdown"
```

---

### Task 7: Fix existing restart bugs

**Files:**
- Modify: `src/main/pipeline-engine.ts` (the new `restartToStage` method already handles these, but verify)

**Step 1: Verify these are all addressed by the new flow**

Confirm that the new `restartToStage` method:
- Clears `activeSessionId` (via `getClearFieldsPayload`) ✓
- Clears `richHandoff` (via `getClearFieldsPayload`) ✓
- Does NOT clear `branchName` or `worktreePath` (they should persist — the worktree is reused) ✓
- Handles missing worktree gracefully (the `this.taskWorktrees.has(taskId)` guard) ✓

**Step 2: Verify the old `handleRestart` in TaskDetail is fully replaced**

Make sure the raw `window.api.tasks.update(...)` restart is completely removed and replaced by the IPC call to `pipeline:restartToStage`.

**Step 3: Test the full restart flow manually**

1. Start a task, let it complete brainstorming
2. Click Restart → Full Restart — verify worktree resets to base branch, all fields cleared
3. Start a task, let it complete brainstorm + planning
4. Click Restart → Restart from planning — verify worktree resets to brainstorm commit, plan fields cleared but brainstormOutput preserved
5. Start a task that fails mid-implementation
6. Click Restart → Restart from implement — verify uncommitted changes are stashed, worktree resets to planning commit

**Step 4: Commit any fixes**

```bash
git add -A
git commit -m "fix: clean up restart edge cases and verify bug fixes"
```

---

## Summary

| Task | Description | Files |
|------|-------------|-------|
| 1 | `stashAndReset()` on GitEngine | git-engine.ts |
| 2 | `resetToStageCommit()` on GitEngine | git-engine.ts |
| 3 | Stage field clearing helper | constants.ts |
| 4 | `restartToStage()` on PipelineEngine | pipeline-engine.ts |
| 5 | IPC handler + preload bridge | index.ts, preload/index.ts, types.ts |
| 6 | TaskDetail restart UI dropdown | TaskDetail.tsx |
| 7 | Verify bug fixes + manual test | (verification only) |

**Dependencies:** Tasks 1-3 are independent and can run in parallel. Task 4 depends on 1+2+3. Task 5 depends on 4. Task 6 depends on 5. Task 7 depends on 6.
