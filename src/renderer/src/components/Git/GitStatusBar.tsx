import { useGitStore } from '../../stores/gitStore'

export function GitStatusBar() {
  const branches = useGitStore((s) => s.branches)
  const active = branches.filter((b) => b.status === 'active').length
  const completed = branches.filter((b) => b.status === 'completed').length
  const merged = branches.filter((b) => b.status === 'merged').length
  const stale = branches.filter((b) => b.status === 'stale').length

  return (
    <div className="px-4 py-2 border-t border-border text-xs text-text-secondary flex gap-4">
      <span>{branches.length} branches</span>
      {active > 0 && <span className="text-accent-green">{active} active</span>}
      {completed > 0 && <span className="text-accent-cyan">{completed} completed</span>}
      {merged > 0 && <span className="text-text-muted">{merged} merged</span>}
      {stale > 0 && <span className="text-accent-amber">{stale} stale</span>}
    </div>
  )
}
