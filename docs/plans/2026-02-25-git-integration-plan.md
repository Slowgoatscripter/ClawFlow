# Git Integration Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add first-class git integration to ClawFlow — automatic branch/worktree creation per task, per-stage auto-commits, and a dedicated Git view with branch management UI.

**Architecture:** New `GitEngine` class (same pattern as `WorkshopEngine`) owns all git operations using `promisify(execFile)` from `node:child_process` — the safe, non-shell variant that prevents command injection. Pipeline engine calls into it at lifecycle points. Git view reads state via IPC + Zustand store. Two-panel layout: branch list + detail/actions.

**Tech Stack:** Node.js `execFile` (safe, no shell interpolation), Zustand store, React components with Tokyo Night theme, existing IPC patterns.

**Design doc:** `docs/plans/2026-02-25-git-integration-design.md`

---

## Task 1: Add shared types and IPC channels

**Files:**
- Modify: `src/shared/types.ts`

**Step 1: Add GitBranch interface and git IPC channels**

Add after existing `WorkshopArtifact` interface (~line 170):

```ts
export interface GitBranch {
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

export interface GitCommitResult {
  hash: string
  message: string
  taskId: number
  stage: string
}

export interface GitMergeResult {
  success: boolean
  conflicts: boolean
  message: string
}

export type GitBranchStatus = 'active' | 'completed' | 'stale' | 'merged'
```

Add to `IpcChannel` union (after workshop channels):

```ts
  | 'git:get-branches' | 'git:get-branch-detail' | 'git:push'
  | 'git:merge' | 'git:delete-branch' | 'git:commit'
  | 'git:branch-created' | 'git:commit-complete'
  | 'git:push-complete' | 'git:merge-complete' | 'git:error'
```

Add new fields to `Task` interface (after `commitHash`):

```ts
  branchName: string | null
  worktreePath: string | null
  prUrl: string | null
```

Add new fields to `Project` interface:

```ts
  defaultBaseBranch: string
  gitEnabled: boolean
```

**Step 2: Verify** — `npx tsc --noEmit`

**Step 3: Commit** — `git commit -m "feat(git): add GitBranch types and git IPC channels"`

---

## Task 2: Add database columns

**Files:**
- Modify: `src/main/db.ts`

**Step 1: Add columns to tasks table CREATE TABLE**

After `commit_hash TEXT,` add:

```sql
  branch_name TEXT,
  worktree_path TEXT,
  pr_url TEXT,
```

**Step 2: Add columns to global projects table CREATE TABLE**

After `last_opened` add:

```sql
  ,default_base_branch TEXT NOT NULL DEFAULT 'main',
  git_enabled INTEGER NOT NULL DEFAULT 1
```

**Step 3: Update `rowToTask()`** — after `commitHash: row.commit_hash,` add:

```ts
    branchName: row.branch_name,
    worktreePath: row.worktree_path,
    prUrl: row.pr_url,
```

**Step 4: Update `rowToProject()`** — after `lastOpened: row.last_opened,` add:

```ts
    defaultBaseBranch: row.default_base_branch ?? 'main',
    gitEnabled: row.git_enabled !== 0,
```

**Step 5: Add migration for existing databases**

```ts
function migrateTasksTable(db: Database): void {
  const cols = db.pragma('table_info(tasks)') as { name: string }[]
  const colNames = new Set(cols.map(c => c.name))
  if (!colNames.has('branch_name')) db.exec('ALTER TABLE tasks ADD COLUMN branch_name TEXT')
  if (!colNames.has('worktree_path')) db.exec('ALTER TABLE tasks ADD COLUMN worktree_path TEXT')
  if (!colNames.has('pr_url')) db.exec('ALTER TABLE tasks ADD COLUMN pr_url TEXT')
}
```

Similar for global projects table. Call inside respective init functions after CREATE TABLE.

**Step 6: Verify** — `npx tsc --noEmit`

