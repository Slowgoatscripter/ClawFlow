import { useGitStore } from '../../stores/gitStore'

export function GitStatusBar() {
  const branches = useGitStore((s) => s.branches)
  const active = branches.filter((b) => b.status === 'active').length
  const completed = branches.filter((b) => b.status === 'completed').length
  const merged = branches.filter((b) => b.status === 'merged').length
  const stale = branches.filter((b) => b.status === 'stale').length

  return (
    <div className="px-4 py-2 border-t border-border text-xs text-textSecondary flex gap-4">
      <span>{branches.length} branches</span>
      {active > 0 && <span className="text-green-400">{active} active</span>}
      {completed > 0 && <span className="text-blue-400">{completed} completed</span>}
      {merged > 0 && <span className="text-gray-400">{merged} merged</span>}
      {stale > 0 && <span className="text-yellow-400">{stale} stale</span>}
    </div>
  )
}
