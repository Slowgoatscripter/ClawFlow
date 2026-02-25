# Git Integration Design — ClawFlow

**Date:** 2026-02-25
**Status:** Approved
**Approach:** Git Engine Layer (Approach A)

## Summary

Add first-class git integration to ClawFlow so that every pipeline task runs in an isolated git worktree on its own branch. The engine auto-creates branches and worktrees at task start, auto-commits after each pipeline stage, and cleans up worktrees on completion while keeping branches alive for user review. A dedicated Git view in the top nav provides branch management with status badges and action buttons (commit, push, merge, delete).

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| UI location | Dedicated top-level Git view | Clean separation, global overview of all branches |
| Branch creation | Automatic on task start | Zero friction, every task gets isolation by default |
| Isolation model | Git worktrees | True parallel isolation for concurrent tasks |
| Completion behavior | Keep branch, show merge options in Git view | Human review gate before merging |
| Commit strategy | Per-stage auto-commit | Clean commit trail, intermediate work preserved on failure |
| Navigation | TopBar button (like Workshop) | Consistent with existing nav patterns |
| Detail level | Status + action buttons | Functional without complexity; no inline diff viewer |

## Architecture

### 1. Git Engine (`src/main/git-engine.ts`)

New `GitEngine` class extending `EventEmitter`, following the WorkshopEngine pattern.

**State:**
- Map of active worktrees keyed by taskId
- Project path and base branch (e.g. `main` or `master`)

**Core methods:**

| Method | When called | What it does |
|--------|------------|--------------|
| `initRepo(projectPath)` | On project open | Detects git repo, reads base branch, scans existing task branches/worktrees |
| `createWorktree(taskId, taskTitle)` | Pipeline `startTask()` | Creates branch `task/{id}-{slug}`, creates worktree at `.clawflow/worktrees/{id}`, returns worktree path |
| `stageCommit(taskId, stageName)` | Pipeline stage completes | Runs `git add . && git commit` in the worktree with message `task/{id}: complete {stage}` |
| `push(taskId)` | User clicks Push | Pushes the task branch to origin |
| `merge(taskId, targetBranch)` | User clicks Merge | Merges task branch into target (e.g. main), handles conflicts |
| `deleteBranch(taskId)` | User clicks Delete | Deletes branch + cleans up worktree if still present |
| `cleanupWorktree(taskId)` | Task reaches `done` stage | Removes worktree directory, keeps branch alive |
| `getBranches()` | Git view loads | Returns all task branches with status info |
| `getBranchDetail(taskId)` | Git view selects a branch | Returns commit count, last commit, ahead/behind, file changes |

**Events emitted:**
- `branch:created`, `branch:deleted`
- `commit:complete` (with hash, stage, taskId)
- `worktree:created`, `worktree:removed`
- `push:complete`, `merge:complete`, `merge:conflict`
- `git:error`

**Git commands** executed via `execFileNoThrow` from `src/utils/execFileNoThrow.ts` — the project's existing safe wrapper around `child_process.execFile`. Never uses `exec()` or shell interpolation.

### 2. Pipeline Engine Integration

**Changes to `pipeline-engine.ts`:**
- `startTask()` calls `gitEngine.createWorktree(taskId)` before running the first stage
- Worktree path replaces `this.projectPath` as `cwd` for all SDK runner calls on that task
- `storeStageOutput()` calls `gitEngine.stageCommit(taskId, stageName)` after each stage completes
- `done` stage calls `gitEngine.cleanupWorktree(taskId)` — removes worktree dir, keeps branch

No changes to SDK manager — it already accepts `cwd` as a parameter.

### 3. Database Changes

**`tasks` table — new columns:**
- `branch_name TEXT` — e.g. `task/42-implement-auth`
- `worktree_path TEXT` — e.g. `.clawflow/worktrees/42`
- `pr_url TEXT` — populated if user creates a PR

