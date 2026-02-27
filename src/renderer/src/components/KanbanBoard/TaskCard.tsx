import type { Task } from '../../../../shared/types'
import { useTaskStore } from '../../stores/taskStore'
import { useLayoutStore } from '../../stores/layoutStore'
import { usePipelineStore } from '../../stores/pipelineStore'
import { useProjectStore } from '../../stores/projectStore'
import { isAwaitingReviewFromHandoffs } from '../../utils/taskHelpers'

const tierColors: Record<string, string> = {
  L1: 'bg-accent-green/20 text-accent-green',
  L2: 'bg-accent-cyan/20 text-accent-cyan',
  L3: 'bg-accent-violet/20 text-accent-violet'
}

const priorityColors: Record<string, string> = {
  low: 'bg-text-muted',
  medium: 'bg-accent-cyan',
  high: 'bg-accent-peach',
  critical: 'bg-accent-magenta'
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

export function TaskCard({ task, index = 0 }: { task: Task; index?: number }) {
  const selectTask = useTaskStore((s) => s.selectTask)
  const archiveTask = useTaskStore((s) => s.archiveTask)
  const allTasks = useTaskStore((s) => s.tasks)
  const setView = useLayoutStore((s) => s.setView)
  const todosByTaskId = usePipelineStore((s) => s.todosByTaskId)
  const awaitingReview = usePipelineStore((s) => s.awaitingReview[task.id] ?? false)
  const currentProject = useProjectStore((s) => s.currentProject)
  const counts = todoCounts(todosByTaskId[task.id] || (task.todos ?? undefined), task.status)

  // Dependency-blocked check
  const pendingDeps = (task.dependencyIds ?? [])
    .map((depId) => allTasks.find((t) => t.id === depId))
    .filter((dep) => dep && dep.status !== 'done')
  const isDependencyBlocked = pendingDeps.length > 0

  const isAwaitingFromHandoffs = isAwaitingReviewFromHandoffs(task)
  const isAwaiting = awaitingReview || isAwaitingFromHandoffs

  const context = usePipelineStore((s) => s.contextByTaskId[task.id])
  const isPaused = task.status === 'paused'
  const isRunning = ['brainstorming', 'design_review', 'planning', 'implementing', 'code_review', 'verifying'].includes(task.status)

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

  const runningStyle = isRunning ? {
    background: `linear-gradient(var(--color-elevated), var(--color-elevated)) padding-box, linear-gradient(90deg, var(--color-accent-cyan), var(--color-accent-violet), var(--color-accent-cyan)) border-box`,
    border: '2px solid transparent',
    backgroundSize: '100% 100%, 200% 100%',
    animation: 'neon-border-sweep 4s linear infinite',
  } : {}

  return (
    <div
      onClick={handleClick}
      style={{ animationDelay: `${index * 50}ms`, ...runningStyle }}
      className={`relative group bg-elevated rounded-lg p-3 cursor-pointer ${isRunning ? '' : 'border border-transparent'} hover:border-border-bright hover:shadow-[0_0_12px_rgba(0,229,255,0.06)] transition-colors animate-[stagger-in_0.2s_cubic-bezier(0.4,0,0.2,1)_both] ${isAwaiting ? 'animate-[glow-pulse_3s_ease-in-out_infinite] border-l-[3px] border-l-accent-amber' : ''}`}
    >
      {/* Pause/resume buttons */}
      {isRunning && (
        <button
          className="pause-btn"
          onClick={(e) => { e.stopPropagation(); usePipelineStore.getState().pauseTask(task.id) }}
          title="Pause task"
        >
          ⏸
        </button>
      )}
      {isPaused && (
        <button
          className="resume-btn"
          onClick={(e) => { e.stopPropagation(); usePipelineStore.getState().resumeTask(task.id) }}
          title="Resume task"
        >
          ▶
        </button>
      )}

      {/* Per-card archive button (done tasks only) */}
      {task.status === 'done' && (
        <button
          onClick={handleArchive}
          className="absolute top-1.5 right-1.5 text-text-muted hover:text-accent-amber opacity-0 group-hover:opacity-100 transition-opacity"
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

      {/* Dependency-blocked indicator */}
      {isDependencyBlocked && (
        <div className="flex items-center gap-1.5 mt-2 text-[10px] text-accent-amber bg-accent-amber/10 rounded px-1.5 py-1">
          <svg className="w-3 h-3 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
            <path d="M7 11V7a5 5 0 0110 0v4" />
          </svg>
          <span className="truncate">
            Waiting on: {pendingDeps.map((d) => d!.title).join(', ')}
          </span>
        </div>
      )}

      {/* Agent + time row */}
      <div className="flex items-center justify-between mt-2">
        {task.currentAgent ? (
          <span className="text-xs text-accent-amber flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-accent-amber animate-pulse" />
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

      {/* Context progress bar */}
      {context && isRunning && (
        <div className="context-bar" title={`${Math.round(context.tokens / 1000)}k / ${Math.round(context.max / 1000)}k tokens`}>
          <div
            className="context-bar-fill"
            style={{ width: `${Math.min((context.tokens / context.max) * 100, 100)}%` }}
            data-level={context.tokens / context.max > 0.8 ? 'danger' : context.tokens / context.max > 0.5 ? 'warn' : 'ok'}
          />
        </div>
      )}
    </div>
  )
}
