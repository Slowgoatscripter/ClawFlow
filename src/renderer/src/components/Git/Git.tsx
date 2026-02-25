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

  useEffect(() => {
    const cleanup = useGitStore.getState().setupListeners()
    if (currentProject) {
      loadBranches()
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
            className="text-sm text-textSecondary hover:text-text transition-colors"
          >
            &larr; Dashboard
          </button>
          <h1 className="text-lg font-semibold text-text">Git</h1>
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
