import { EventEmitter } from 'events'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import path from 'node:path'
import fs from 'node:fs'
import { getTask, updateTask, getAllTasks } from './db'
import type { GitBranch, GitCommitResult, GitMergeResult, FileStatus } from '../shared/types'

const execFileAsync = promisify(execFile)

export class GitEngine extends EventEmitter {
  private projectPath: string
  private dbPath: string
  private baseBranch: string = 'main'
  private baseBranchConfigured = false
  private activeWorktrees = new Map<number, string>() // taskId -> worktree path

  constructor(dbPath: string, projectPath: string) {
    super()
    this.dbPath = dbPath
    this.projectPath = projectPath
  }

  /**
   * Safe git helper — uses execFileAsync (no shell) with timeout and buffer limits.
   * Emits 'git:error' on failure and rethrows.
   */
  private async git(args: string[], cwd?: string): Promise<string> {
    try {
      const { stdout } = await execFileAsync('git', args, {
        cwd: cwd ?? this.projectPath,
        timeout: 30_000,
        maxBuffer: 10 * 1024 * 1024
      })
      return stdout.trim()
    } catch (err: any) {
      this.emit('git:error', { args, error: err.message ?? String(err) })
      throw err
    }
  }

  /**
   * Verify the project is a git repo, detect the base branch, and scan existing worktrees.
   */
  setBaseBranch(branch: string): void {
    this.baseBranch = branch
    this.baseBranchConfigured = true
  }

  async listLocalBranches(): Promise<string[]> {
    const output = await this.git(['branch', '--format=%(refname:short)'])
    return output.split('\n').map(b => b.trim()).filter(Boolean)
  }

  async initRepo(): Promise<void> {
    // Verify this is a git repo
    await this.git(['rev-parse', '--git-dir'])

    // If baseBranch was explicitly configured, verify it exists and skip auto-detection
    if (this.baseBranchConfigured) {
      try {
        await this.git(['rev-parse', '--verify', `refs/heads/${this.baseBranch}`])
        return await this.scanWorktrees()
      } catch {
        // Configured branch doesn't exist, fall through to auto-detection
        console.warn(`Configured base branch '${this.baseBranch}' not found, auto-detecting...`)
      }
    }

    // Detect base branch: try main, then master, then current HEAD
    for (const candidate of ['main', 'master']) {
      try {
        await this.git(['rev-parse', '--verify', `refs/heads/${candidate}`])
        this.baseBranch = candidate
        return await this.scanWorktrees()
      } catch {
        // candidate doesn't exist, try next
      }
    }

    // Fallback: use whatever HEAD points to
    try {
      const head = await this.git(['symbolic-ref', '--short', 'HEAD'])
      this.baseBranch = head
    } catch {
      // detached HEAD — keep default 'main'
    }

    await this.scanWorktrees()
  }

  /**
   * Create a git worktree for a task: branch + worktree directory.
   */
  async createWorktree(taskId: number, taskTitle: string): Promise<string> {
    if (this.activeWorktrees.has(taskId)) {
      return this.activeWorktrees.get(taskId)!
    }

    const slug = taskTitle
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 40)

    const branchName = `task/${taskId}-${slug}`
    const worktreePath = path.join(this.projectPath, '.clawflow', 'worktrees', String(taskId))

    // Ensure parent dir exists
    fs.mkdirSync(path.dirname(worktreePath), { recursive: true })

    // Create branch and worktree in one step
    await this.git(['worktree', 'add', '-b', branchName, worktreePath, this.baseBranch])

    this.activeWorktrees.set(taskId, worktreePath)

    // Update the task record
    updateTask(this.dbPath, taskId, { branchName, worktreePath })

    this.emit('worktree:created', { taskId, branchName, worktreePath })
    this.emit('branch:created', { taskId, branchName })