**`projects` table (global) — new columns:**
- `default_base_branch TEXT DEFAULT 'main'`
- `git_enabled INTEGER DEFAULT 1`

### 4. IPC Channels

| Channel | Direction | Purpose |
|---------|-----------|---------|
| `git:get-branches` | renderer → main | List all task branches with status |
| `git:get-branch-detail` | renderer → main | Commit count, ahead/behind for one branch |
| `git:push` | renderer → main | Push a task's branch |
| `git:merge` | renderer → main | Merge a task's branch into base |
| `git:delete-branch` | renderer → main | Delete branch + cleanup |
| `git:commit` | renderer → main | Manual commit on a branch |
| `git:branch-created` | main → renderer | Push event when branch auto-created |
| `git:commit-complete` | main → renderer | Push event after auto/manual commit |
| `git:push-complete` | main → renderer | Push event after push |
| `git:merge-complete` | main → renderer | Push event after merge |
| `git:error` | main → renderer | Push event for git errors |

### 5. Zustand Store (`src/renderer/src/stores/gitStore.ts`)

```typescript
interface GitBranch {
  taskId: number
  taskTitle: string
  branchName: string
  status: 'active' | 'completed' | 'stale' | 'merged'
  commitCount: number
  lastCommitMessage: string
  lastCommitDate: string
  aheadOfBase: number
  behindBase: number
  worktreeActive: boolean
  pushed: boolean
}

interface GitState {
  branches: GitBranch[]
  selectedBranchId: number | null
  loading: boolean
  error: string | null

  loadBranches: () => Promise<void>
  selectBranch: (taskId: number) => void
  push: (taskId: number) => Promise<void>
  merge: (taskId: number) => Promise<void>
  deleteBranch: (taskId: number) => Promise<void>
  commit: (taskId: number, message: string) => Promise<void>
  setupListeners: () => () => void
}
```

### 6. Git View UI (`src/renderer/src/components/Git/`)

**Layout:** Two-panel — branch list on left (w-72), detail panel on right (flex-1).

```
┌─────────────────────────────────────────────────┐
│  TopBar  [Dashboard] [Workshop] [Git]           │
├──────────────┬──────────────────────────────────┤
│              │                                  │
│  Branch List │  Branch Detail                   │
│              │                                  │
│  ● task/42   │  task/42-implement-auth          │
│    active    │  Status: Active (worktree)       │
│              │  Commits: 5 (3 ahead of main)    │
│  ● task/38   │  Last: "task/42: complete impl"  │
│    completed │  Pushed: No                      │
│              │                                  │
│  ● task/35   │  ┌────────┐ ┌──────┐ ┌────────┐ │
│    merged    │  │ Commit │ │ Push │ │ Merge  │ │
│              │  └────────┘ └──────┘ └────────┘ │
│              │  ┌────────────────┐              │
│              │  │ Delete Branch  │              │
│              │  └────────────────┘              │
├──────────────┴──────────────────────────────────┤
│  Status bar: "5 branches · 2 active · 1 stale" │
└─────────────────────────────────────────────────┘
```

**Components:**
- `Git.tsx` — shell with two-panel layout, `setupListeners()` in useEffect
- `BranchList.tsx` — scrollable list with color-coded status badges (green=active, blue=completed, gray=merged, yellow=stale)
- `BranchDetail.tsx` — selected branch info + action buttons
- `GitStatusBar.tsx` — summary counts at bottom

### 7. View Registration

- Add `'git'` to the `View` union type in `layoutStore.ts`
- Add `case 'git':` to `App.tsx` conditional render
- Add Git nav button to `TopBar.tsx`
- Register `registerGitIpc()` in `index.ts`

## Out of Scope

- Inline diff viewer / file staging area
- GitHub PR creation (future enhancement)
- Conflict resolution UI (show error, user resolves manually)
- Git settings UI (base branch configured in DB, editable later)
- Branch protection rules
