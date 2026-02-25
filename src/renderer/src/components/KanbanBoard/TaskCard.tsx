import type { Task } from '../../../../shared/types'
import { useTaskStore } from '../../stores/taskStore'
import { useLayoutStore } from '../../stores/layoutStore'

const tierColors: Record<string, string> = {
  L1: 'bg-accent-green/20 text-accent-green',
  L2: 'bg-accent-teal/20 text-accent-teal',
  L3: 'bg-accent-mauve/20 text-accent-mauve'
}

const priorityColors: Record<string, string> = {
  low: 'bg-text-muted',
  medium: 'bg-accent-teal',
  high: 'bg-accent-peach',
  critical: 'bg-accent-red'
}

function timeInStage(startedAt: string | null): string {
  if (!startedAt) return '\u2014'
  const diff = Date.now() - new Date(startedAt).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 60) return `${mins}m`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ${mins % 60}m`
  const days = Math.floor(hrs / 24)
  return `${days}d ${hrs % 24}h`
}

export function TaskCard({ task }: { task: Task }) {
  const selectTask = useTaskStore((s) => s.selectTask)
  const setView = useLayoutStore((s) => s.setView)

  const handleClick = () => {
    selectTask(task.id)
    setView('task-detail')
  }

  return (
    <div
      onClick={handleClick}
      className="bg-elevated rounded-lg p-3 cursor-pointer border border-transparent hover:border-accent-teal transition-colors"
    >
      {/* Title */}
      <p className="font-medium text-text-primary truncate text-sm">{task.title}</p>

      {/* Tier + Priority row */}
      <div className="flex items-center gap-2 mt-2">
        <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${tierColors[task.tier] ?? ''}`}>
          {task.tier}
        </span>
        <span className={`w-2 h-2 rounded-full ${priorityColors[task.priority] ?? ''}`} />
      </div>

      {/* Agent + time row */}
      <div className="flex items-center justify-between mt-2">
        {task.currentAgent ? (
          <span className="text-xs text-accent-gold flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-accent-gold animate-pulse" />
            {task.currentAgent}
          </span>
        ) : (
          <span />
        )}
        <span className="text-xs text-text-muted">{timeInStage(task.startedAt)}</span>
      </div>
    </div>
  )
}