**Step 7: Commit** — `git commit -m "feat(git): add branch_name, worktree_path columns to tasks and projects"`

---

## Task 3: Create GitEngine class

**Files:**
- Create: `src/main/git-engine.ts`

**Step 1: Create the class with safe git helper**

Uses `promisify(execFile)` — the safe, non-shell variant. All arguments passed as arrays, never interpolated into a shell string.

```ts
import { EventEmitter } from 'events'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import path from 'node:path'
import fs from 'node:fs'
import { getTask, updateTask, getAllTasks } from './db'
import type { GitBranch, GitCommitResult, GitMergeResult } from '../shared/types'

const execFileAsync = promisify(execFile)

export class GitEngine extends EventEmitter {
  private projectPath: string
  private dbPath: string
  private baseBranch: string = 'main'
  private activeWorktrees = new Map<number, string>()

  constructor(dbPath: string, projectPath: string) {
    super()
    this.dbPath = dbPath
    this.projectPath = projectPath
  }

  // Safe git execution — execFile with array args, no shell
  private async git(args: string[], cwd?: string): Promise<{ stdout: string; stderr: string }> {
    try {
      return await execFileAsync('git', args, {
        cwd: cwd ?? this.projectPath,
        timeout: 30000,
        maxBuffer: 10 * 1024 * 1024
      })
    } catch (err: any) {
      this.emit('git:error', { message: err.message, args, cwd })
      throw err
    }
  }
```

**Step 2: Implement `initRepo()`**

```ts
  async initRepo(): Promise<void> {
    const { stdout } = await this.git(['rev-parse', '--is-inside-work-tree'])
    if (stdout.trim() !== 'true') throw new Error('Not a git repository')
    try {
      await this.git(['rev-parse', '--verify', 'main'])
      this.baseBranch = 'main'
    } catch {
      try {
        await this.git(['rev-parse', '--verify', 'master'])
        this.baseBranch = 'master'
      } catch {
        const { stdout: head } = await this.git(['rev-parse', '--abbrev-ref', 'HEAD'])
        this.baseBranch = head.trim()
      }
    }
    await this.scanWorktrees()
  }
```

**Step 3: Implement `createWorktree()`**

```ts
  async createWorktree(taskId: number, taskTitle: string): Promise<string> {
    const slug = taskTitle.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40)
    const branchName = `task/${taskId}-${slug}`
    const worktreeDir = path.join(this.projectPath, '.clawflow', 'worktrees', String(taskId))
    fs.mkdirSync(path.join(this.projectPath, '.clawflow', 'worktrees'), { recursive: true })
    await this.git(['worktree', 'add', '-b', branchName, worktreeDir, this.baseBranch])
    this.activeWorktrees.set(taskId, worktreeDir)
    updateTask(this.dbPath, taskId, { branchName, worktreePath: worktreeDir })
    this.emit('branch:created', { taskId, branchName, worktreeDir })
    this.emit('worktree:created', { taskId, worktreeDir })
    return worktreeDir
  }
```

**Step 4: Implement `stageCommit()`**

```ts
  async stageCommit(taskId: number, stageName: string): Promise<GitCommitResult | null> {
    const worktreeDir = this.activeWorktrees.get(taskId)
    const cwd = worktreeDir ?? this.projectPath
    const { stdout: status } = await this.git(['status', '--porcelain'], cwd)
    if (!status.trim()) return null
    const message = `task/${taskId}: complete ${stageName} stage`
    await this.git(['add', '.'], cwd)
    await this.git(['commit', '-m', message], cwd)
    const { stdout: hash } = await this.git(['rev-parse', 'HEAD'], cwd)
    const result: GitCommitResult = { hash: hash.trim(), message, taskId, stage: stageName }
    updateTask(this.dbPath, taskId, { commitHash: result.hash })
    this.emit('commit:complete', result)
    return result
  }
```

