import { useState } from 'react'
import { useGitStore } from '../../stores/gitStore'

export function BranchDetail() {
  const branches = useGitStore((s) => s.branches)
  const selectedTaskId = useGitStore((s) => s.selectedTaskId)
  const pushBranch = useGitStore((s) => s.push)
  const mergeBranch = useGitStore((s) => s.merge)
  const deleteBranch = useGitStore((s) => s.deleteBranch)
  const commitBranch = useGitStore((s) => s.commit)
  const error = useGitStore((s) => s.error)
  const [commitMsg, setCommitMsg] = useState('')
  const [confirming, setConfirming] = useState<'merge' | 'delete' | null>(null)

  const branch = branches.find((b) => b.taskId === selectedTaskId)

  if (!branch) {
    return (
      <div className="flex-1 flex items-center justify-center text-textSecondary">
        Select a branch to view details
      </div>
    )
  }

  return (
    <div className="flex-1 p-6 overflow-y-auto">
      <div className="max-w-2xl">
        <h2 className="text-xl font-semibold text-text mb-1">{branch.branchName}</h2>
        <p className="text-sm text-textSecondary mb-6">Task: {branch.taskTitle}</p>

        {error && (
          <div className="mb-4 px-4 py-3 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400 text-sm">
            {error}
          </div>
        )}

        {/* Status grid */}
        <div className="grid grid-cols-2 gap-4 mb-6">
          <div className="bg-surface rounded-lg p-4">
            <div className="text-xs text-textSecondary mb-1">Status</div>
            <div className="text-sm font-medium text-text capitalize">
              {branch.status}{branch.worktreeActive && ' (worktree active)'}
            </div>
          </div>
          <div className="bg-surface rounded-lg p-4">
            <div className="text-xs text-textSecondary mb-1">Commits</div>
            <div className="text-sm font-medium text-text">
              {branch.commitCount} total
              {branch.aheadOfBase > 0 && ` · ${branch.aheadOfBase} ahead`}
              {branch.behindBase > 0 && ` · ${branch.behindBase} behind`}
            </div>
          </div>
          <div className="bg-surface rounded-lg p-4">
            <div className="text-xs text-textSecondary mb-1">Last Commit</div>
            <div className="text-sm text-text truncate">{branch.lastCommitMessage || 'None'}</div>
            <div className="text-xs text-textSecondary mt-1">
              {branch.lastCommitDate ? new Date(branch.lastCommitDate).toLocaleString() : ''}
            </div>
          </div>
          <div className="bg-surface rounded-lg p-4">
            <div className="text-xs text-textSecondary mb-1">Remote</div>
            <div className="text-sm font-medium text-text">
              {branch.pushed ? 'Pushed to origin' : 'Local only'}
            </div>
          </div>
        </div>

        {/* Manual commit */}
        <div className="mb-6">
          <h3 className="text-sm font-medium text-textSecondary mb-2">Manual Commit</h3>
          <div className="flex gap-2">
            <input
              type="text"
              value={commitMsg}
              onChange={(e) => setCommitMsg(e.target.value)}
              placeholder="Commit message..."
              className="flex-1 bg-surface border border-border rounded-lg px-3 py-2 text-sm text-text placeholder-textSecondary focus:outline-none focus:border-accent"
            />
            <button
              onClick={() => { commitBranch(branch.taskId, commitMsg); setCommitMsg('') }}
              disabled={!commitMsg.trim()}
              className="px-4 py-2 bg-accent text-bg rounded-lg text-sm font-medium hover:bg-accent/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              Commit
            </button>
          </div>
        </div>

        {/* Action buttons */}
        <div className="flex flex-wrap gap-3">
          <button
            onClick={() => pushBranch(branch.taskId)}
            className="px-4 py-2 bg-surface border border-border rounded-lg text-sm text-text hover:bg-border transition-colors"
          >
            Push to Origin
          </button>

          {confirming === 'merge' ? (
            <div className="flex gap-2">
              <button
                onClick={() => { mergeBranch(branch.taskId); setConfirming(null) }}
                className="px-4 py-2 bg-green-600 rounded-lg text-sm text-white hover:bg-green-700 transition-colors"
              >
                Confirm Merge
              </button>
              <button
                onClick={() => setConfirming(null)}
                className="px-4 py-2 bg-surface border border-border rounded-lg text-sm text-text hover:bg-border transition-colors"
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              onClick={() => setConfirming('merge')}
              disabled={branch.status === 'merged'}
              className="px-4 py-2 bg-surface border border-border rounded-lg text-sm text-text hover:bg-border disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              Merge to Main
            </button>
          )}

          {confirming === 'delete' ? (
            <div className="flex gap-2">
              <button
                onClick={() => { deleteBranch(branch.taskId); setConfirming(null) }}
                className="px-4 py-2 bg-red-600 rounded-lg text-sm text-white hover:bg-red-700 transition-colors"
              >
                Confirm Delete
              </button>
              <button
                onClick={() => setConfirming(null)}
                className="px-4 py-2 bg-surface border border-border rounded-lg text-sm text-text hover:bg-border transition-colors"
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              onClick={() => setConfirming('delete')}
              className="px-4 py-2 bg-red-500/10 border border-red-500/30 rounded-lg text-sm text-red-400 hover:bg-red-500/20 transition-colors"
            >
              Delete Branch
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
