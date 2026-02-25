import { useEffect } from 'react'
import { useLayoutStore } from './stores/layoutStore'
import { usePipelineStore } from './stores/pipelineStore'
import { ProjectSelector } from './components/ProjectSelector/ProjectSelector'
import { Dashboard } from './components/Dashboard/Dashboard'
import { TaskDetail } from './components/TaskDetail/TaskDetail'
import { Workshop } from './components/Workshop/Workshop'
import { TitleBar } from './components/common/TitleBar'
import { ErrorBoundary } from './components/common/ErrorBoundary'
import { ToastContainer } from './components/common/Toast'
import { ApprovalDialog } from './components/common/ApprovalDialog'

export default function App() {
  const view = useLayoutStore((s) => s.view)
  const approvalRequest = usePipelineStore((s) => s.approvalRequest)

  // Global pipeline IPC listeners — persist across all views
  useEffect(() => {
    const cleanup = usePipelineStore.getState().setupListeners()
    return cleanup
  }, [])

  return (
    <div className="h-screen bg-bg flex flex-col">
      <TitleBar />
      <ErrorBoundary>
        <div className="flex-1 min-h-0">
          {view === 'projects' && <ProjectSelector />}
          {view === 'dashboard' && <Dashboard />}
          {view === 'task-detail' && <TaskDetail />}
          {view === 'workshop' && <Workshop />}
        </div>
      </ErrorBoundary>
      {approvalRequest && <ApprovalDialog />}
      <ToastContainer />
    </div>
  )
}
