import { useGitStore } from '../../stores/gitStore'
import type { GitBranch } from '../../../../shared/types'

const STATUS_COLORS: Record<GitBranch['status'], string> = {
  active: 'bg-green-500',
  completed: 'bg-blue-500',
  stale: 'bg-yellow-500',
  merged: 'bg-gray-500'
}

const STATUS_LABELS: Record<GitBranch['status'], string> = {
  active: 'Active',
  completed: 'Completed',
  stale: 'Stale',
  merged: 'Merged'
}

export function BranchList() {
  const branches = useGitStore((s) => s.branches)
  const selectedTaskId = useGitStore((s) => s.selectedTaskId)
  const selectBranch = useGitStore((s) => s.selectBranch)
  const loading = useGitStore((s) => s.loading)

  return (
    <div className="w-72 border-r border-border flex flex-col">
      <div className="px-4 py-3 border-b border-border">
        <h2 className="text-sm font-medium text-textSecondary">Branches</h2>
      </div>
      <div className="flex-1 overflow-y-auto">
        {loading && (
          <div className="px-4 py-8 text-center text-textSecondary text-sm">Loading...</div>
        )}
        {!loading && branches.length === 0 && (
          <div className="px-4 py-8 text-center text-textSecondary text-sm">
            No task branches yet. Start a pipeline to create one.
          </div>
        )}
        {branches.map((branch) => (
          <button
            key={branch.taskId}
            onClick={() => selectBranch(branch.taskId)}
            className={`w-full text-left px-4 py-3 border-b border-border hover:bg-surface transition-colors ${
              selectedTaskId === branch.taskId ? 'bg-surface' : ''
            }`}
          >
            <div className="flex items-center gap-2 mb-1">
              <span className={`w-2 h-2 rounded-full ${STATUS_COLORS[branch.status]}`} />
              <span className="text-sm font-medium text-text truncate">{branch.branchName}</span>
            </div>
            <div className="text-xs text-textSecondary ml-4">{branch.taskTitle}</div>
            <div className="text-xs text-textSecondary ml-4 mt-1 flex items-center gap-2">
              <span>
                {branch.commitCount} commits &middot; {STATUS_LABELS[branch.status]}
                {branch.pushed && ' · Pushed'}
              </span>
              {branch.dirtyFileCount > 0 && (
                <span className="text-yellow-400 text-[10px] ml-auto">{branch.dirtyFileCount} dirty</span>
              )}
            </div>
          </button>
        ))}
      </div>
    </div>
  )
}
