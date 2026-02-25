import { useLayoutStore } from './stores/layoutStore'
import { ProjectSelector } from './components/ProjectSelector/ProjectSelector'
import { Dashboard } from './components/Dashboard/Dashboard'
import { TaskDetail } from './components/TaskDetail/TaskDetail'
import { TitleBar } from './components/common/TitleBar'
import { ErrorBoundary } from './components/common/ErrorBoundary'
import { ToastContainer } from './components/common/Toast'

export default function App() {
  const view = useLayoutStore((s) => s.view)

  return (
    <div className="h-screen bg-bg flex flex-col">
      <TitleBar />
      <ErrorBoundary>
        <div className="flex-1 min-h-0">
          {view === 'projects' && <ProjectSelector />}
          {view === 'dashboard' && <Dashboard />}
          {view === 'task-detail' && <TaskDetail />}
        </div>
      </ErrorBoundary>
      <ToastContainer />
    </div>
  )
}
