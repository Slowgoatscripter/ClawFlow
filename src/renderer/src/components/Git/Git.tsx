import { useEffect } from 'react'
import { useProjectStore } from '../../stores/projectStore'
import { useGitStore } from '../../stores/gitStore'
import { useLayoutStore } from '../../stores/layoutStore'
import { BranchList } from './BranchList'
import { BranchDetail } from './BranchDetail'
import { GitStatusBar } from './GitStatusBar'

export function Git() {
  const currentProject = useProjectStore((s) => s.currentProject)
  const loadBranches = useGitStore((s) => s.loadBranches)
  const baseBranch = useGitStore((s) => s.baseBranch)
  const localBranches = useGitStore((s) => s.localBranches)
  const setBaseBranch = useGitStore((s) => s.setBaseBranch)

  useEffect(() => {
    const cleanup = useGitStore.getState().setupListeners()
    if (currentProject) {
      loadBranches()
      useGitStore.getState().loadLocalBranches()
    }
    return cleanup
  }, [currentProject])

  if (!currentProject) return null

  return (
    <div className="h-full bg-bg flex flex-col">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <div className="flex items-center gap-3">
          <button
            onClick={() => useLayoutStore.getState().setView('dashboard')}
            className="text-sm text-text-secondary hover:text-text-primary transition-colors"
          >
            &larr; Dashboard
          </button>
          <h1 className="text-lg font-semibold text-text-primary">Git</h1>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm text-text-secondary">Base:</span>
          <select
            value={baseBranch}
            onChange={(e) => setBaseBranch(e.target.value)}
            className="bg-surface border border-border rounded-lg px-2 py-1 text-sm text-text-primary focus:outline-none focus:border-accent-cyan"
          >
            {localBranches.map((b) => (
              <option key={b} value={b}>{b}</option>
            ))}
          </select>
        </div>
      </div>
      <div className="flex-1 flex overflow-hidden">
        <BranchList />
        <BranchDetail />
      </div>
      <GitStatusBar />
    </div>
  )
}
