import type { Task, TaskGroup, TaskGroupStatus } from '../../../../shared/types'
import { CanvasTaskLane } from './CanvasTaskLane'

interface CanvasGroupProps {
  group: TaskGroup
  tasks: Task[]
}

const STATUS_COLORS: Record<TaskGroupStatus, string> = {
  running: 'var(--color-accent-green)',
  paused: 'var(--color-accent-amber)',
  failed: 'var(--color-accent-magenta)',
  planning: 'var(--color-accent-violet)',
  queued: 'var(--color-accent-cyan)',
  completed: 'var(--color-accent-cyan)'
}

export function CanvasGroup({ group, tasks }: CanvasGroupProps) {
  const borderColor = STATUS_COLORS[group.status] ?? 'var(--color-border)'

  return (
    <div
      className="rounded-lg min-w-[200px]"
      style={{
        backgroundColor: 'var(--color-elevated)',
        border: `1px solid ${borderColor}`,
        boxShadow: `0 0 8px ${borderColor}22`
      }}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between gap-3 px-3 py-2 rounded-t-lg"
        style={{ borderBottom: `1px solid ${borderColor}33` }}
      >
        <span
          className="text-sm font-medium truncate"
          style={{ color: 'var(--color-text-primary)' }}
        >
          {group.title}
        </span>
        <div className="flex items-center gap-2 shrink-0">
          <span
            className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded"
            style={{
              backgroundColor: `${borderColor}22`,
              color: borderColor
            }}
          >
            {group.status}
          </span>
          <span
            className="text-[10px]"
            style={{ color: 'var(--color-text-muted)' }}
          >
            {tasks.length} task{tasks.length !== 1 ? 's' : ''}
          </span>
        </div>
      </div>

      {/* Body: horizontal task lanes */}
      <div className="flex gap-1 p-2 overflow-x-auto">
        {tasks.length > 0 ? (
          tasks.map((task) => (
            <CanvasTaskLane key={task.id} task={task} />
          ))
        ) : (
          <div
            className="text-xs py-4 text-center w-full"
            style={{ color: 'var(--color-text-muted)' }}
          >
            No tasks in group
          </div>
        )}
      </div>
    </div>
  )
}
