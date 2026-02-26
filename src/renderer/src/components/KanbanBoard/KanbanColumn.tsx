import { useState } from 'react'
import type { Task, TaskStatus } from '../../../../shared/types'
import { TaskCard } from './TaskCard'
import { colors } from '../../theme'
import { useTaskStore } from '../../stores/taskStore'
import { useProjectStore } from '../../stores/projectStore'

function formatStatus(status: string): string {
  return status
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

export function KanbanColumn({ status, tasks }: { status: TaskStatus; tasks: Task[] }) {
  const topColor = colors.status[status] ?? colors.text.muted
  const [collapsed, setCollapsed] = useState(status === 'done')
  const archiveAllDone = useTaskStore((s) => s.archiveAllDone)
  const currentProject = useProjectStore((s) => s.currentProject)

  const handleArchiveAll = () => {
    if (currentProject) {
      archiveAllDone(currentProject.dbPath)
    }
  }

  return (
    <div className="flex flex-col min-w-[180px] max-w-[260px] flex-1 gap-2">
      {/* Column header with color bar */}
      <div className="rounded-t" style={{ borderTop: `3px solid ${topColor}` }}>
        <div className="flex items-center gap-2 px-2 py-2">
          <span className="text-xs font-semibold text-text-secondary">{formatStatus(status)}</span>
          <span className="bg-surface text-text-muted text-[10px] font-medium rounded-full px-1.5 py-0.5 min-w-[20px] text-center">
            {tasks.length}
          </span>
          {status === 'done' && tasks.length > 0 && (
            <button
              onClick={handleArchiveAll}
              className="text-[10px] text-text-muted hover:text-accent-gold transition-colors ml-auto"
              title="Archive all done tasks"
            >
              Archive All
            </button>
          )}
          {status === 'done' && (
            <button
              onClick={() => setCollapsed(!collapsed)}
              className="text-text-muted hover:text-text-secondary transition-colors"
              title={collapsed ? 'Expand' : 'Collapse'}
            >
              <svg
                className={`w-3.5 h-3.5 transition-transform ${collapsed ? '' : 'rotate-180'}`}
                viewBox="0 0 20 20"
                fill="currentColor"
              >
                <path
                  fillRule="evenodd"
                  d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z"
                />
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* Scrollable task list */}
      {!(status === 'done' && collapsed) && (
        <div className="flex flex-col gap-2 overflow-y-auto flex-1 pr-1">
          {tasks.map((task) => (
            <TaskCard key={task.id} task={task} />
          ))}
        </div>
      )}
    </div>
  )
}
