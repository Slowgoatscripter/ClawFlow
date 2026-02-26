import type { Task } from '../../../../shared/types'
import { useTaskStore } from '../../stores/taskStore'
import { useLayoutStore } from '../../stores/layoutStore'
import { usePipelineStore } from '../../stores/pipelineStore'
import { useProjectStore } from '../../stores/projectStore'
import { isAwaitingReviewFromHandoffs } from '../../utils/taskHelpers'

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

function todoCounts(todos: Record<string, any[]> | undefined, status: string | undefined): { done: number; total: number } | null {
  if (!todos) return null
  const stages = ['brainstorm', 'design_review', 'plan', 'implement', 'code_review', 'verify']
  const currentStage = [...stages].reverse().find(s => todos[s]?.length > 0)
  if (!currentStage) return null
  const items = todos[currentStage]
  return {
    done: items.filter((t: any) => t.status === 'completed').length,
    total: items.length
  }
}

export function TaskCard({ task }: { task: Task }) {
  const selectTask = useTaskStore((s) => s.selectTask)
  const archiveTask = useTaskStore((s) => s.archiveTask)
  const setView = useLayoutStore((s) => s.setView)
  const todosByTaskId = usePipelineStore((s) => s.todosByTaskId)
  const awaitingReview = usePipelineStore((s) => s.awaitingReview[task.id] ?? false)
  const currentProject = useProjectStore((s) => s.currentProject)
  const counts = todoCounts(todosByTaskId[task.id] || (task.todos ?? undefined), task.status)

  const isAwaitingFromHandoffs = isAwaitingReviewFromHandoffs(task)
  const isAwaiting = awaitingReview || isAwaitingFromHandoffs

  const handleClick = () => {
    selectTask(task.id)
    setView('task-detail')
  }

  const handleArchive = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (currentProject) {
      archiveTask(currentProject.dbPath, task.id)
    }
  }

  return (
    <div
      onClick={handleClick}
      className={`relative group bg-elevated rounded-lg p-3 cursor-pointer border border-transparent hover:border-accent-teal transition-colors ${isAwaiting ? 'animate-[glow-pulse_2s_ease-in-out_infinite]' : ''}`}
    >
      {/* Per-card archive button (done tasks only) */}
      {task.status === 'done' && (
        <button
          onClick={handleArchive}
          className="absolute top-1.5 right-1.5 text-text-muted hover:text-accent-gold opacity-0 group-hover:opacity-100 transition-opacity"
          title="Archive"
        >
          <svg
            className="w-3.5 h-3.5"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <rect x="2" y="3" width="20" height="5" rx="1" />
            <path d="M4 8v11a2 2 0 002 2h12a2 2 0 002-2V8" />
            <path d="M10 12h4" />
          </svg>
        </button>
      )}

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
        {counts && counts.total > 0 && (
          <span className="text-xs text-text-muted">
            {counts.done}/{counts.total} tasks
          </span>
        )}
        <span className="text-xs text-text-muted">{timeInStage(task.startedAt)}</span>
      </div>
    </div>
  )
}
