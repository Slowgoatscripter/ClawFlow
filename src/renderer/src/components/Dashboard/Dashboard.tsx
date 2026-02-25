import { TopBar } from './TopBar'
import { MetricsRow } from './MetricsRow'
import { KanbanBoard } from '../KanbanBoard/KanbanBoard'

export function Dashboard() {
  return (
    <div className="h-screen bg-bg flex flex-col">
      <TopBar />
      <MetricsRow />
      <KanbanBoard />
    </div>
  )
}
