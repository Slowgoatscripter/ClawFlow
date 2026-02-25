import type { TaskStatus } from '../../../../shared/types'
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

export function KanbanBoard() {
  const tasks = useTaskStore((s) => s.tasks)

  return (
    <div className="flex-1 flex overflow-x-auto gap-4 p-4">
      {COLUMN_ORDER.map((status) => (
        <KanbanColumn
          key={status}
          status={status}
          tasks={tasks.filter((t) => t.status === status)}
        />
      ))}
    </div>
  )
}
