import type { Task, TaskStatus } from '../../../../shared/types'
import { useTaskStore } from '../../stores/taskStore'
import { KanbanColumn } from './KanbanColumn'

const COLUMN_ORDER: TaskStatus[] = [
  'backlog',
  'brainstorming',
  'design_review',
  'planning',
  'implementing',
  'code_review',
  'verifying',
  'done',
  'blocked'
]

function sortTasksNewestFirst(tasks: Task[], status: TaskStatus): Task[] {
  return [...tasks].sort((a, b) => {
    const getTime = (t: Task) => {
      if (status === 'done' && t.completedAt) return new Date(t.completedAt).getTime()
      if (t.startedAt) return new Date(t.startedAt).getTime()
      return new Date(t.createdAt).getTime()
    }
    return getTime(b) - getTime(a)
  })
}

export function KanbanBoard() {
  const tasks = useTaskStore((s) => s.tasks)

  return (
    <div className="flex-1 flex overflow-x-auto gap-4 p-4">
      {COLUMN_ORDER.map((status) => (
        <KanbanColumn
          key={status}
          status={status}
          tasks={sortTasksNewestFirst(
            tasks.filter((t) => t.status === status && !t.archivedAt),
            status
          )}
        />
      ))}
    </div>
  )
}
