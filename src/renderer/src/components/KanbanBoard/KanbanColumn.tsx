import type { Task, TaskStatus } from '../../../../shared/types'
import { TaskCard } from './TaskCard'
import { colors } from '../../theme'

function formatStatus(status: string): string {
  return status
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

export function KanbanColumn({ status, tasks }: { status: TaskStatus; tasks: Task[] }) {
  const topColor = colors.status[status] ?? colors.text.muted

  return (
    <div className="flex flex-col min-w-[180px] max-w-[260px] flex-1 gap-2">
      {/* Column header with color bar */}
      <div className="rounded-t" style={{ borderTop: `3px solid ${topColor}` }}>
        <div className="flex items-center gap-2 px-2 py-2">
          <span className="text-xs font-semibold text-text-secondary">{formatStatus(status)}</span>
          <span className="bg-surface text-text-muted text-[10px] font-medium rounded-full px-1.5 py-0.5 min-w-[20px] text-center">
            {tasks.length}
          </span>
        </div>
      </div>

      {/* Scrollable task list */}
      <div className="flex flex-col gap-2 overflow-y-auto flex-1 pr-1">
        {tasks.map((task) => (
          <TaskCard key={task.id} task={task} />
        ))}
      </div>
    </div>
  )
}
