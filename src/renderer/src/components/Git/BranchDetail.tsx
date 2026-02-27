import { useState } from 'react'
import { useGitStore } from '../../stores/gitStore'
import type { FileStatus } from '../../../../shared/types'

const STATUS_INDICATORS: Record<FileStatus['status'], { label: string; color: string }> = {
  modified: { label: 'M', color: 'text-accent-amber' },
  added: { label: 'A', color: 'text-accent-green' },
  deleted: { label: 'D', color: 'text-accent-magenta' },
  untracked: { label: '?', color: 'text-text-muted' },
  renamed: { label: 'R', color: 'text-accent-cyan' }
}

export function BranchDetail() {
  const branches = useGitStore((s) => s.branches)
  const selectedTaskId = useGitStore((s) => s.selectedTaskId)
  const pushBranch = useGitStore((s) => s.push)
  const mergeBranch = useGitStore((s) => s.merge)
  const deleteBranch = useGitStore((s) => s.deleteBranch)
  const commitBranch = useGitStore((s) => s.commit)
  const error = useGitStore((s) => s.error)
  const fileStatuses = useGitStore((s) => s.fileStatuses)
  const loadingStatus = useGitStore((s) => s.loadingStatus)
  const stageAllAction = useGitStore((s) => s.stageAll)
  const clearError = useGitStore((s) => s.clearError)
  const [commitMsg, setCommitMsg] = useState('')
  const [confirming, setConfirming] = useState<'merge' | 'delete' | null>(null)

  const branch = branches.find((b) => b.taskId === selectedTaskId)

  if (!branch) {
    return (
      <div className="flex-1 flex items-center justify-center text-text-secondary">
        Select a branch to view details
      </div>
    )
  }

  return (
    <div className="flex-1 p-6 overflow-y-auto">
      <div className="max-w-2xl">
        <h2 className="text-xl font-semibold text-text-primary mb-1">{branch.branchName}</h2>
        <p className="text-sm text-text-secondary mb-6">Task: {branch.taskTitle}</p>

        {error && (
          <div
            onClick={() => clearError()}
            className="mb-4 px-4 py-3 bg-accent-magenta/10 border border-accent-magenta/30 rounded-lg text-accent-magenta text-sm cursor-pointer hover:bg-accent-magenta/15 transition-colors"
          >
            {error}
            <span className="text-accent-magenta/50 text-xs ml-2">click to dismiss</span>
          </div>
        )}

        {/* Status grid */}
        <div className="grid grid-cols-2 gap-4 mb-6">
          <div className="bg-surface rounded-lg p-4">
            <div className="text-xs text-text-secondary mb-1">Status</div>
            <div className="text-sm font-medium text-text-primary capitalize">
              {branch.status}{branch.worktreeActive && ' (worktree active)'}
            </div>
          </div>
          <div className="bg-surface rounded-lg p-4">
            <div className="text-xs text-text-secondary mb-1">Commits</div>
            <div className="text-sm font-medium text-text-primary">
              {branch.commitCount} total
              {branch.aheadOfBase > 0 && ` · ${branch.aheadOfBase} ahead`}
              {branch.behindBase > 0 && ` · ${branch.behindBase} behind`}
            </div>
          </div>
          <div className="bg-surface rounded-lg p-4">
            <div className="text-xs text-text-secondary mb-1">Last Commit</div>
            <div className="text-sm text-text-primary truncate">{branch.lastCommitMessage || 'None'}</div>
            <div className="text-xs text-text-secondary mt-1">
              {branch.lastCommitDate ? new Date(branch.lastCommitDate).toLocaleString() : ''}
            </div>
          </div>
          <div className="bg-surface rounded-lg p-4">
            <div className="text-xs text-text-secondary mb-1">Remote</div>
            <div className="text-sm font-medium text-text-primary">
              {branch.pushed ? 'Pushed to origin' : 'Local only'}
            </div>
          </div>
        </div>

        {/* Working Tree Status */}
        {fileStatuses.length > 0 && (
          <div className="mb-6">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-medium text-accent-amber">
                ⚠ Working Tree ({fileStatuses.length} uncommitted)
              </h3>
              <button
                onClick={() => stageAllAction(branch.taskId)}
                className="px-3 py-1 text-xs bg-surface border border-border rounded-lg text-text-primary hover:bg-border transition-colors"
              >
                Stage All
              </button>
            </div>
            <div className="bg-surface rounded-lg border border-border overflow-hidden">
              {fileStatuses.map((file, i) => {
                const indicator = STATUS_INDICATORS[file.status]
                return (
                  <div
                    key={i}
                    className="flex items-center gap-3 px-3 py-1.5 border-b border-border last:border-b-0 font-mono text-xs"
                  >
                    <span className={`w-4 text-center font-bold ${indicator.color}`}>
                      {indicator.label}
                    </span>
                    {file.staged && (
                      <span className="text-accent-green text-[10px]">staged</span>
                    )}
                    <span className="text-text-primary truncate">{file.path}</span>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {loadingStatus && fileStatuses.length === 0 && (
          <div className="mb-6 text-xs text-text-secondary">Loading file status...</div>
        )}

        {/* Manual commit */}
        <div className="mb-6">
          <h3 className="text-sm font-medium text-text-secondary mb-2">Manual Commit</h3>
          <div className="flex gap-2">
            <input
              type="text"
              value={commitMsg}
              onChange={(e) => setCommitMsg(e.target.value)}
              placeholder="Commit message..."
              className="flex-1 bg-surface border border-border rounded-lg px-3 py-2 text-sm text-text-primary placeholder-text-secondary focus:outline-none focus:border-accent-cyan"
            />
            <button
              onClick={() => { commitBranch(branch.taskId, commitMsg); setCommitMsg('') }}
              disabled={!commitMsg.trim()}
              className="px-4 py-2 bg-accent-cyan text-bg rounded-lg text-sm font-medium hover:bg-accent-cyan/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              Commit
            </button>
          </div>
        </div>

        {/* Action buttons */}
        <div className="flex flex-wrap gap-3">
          <button
            onClick={() => pushBranch(branch.taskId)}
            className="px-4 py-2 bg-surface border border-border rounded-lg text-sm text-text-primary hover:bg-border transition-colors"
          >
            Push to Origin
          </button>

          {confirming === 'merge' ? (
            <div className="flex gap-2">
              <button
                onClick={() => { mergeBranch(branch.taskId); setConfirming(null) }}
                className="px-4 py-2 bg-accent-green rounded-lg text-sm text-white hover:bg-accent-green/90 transition-colors"
              >
                Confirm Merge
              </button>
              <button
                onClick={() => setConfirming(null)}
                className="px-4 py-2 bg-surface border border-border rounded-lg text-sm text-text-primary hover:bg-border transition-colors"
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              onClick={() => setConfirming('merge')}
              disabled={branch.status === 'merged'}
              className="px-4 py-2 bg-surface border border-border rounded-lg text-sm text-text-primary hover:bg-border disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              Merge to Main
            </button>
          )}

          {confirming === 'delete' ? (
            <div className="flex gap-2">
              <button
                onClick={() => { deleteBranch(branch.taskId); setConfirming(null) }}
                className="px-4 py-2 bg-accent-magenta rounded-lg text-sm text-white hover:bg-accent-magenta/90 transition-colors"
              >
                Confirm Delete
              </button>
              <button
                onClick={() => setConfirming(null)}
                className="px-4 py-2 bg-surface border border-border rounded-lg text-sm text-text-primary hover:bg-border transition-colors"
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              onClick={() => setConfirming('delete')}
              className="px-4 py-2 bg-accent-magenta/10 border border-accent-magenta/30 rounded-lg text-sm text-accent-magenta hover:bg-accent-magenta/20 transition-colors"
            >
              Delete Branch
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