    return worktreePath
  }

  /**
   * Stage all changes and commit for a pipeline stage.
   */
  async stageCommit(taskId: number, stageName: string): Promise<GitCommitResult | null> {
    const task = getTask(this.dbPath, taskId)
    if (!task?.worktreePath) return null

    const cwd = task.worktreePath

    // Check for changes
    const status = await this.git(['status', '--porcelain'], cwd)
    if (!status) return null // nothing to commit

    // Stage everything and commit (tolerate warnings from CRLF and invalid paths)
    try {
      await this.git(['add', '-A', '--ignore-errors'], cwd)
    } catch {
      // git add may exit non-zero due to CRLF warnings or skipped files — continue if anything was staged
    }
    const message = `task/${taskId}: complete ${stageName} stage`
    await this.git(['commit', '-m', message], cwd)

    // Get the commit hash
    const hash = await this.git(['rev-parse', 'HEAD'], cwd)

    // Update the task record
    updateTask(this.dbPath, taskId, { commitHash: hash })

    const result: GitCommitResult = { hash, message, taskId, stage: stageName }
    this.emit('commit:complete', result)
    return result
  }

  /**
   * Remove a worktree for a task.
   */
  async cleanupWorktree(taskId: number): Promise<void> {
    const worktreePath = this.activeWorktrees.get(taskId)
    if (!worktreePath) return

    try {
      await this.git(['worktree', 'remove', '--force', worktreePath])
    } catch {
      // worktree may have been removed externally; proceed with cleanup
    }

    this.activeWorktrees.delete(taskId)
    updateTask(this.dbPath, taskId, { worktreePath: null })
    this.emit('worktree:removed', { taskId })
  }

  /**
   * Stash uncommitted changes and reset the worktree to the merge-base
   * (where the task branch diverged from the base branch).
   */
  async stashAndReset(taskId: number): Promise<{ stashed: boolean }> {
    const worktreePath = this.activeWorktrees.get(taskId)
    if (!worktreePath) throw new Error(`No active worktree for task ${taskId}`)

    let stashed = false

    // Check if there are uncommitted changes to stash
    const status = await this.git(['status', '--porcelain'], worktreePath)
    if (status) {
      try {
        await this.git(['stash', 'push', '-m', `task/${taskId}: restart stash`], worktreePath)
        stashed = true
      } catch {
        // Nothing to stash or stash failed — proceed anyway
      }
    }

    // Find merge-base (where this branch diverged from base)
    const baseCommit = await this.git(['merge-base', this.baseBranch, 'HEAD'], worktreePath)

    await this.git(['reset', '--hard', baseCommit], worktreePath)

    return { stashed }
  }

  /**
   * Reset the worktree to the commit created at the end of a specific pipeline stage.
   * Falls back to stashAndReset if the stage commit is not found.
   */
  async resetToStageCommit(taskId: number, stage: string): Promise<void> {
    const worktreePath = this.activeWorktrees.get(taskId)
    if (!worktreePath) throw new Error(`No active worktree for task ${taskId}`)

    // Find the commit for the given stage using the commit message convention
    const commitMsg = `task/${taskId}: complete ${stage} stage`
    const commitHash = await this.git(
      ['log', '--oneline', '--grep', commitMsg, '--format=%H', '-1'],
      worktreePath
    )

    if (!commitHash) {
      // Commit not found — fall back to stashAndReset
      console.warn(`Stage commit not found for task ${taskId} stage ${stage}, falling back to stashAndReset`)
      await this.stashAndReset(taskId)
      return
    }

    // Stash any uncommitted changes first
    const status = await this.git(['status', '--porcelain'], worktreePath)
    if (status) {
      try {
        await this.git(
          ['stash', 'push', '-m', `task/${taskId}: restart stash before reset to ${stage}`],
          worktreePath
        )
      } catch {
        // Proceed even if stash fails
      }
    }

    await this.git(['reset', '--hard', commitHash], worktreePath)
  }

  /**
   * Push the task's branch to origin.
   */
  async push(taskId: number): Promise<void> {
    const task = getTask(this.dbPath, taskId)
    if (!task?.branchName) throw new Error('Task has no branch')

    try {
      await this.git(['push', '-u', 'origin', task.branchName])
      this.emit('push:complete', { taskId, branchName: task.branchName })
    } catch (err: any) {
      const errText = [err.stdout, err.stderr, err.message].filter(Boolean).join(' ')

      if (errText.includes('does not appear to be a git repository')) {
        throw new Error('No remote "origin" configured. Add a remote before pushing.')
      }
      if (errText.includes('rejected') || errText.includes('non-fast-forward')) {
        throw new Error('Push rejected: remote has newer changes. Pull or fetch first.')
      }
      throw err
    }
  }

  /**
   * Merge a task's branch into the target branch (default: baseBranch).
   * Returns merge result. On conflict: aborts, emits 'merge:conflict'.
   */
  async merge(taskId: number, targetBranch?: string): Promise<GitMergeResult> {
    const task = getTask(this.dbPath, taskId)
    if (!task?.branchName) throw new Error(`Task ${taskId} has no branch`)

    const target = targetBranch ?? this.baseBranch
    const originalBranch = await this.git(['symbolic-ref', '--short', 'HEAD']).catch(() => null)

    try {
      await this.git(['checkout', target])
      await this.git(['merge', '--no-ff', task.branchName])

      if (originalBranch) await this.git(['checkout', originalBranch]).catch(() => {})

      const result: GitMergeResult = {
        success: true,
        conflicts: false,
        message: `Merged ${task.branchName} into ${target}`
      }
      this.emit('merge:complete', { taskId, ...result })
      return result
    } catch (err: any) {
      // Always try to restore original branch
      if (originalBranch) {
        await this.git(['checkout', originalBranch]).catch(() => {})
      }

      const errText = [err.stdout, err.stderr, err.message].filter(Boolean).join(' ')

      if (errText.includes('CONFLICT')) {
        await this.git(['merge', '--abort']).catch(() => {})
        this.emit('merge:conflict', { taskId, branchName: task.branchName })
        return { success: false, conflicts: true, message: 'Merge conflicts detected. Resolve manually.' }
      }

      if (errText.includes('untracked working tree files would be overwritten')) {
        return {
          success: false,
          conflicts: false,
          message: 'Merge blocked: untracked files on the target branch would be overwritten. Commit or remove them first, then retry.'
        }
      }

      if (errText.includes('local changes') && errText.includes('would be overwritten')) {
        return {
          success: false,
          conflicts: false,
          message: 'Merge blocked: uncommitted changes on the target branch would be overwritten. Commit or stash them first.'
        }
      }

      throw err
    }
  }

  /**
   * Delete a task's branch. Cleans up worktree first if active.
   */
  async deleteBranch(taskId: number): Promise<void> {
    const task = getTask(this.dbPath, taskId)
    if (!task?.branchName) return

    // Cleanup worktree if active
    if (this.activeWorktrees.has(taskId)) {
      await this.cleanupWorktree(taskId)
    }

    await this.git(['branch', '-D', task.branchName])

    updateTask(this.dbPath, taskId, { branchName: null })

    this.emit('branch:deleted', { taskId, branchName: task.branchName })
  }

  /**
   * Get branch details for all tasks that have a branchName.
   */
  async getBranches(): Promise<GitBranch[]> {
    const tasks = getAllTasks(this.dbPath)
    const withBranch = tasks.filter((t) => t.branchName)

    const branches: GitBranch[] = []
    for (const task of withBranch) {
      try {
        const detail = await this.getBranchDetail(task.id)
        if (detail) branches.push(detail)
      } catch {
        // branch may have been deleted externally — skip
      }
    }

    return branches
  }

  /**
   * Get detailed branch info for a single task.
   */
  async getBranchDetail(taskId: number): Promise<GitBranch | null> {
    const task = getTask(this.dbPath, taskId)
    if (!task?.branchName) return null

    const branch = task.branchName

    // Verify branch exists
    try {
      await this.git(['rev-parse', '--verify', `refs/heads/${branch}`])
    } catch {
      return null
    }

    // Ahead/behind relative to base
    let aheadOfBase = 0
    let behindBase = 0
    try {
      const ahead = await this.git(['rev-list', '--count', `${this.baseBranch}..${branch}`])
      aheadOfBase = parseInt(ahead, 10) || 0
      const behind = await this.git(['rev-list', '--count', `${branch}..${this.baseBranch}`])
      behindBase = parseInt(behind, 10) || 0
    } catch {
      // base branch might not exist yet
    }

    // Last commit info
    let lastCommitMessage = ''
    let lastCommitDate = ''
    try {
      lastCommitMessage = await this.git(['log', '-1', '--format=%s', branch])
      lastCommitDate = await this.git(['log', '-1', '--format=%aI', branch])
    } catch {
      // empty branch
    }

    // Commit count
    let commitCount = 0
    try {
      const count = await this.git(['rev-list', '--count', `${this.baseBranch}..${branch}`])
      commitCount = parseInt(count, 10) || 0
    } catch {
      // fallback
    }

    // Check if pushed (does origin/<branch> exist?)
    let pushed = false
    try {
      await this.git(['rev-parse', '--verify', `origin/${branch}`])
      pushed = true
    } catch {
      // not pushed
    }

    // Determine status
    let status: GitBranch['status'] = 'active'
    if (task.status === 'done') {
      // Check if merged into base
      try {
        const merged = await this.git(['branch', '--merged', this.baseBranch])
        if (merged.split('\n').some((b) => b.trim() === branch)) {
          status = 'merged'
        } else {
          status = 'completed'
        }
      } catch {
        status = 'completed'
      }
    } else if (task.status === 'backlog' || task.status === 'blocked') {
      // Consider stale if no commits ahead
      if (aheadOfBase === 0) {
        status = 'stale'
      }
    }

    // Check for uncommitted files
    let dirtyFileCount = 0
    try {
      const statusOutput = await this.git(['status', '--porcelain'],
        this.activeWorktrees.get(taskId) ?? this.projectPath)
      dirtyFileCount = statusOutput.split('\n').filter(Boolean).length
    } catch {}

    return {
      taskId,
      taskTitle: task.title,
      branchName: branch,
      status,
      commitCount,
      lastCommitMessage,
      lastCommitDate,
      aheadOfBase,
      behindBase,
      worktreeActive: this.activeWorktrees.has(taskId),
      pushed,
      dirtyFileCount
    }
  }

  /**
   * Scan existing worktrees and populate the activeWorktrees map.
   */
  private async scanWorktrees(): Promise<void> {
    this.activeWorktrees.clear()

    let output: string
    try {
      output = await this.git(['worktree', 'list', '--porcelain'])
    } catch {
      return // no worktrees or git error
    }

    if (!output) return

    const tasks = getAllTasks(this.dbPath)
    const taskByWorktree = new Map<string, number>()
    for (const t of tasks) {
      if (t.worktreePath) {
        taskByWorktree.set(path.resolve(t.worktreePath), t.id)
      }
    }

    // Parse porcelain output: blocks separated by blank lines
    // Each block has: worktree <path>\nHEAD <hash>\nbranch <ref>\n
    const blocks = output.split('\n\n')
    for (const block of blocks) {
      const lines = block.trim().split('\n')
      const worktreeLine = lines.find((l) => l.startsWith('worktree '))
      if (!worktreeLine) continue

      const wtPath = path.resolve(worktreeLine.slice('worktree '.length).trim())
      const taskId = taskByWorktree.get(wtPath)
      if (taskId !== undefined) {
        this.activeWorktrees.set(taskId, wtPath)
      }
    }
  }

  /**
   * Get uncommitted/untracked files for a task's branch.
   */
  async getWorkingTreeStatus(taskId: number): Promise<FileStatus[]> {
    const worktreeDir = this.activeWorktrees.get(taskId)
    const cwd = worktreeDir ?? this.projectPath

    const output = await this.git(['status', '--porcelain'], cwd)
    if (!output.trim()) return []

    return output.split('\n').filter(Boolean).map(line => {
      const indexStatus = line[0]
      const workStatus = line[1]
      const filePath = line.slice(3).trim()

      // Parse git status codes
      let status: FileStatus['status'] = 'modified'
      let staged = false

      if (indexStatus === '?' && workStatus === '?') {
        status = 'untracked'
      } else if (indexStatus === 'A') {
        status = 'added'
        staged = true
      } else if (indexStatus === 'D' || workStatus === 'D') {
        status = 'deleted'
        staged = indexStatus === 'D'
      } else if (indexStatus === 'R') {
        status = 'renamed'
        staged = true
      } else if (indexStatus === 'M') {
        status = 'modified'
        staged = true
      } else if (workStatus === 'M') {
        status = 'modified'
        staged = false
      }

      return { path: filePath, status, staged }
    })
  }

  /**
   * Stage all files in a task's worktree.
   */
  async stageAll(taskId: number): Promise<{ staged: number; errors: string[] }> {
    const worktreeDir = this.activeWorktrees.get(taskId)
    const cwd = worktreeDir ?? this.projectPath

    // Get list of files to stage, then add them individually to handle partial failures
    const statusOutput = await this.git(['status', '--porcelain'], cwd)
    if (!statusOutput) return { staged: 0, errors: [] }

    const files = statusOutput.split('\n').filter(Boolean).map(line => line.slice(3).trim())
    const errors: string[] = []
    let staged = 0

    for (const file of files) {
      try {
        await this.git(['add', '--', file], cwd)
        staged++
      } catch (err: any) {
        const msg = [err.stderr, err.message].filter(Boolean).join(' ')
        if (msg.includes('invalid path') || msg.includes('unable to add')) {
          errors.push(`Skipped '${file}': invalid path (reserved name on Windows)`)
        } else if (!msg.includes('warning:')) {
          errors.push(`Failed to stage '${file}': ${msg}`)
        } else {
          // CRLF warnings are fine, file was still staged
          staged++
        }
      }
    }

    return { staged, errors }
  }

  /**
   * Getter for the detected base branch.
   */
  getBaseBranch(): string {
    return this.baseBranch
  }
}