**Step 5: Implement `cleanupWorktree()`**

```ts
  async cleanupWorktree(taskId: number): Promise<void> {
    const worktreeDir = this.activeWorktrees.get(taskId)
    if (!worktreeDir) return
    await this.git(['worktree', 'remove', worktreeDir, '--force'])
    this.activeWorktrees.delete(taskId)
    updateTask(this.dbPath, taskId, { worktreePath: null })
    this.emit('worktree:removed', { taskId, worktreeDir })
  }
```

**Step 6: Implement `push()`**

```ts
  async push(taskId: number): Promise<void> {
    const task = getTask(this.dbPath, taskId)
    if (!task?.branchName) throw new Error('Task has no branch')
    await this.git(['push', '-u', 'origin', task.branchName])
    this.emit('push:complete', { taskId, branchName: task.branchName })
  }
```

**Step 7: Implement `merge()`**

```ts
  async merge(taskId: number, targetBranch?: string): Promise<GitMergeResult> {
    const task = getTask(this.dbPath, taskId)
    if (!task?.branchName) throw new Error('Task has no branch')
    const target = targetBranch ?? this.baseBranch
    try {
      await this.git(['checkout', target])
      await this.git(['merge', task.branchName, '--no-ff', '-m', `Merge ${task.branchName} into ${target}`])
      this.emit('merge:complete', { taskId, branchName: task.branchName, targetBranch: target })
      return { success: true, conflicts: false, message: `Merged ${task.branchName} into ${target}` }
    } catch (err: any) {
      if (err.message.includes('CONFLICT')) {
        await this.git(['merge', '--abort'])
        this.emit('merge:conflict', { taskId, branchName: task.branchName })
        return { success: false, conflicts: true, message: 'Merge conflicts detected. Resolve manually.' }
      }
      throw err
    }
  }
```

**Step 8: Implement `deleteBranch()`**

```ts
  async deleteBranch(taskId: number): Promise<void> {
    const task = getTask(this.dbPath, taskId)
    if (!task?.branchName) throw new Error('Task has no branch')
    if (this.activeWorktrees.has(taskId)) await this.cleanupWorktree(taskId)
    await this.git(['branch', '-D', task.branchName])
    updateTask(this.dbPath, taskId, { branchName: null })
    this.emit('branch:deleted', { taskId, branchName: task.branchName })
  }
```

**Step 9: Implement `getBranches()` and `getBranchDetail()`**

```ts
  async getBranches(): Promise<GitBranch[]> {
    const tasks = getAllTasks(this.dbPath).filter(t => t.branchName)
    const branches: GitBranch[] = []
    for (const task of tasks) {
      try {
        const detail = await this.getBranchDetail(task.id)
        if (detail) branches.push(detail)
      } catch { /* branch deleted externally */ }
    }
    return branches
  }

  async getBranchDetail(taskId: number): Promise<GitBranch | null> {
    const task = getTask(this.dbPath, taskId)
    if (!task?.branchName) return null
    try { await this.git(['rev-parse', '--verify', task.branchName]) } catch { return null }

    const { stdout: aheadBehind } = await this.git(['rev-list', '--left-right', '--count', `${this.baseBranch}...${task.branchName}`])
    const [behind, ahead] = aheadBehind.trim().split('\t').map(Number)

    const { stdout: logLine } = await this.git(['log', '-1', '--format=%H|%s|%aI', task.branchName])
    const [, lastMsg, lastDate] = logLine.trim().split('|')

    const { stdout: countStr } = await this.git(['rev-list', '--count', `${this.baseBranch}..${task.branchName}`])

    let pushed = false
    try { await this.git(['rev-parse', '--verify', `origin/${task.branchName}`]); pushed = true } catch {}

    let status: GitBranch['status'] = 'active'
    if (task.status === 'done' || task.status === 'completed') status = 'completed'
    if (this.activeWorktrees.has(taskId)) status = 'active'
    try {
      const { stdout: merged } = await this.git(['branch', '--merged', this.baseBranch])
      if (merged.includes(task.branchName)) status = 'merged'
    } catch {}

    return {
      taskId: task.id, taskTitle: task.title, branchName: task.branchName, status,
      commitCount: parseInt(countStr.trim(), 10) || 0,
      lastCommitMessage: lastMsg ?? '', lastCommitDate: lastDate ?? '',
      aheadOfBase: ahead ?? 0, behindBase: behind ?? 0,
      worktreeActive: this.activeWorktrees.has(taskId), pushed
    }
  }
```

