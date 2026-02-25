import { useLayoutStore } from './stores/layoutStore'
import { ProjectSelector } from './components/ProjectSelector/ProjectSelector'
import { Dashboard } from './components/Dashboard/Dashboard'

export default function App() {
  const view = useLayoutStore((s) => s.view)

  if (view === 'projects') return <ProjectSelector />
  if (view === 'dashboard') return <Dashboard />
  return (
    <div className="text-text-primary bg-bg h-screen flex items-center justify-center">
      Task Detail (coming soon)
    </div>
  )
}
