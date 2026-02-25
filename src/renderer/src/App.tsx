import { useLayoutStore } from './stores/layoutStore'
import { ProjectSelector } from './components/ProjectSelector/ProjectSelector'
import { Dashboard } from './components/Dashboard/Dashboard'
import { TaskDetail } from './components/TaskDetail/TaskDetail'

export default function App() {
  const view = useLayoutStore((s) => s.view)

  if (view === 'projects') return <ProjectSelector />
  if (view === 'dashboard') return <Dashboard />
  if (view === 'task-detail') return <TaskDetail />
  return (
    <div className="text-text-primary bg-bg h-screen flex items-center justify-center">
      Unknown view
    </div>
  )
}
