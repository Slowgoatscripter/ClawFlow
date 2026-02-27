# Stage-Aware Task Restart

**Date:** 2026-02-26
**Status:** Approved

## Problem

When a task is restarted, the DB state is cleared but the git worktree retains all file changes from the previous attempt. The restarted agent gets a fresh session with no memory but sees a partially-modified codebase, leading to:

- Re-implementing things that already exist
- Building on broken/partial foundations
- Conflicts with leftover changes

Additional bugs in current restart:
- `branchName`, `worktreePath`, `activeSessionId`, `richHandoff` not cleared
- `createWorktree()` may fail if worktree directory already exists
- Failed stages leave uncommitted changes that silently persist

## Design

### Core Concept

Every completed stage already creates a git commit (`task/<id>: complete <stage> stage`). These commits serve as rollback checkpoints. On restart, the system rolls the worktree back to the appropriate commit and clears DB state for affected stages.

### Restart Behaviors

**Restart from a specific stage (e.g., "restart from planning"):**

1. Abort any active session for the task
2. Find the commit for the stage just before the target (e.g., brainstorming commit if restarting from planning)
3. `git reset --hard <commit>` in the worktree
4. Clear DB fields for the target stage and all subsequent stages
5. Clear `activeSessionId`, `richHandoff`, reset relevant review counters
6. Set status to the target stage's starting status
7. Do NOT auto-run — leave ready for user to click Start/Step

**Full restart (back to backlog) with no successful stages:**

1. `git stash` uncommitted changes in the worktree (recoverable via `git stash list`)
2. `git reset --hard <base-branch-commit>` (the commit the branch diverged from)
3. Clear all DB stage outputs, session IDs, review counters
4. Status → backlog

**Full restart with some successful stages:**

Same as above — stash uncommitted, reset to base branch, clear everything. Full restart means full reset.

### Git Engine Additions

Two new methods:

- **`resetToStageCommit(taskId, stage)`** — finds the commit for the given stage using the commit message convention (`task/<id>: complete <stage> stage`), then `git reset --hard <commit>` in the worktree
- **`stashAndReset(taskId)`** — stashes uncommitted changes, then resets to the merge-base (where the task branch diverged from the base branch)

### Pipeline Engine Changes

New method **`restartFromStage(taskId, targetStage)`**:

1. Abort any active session
2. Determine rollback commit:
   - If target is the first stage for the task's tier → `stashAndReset()`
   - Otherwise → `resetToStageCommit()` to the stage just before target
3. Clear DB fields for target stage and all subsequent stages
4. Clear `activeSessionId`, `richHandoff`, reset review counters for affected stages
5. Set status to the target stage's starting status

The existing `handleRestart` in `TaskDetail.tsx` gets refactored to call the new IPC endpoint.

### IPC Layer

New handler: **`pipeline:restart-from-stage`** — takes `taskId` and `targetStage`, calls `PipelineEngine.restartFromStage()`.

### DB State Clearing Logic

Stage-to-field mapping:

| Stage | DB Fields |
|-------|-----------|
| brainstorming | brainstormOutput |
| design_review | designReview |
| planning | plan, planReviewCount |
| implementing | implementationNotes, commitHash |
| code_review | reviewComments, reviewScore, implReviewCount |
| verifying | testResults, verifyResult |

Given a target stage, clear that stage's fields and everything after. Also clear: `activeSessionId`, `richHandoff`, `todos` (for affected stages), affected `handoffs` entries, affected `agentLog` entries.

### UI: TaskDetail Restart Menu

Replace the single "Restart" button with a dropdown/split button:

| Option | Behavior |
|--------|----------|
| Restart Task | Full restart → stash + reset to base, clear everything, status → backlog |
| Restart from Brainstorming | Reset to base, clear all stage outputs |
| Restart from Planning | Reset to brainstorming commit, keep brainstorm output |
| Restart from Implementation | Reset to planning commit, keep brainstorm + plan |
| *(etc.)* | Only shows stages that have been completed |

Each option shows a confirmation dialog with:
- Which stages will be re-run
- How many commits will be rolled back
- Whether uncommitted changes will be stashed

### Edge Cases

- **App restart between runs** — `scanWorktrees()` on startup rebuilds the in-memory map, worktree is findable
- **Commit not found** (user manually deleted commits) — fall back to `stashAndReset()` with a warning
- **Stash on empty worktree** — if `git stash` fails (nothing to stash), skip and proceed with reset
- **Tier-based stage skipping** — L1 tasks skip brainstorming/design_review; restart menu only shows stages relevant to the task's tier

### What This Does NOT Change

- How stages run or how prompts are constructed
- Pause/resume flow
- Context handoff behavior
- No new dependencies