**Step 10: Implement `scanWorktrees()` and `getBaseBranch()`**

```ts
  private async scanWorktrees(): Promise<void> {
    try {
      const { stdout } = await this.git(['worktree', 'list', '--porcelain'])
      for (const line of stdout.split('\n')) {
        if (line.startsWith('worktree ')) {
          const wtPath = line.replace('worktree ', '')
          const match = wtPath.match(/\.clawflow[\\/]worktrees[\\/](\d+)$/)
          if (match) this.activeWorktrees.set(parseInt(match[1], 10), wtPath)
        }
      }
    } catch {}
  }

  getBaseBranch(): string { return this.baseBranch }
```

**Step 11: Verify** — `npx tsc --noEmit`

**Step 12: Commit** — `git commit -m "feat(git): add GitEngine with worktree, branch, commit, merge, push operations"`

---

## Task 4: Integrate GitEngine into Pipeline Engine

**Files:**
- Modify: `src/main/pipeline-engine.ts`

**Step 1: Add GitEngine reference**

```ts
import { GitEngine } from './git-engine'
```

Add to class fields:
```ts
  private gitEngine: GitEngine | null = null
  private taskWorktrees = new Map<number, string>()

  setGitEngine(engine: GitEngine): void { this.gitEngine = engine }
```

**Step 2: In `startTask()`, create worktree before first stage**

After `updateTask()` that sets status/startedAt, before `await this.runStage()`:

```ts
    if (this.gitEngine) {
      try {
        const worktreePath = await this.gitEngine.createWorktree(taskId, task.title)
        this.taskWorktrees.set(taskId, worktreePath)
      } catch (err: any) {
        console.warn(`Git worktree creation failed for task ${taskId}: ${err.message}`)
      }
    }
```

**Step 3: In `runStage()`, use worktree path as cwd**

Change `cwd: this.projectPath` to:
```ts
    cwd: this.taskWorktrees.get(taskId) ?? this.projectPath,
```

**Step 4: In `storeStageOutput()`, auto-commit after each stage**

Make `storeStageOutput` async. After `updateTask()`, add:

```ts
    if (this.gitEngine) {
      try { await this.gitEngine.stageCommit(taskId, stage) }
      catch (err: any) { console.warn(`Git commit failed: ${err.message}`) }
    }
```

**Step 5: In `done` case, cleanup worktree**

```ts
    if (this.gitEngine) {
      try { await this.gitEngine.cleanupWorktree(taskId); this.taskWorktrees.delete(taskId) }
      catch (err: any) { console.warn(`Git cleanup failed: ${err.message}`) }
    }
```

**Step 6: Verify** — `npx tsc --noEmit`

**Step 7: Commit** — `git commit -m "feat(git): integrate GitEngine into pipeline for worktree isolation and auto-commits"`

---

## Task 5: Register Git IPC handlers

**Files:**
- Modify: `src/main/index.ts`
- Modify: `src/preload/index.ts`

**Step 1: Add `ensureGitEngine()` and `registerGitIpc()` in `index.ts`**

Follow `ensureWorkshopEngine` / `registerWorkshopIpc` pattern. Bridge engine events to renderer via `mainWindow.webContents.send()`. Wire `currentGitEngine` into pipeline engine in the `pipeline:init` handler.

