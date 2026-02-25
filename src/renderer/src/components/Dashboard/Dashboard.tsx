import { TopBar } from './TopBar'
import { MetricsRow } from './MetricsRow'

export function Dashboard() {
  return (
    <div className="h-screen bg-bg flex flex-col">
      <TopBar />
      <MetricsRow />
      <div className="flex-1 flex items-center justify-center text-text-muted">
        Kanban board will go here
      </div>
    </div>
  )
}