**Step 2: Expose git IPC in preload**

Add `git: { ... }` namespace to `contextBridge.exposeInMainWorld('api', { ... })` with invoke calls for `getBranches`, `getBranchDetail`, `push`, `merge`, `deleteBranch`, `commit`, and listener registrations for `onBranchCreated`, `onCommitComplete`, `onPushComplete`, `onMergeComplete`, `onError` — each returning a cleanup function.

**Step 3: Verify** — `npx tsc --noEmit`

**Step 4: Commit** — `git commit -m "feat(git): register git IPC handlers and preload bridge"`

---

## Task 6: Create gitStore

**Files:**
- Create: `src/renderer/src/stores/gitStore.ts`

**Step 1: Create Zustand store**

Follow `workshopStore` pattern. State: `branches: GitBranch[]`, `selectedTaskId`, `loading`, `error`. Actions: `loadBranches`, `selectBranch`, `push`, `merge`, `deleteBranch`, `commit`, `setupListeners`. All actions call `window.api.git.*` and reload branches on success. `setupListeners` registers all push event listeners and returns cleanup function.

**Step 2: Verify** — `npx tsc --noEmit`

**Step 3: Commit** — `git commit -m "feat(git): add gitStore with branch state and event listeners"`

---

## Task 7: Create Git view components

**Files:**
- Create: `src/renderer/src/components/Git/Git.tsx`
- Create: `src/renderer/src/components/Git/BranchList.tsx`
- Create: `src/renderer/src/components/Git/BranchDetail.tsx`
- Create: `src/renderer/src/components/Git/GitStatusBar.tsx`

**Step 1: Create `Git.tsx`** — Shell with back-to-dashboard button, two-panel layout (`BranchList` + `BranchDetail`), `GitStatusBar`. Calls `setupListeners()` and `loadBranches()` in `useEffect`.

**Step 2: Create `BranchList.tsx`** — Left panel (w-72), scrollable list of branches. Each item shows branch name, task title, commit count, status badge (color-coded dot: green=active, blue=completed, yellow=stale, gray=merged). Click to select.

**Step 3: Create `BranchDetail.tsx`** — Right panel (flex-1). Shows: branch name, task title, status grid (status, commits/ahead/behind, last commit, remote status), manual commit input+button, action buttons (Push, Merge with confirm, Delete with confirm). Empty state when nothing selected.

**Step 4: Create `GitStatusBar.tsx`** — Bottom bar with counts: "N branches, X active, Y completed, Z stale".

**Step 5: Verify** — `npx tsc --noEmit`

**Step 6: Commit** — `git commit -m "feat(git): add Git view with BranchList, BranchDetail, and GitStatusBar"`

---

## Task 8: Register Git view in app routing

**Files:**
- Modify: `src/renderer/src/stores/layoutStore.ts`
- Modify: `src/renderer/src/App.tsx`
- Modify: TopBar component (find exact path)

**Step 1: Add `'git'` to `View` type** in `layoutStore.ts`

**Step 2: Add `{view === 'git' && <Git />}`** in `App.tsx`

**Step 3: Add Git nav button** in TopBar next to Workshop button

**Step 4: Verify** — `npx tsc --noEmit`

**Step 5: Commit** — `git commit -m "feat(git): register Git view in app routing and navigation"`

---

## Task 9: Add .clawflow to .gitignore

**Files:**
- Modify: `.gitignore`

**Step 1:** Add `.clawflow/` to gitignore

**Step 2: Commit** — `git commit -m "chore: add .clawflow to gitignore for worktree isolation"`

---

## Task 10: End-to-end verification

**Step 1:** `npm run build` — expect clean build
**Step 2:** `npx tsc --noEmit` — expect PASS
**Step 3:** Manual smoke test — launch app, navigate to Git view, start a pipeline, verify branch creation, stage commits, completion flow, action buttons
**Step 4:** Final commit if any fixups needed
