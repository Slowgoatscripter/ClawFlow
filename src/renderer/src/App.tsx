import { useEffect } from 'react'
import { useLayoutStore } from './stores/layoutStore'
import { usePipelineStore } from './stores/pipelineStore'
import { useSettingsStore } from './stores/settingsStore'
import { colors } from './theme'
import { ProjectSelector } from './components/ProjectSelector/ProjectSelector'
import { Dashboard } from './components/Dashboard/Dashboard'
import { TaskDetail } from './components/TaskDetail/TaskDetail'
import { Git } from './components/Git/Git'
import { TitleBar } from './components/common/TitleBar'
import { ErrorBoundary } from './components/common/ErrorBoundary'
import { ToastContainer } from './components/common/Toast'
import { ApprovalDialog } from './components/common/ApprovalDialog'
import { ArchiveDrawer } from './components/ArchiveDrawer/ArchiveDrawer'

export default function App() {
  const view = useLayoutStore((s) => s.view)
  const taskDetailOverlayId = useLayoutStore((s) => s.taskDetailOverlayId)
  const approvalRequest = usePipelineStore((s) => s.approvalRequest)
  const usagePausedToast = usePipelineStore((s) => s.usagePausedToast)
  const dismissToast = usePipelineStore((s) => s.dismissUsagePausedToast)
  const loadGlobalSettings = useSettingsStore((s) => s.loadGlobalSettings)
  const density = useSettingsStore((s) => s.density)
  const fontSize = useSettingsStore((s) => s.fontSize)

  // Global pipeline IPC listeners — persist across all views
  useEffect(() => {
    const cleanup = usePipelineStore.getState().setupListeners()
    return cleanup
  }, [])

  // Load persisted settings on startup
  useEffect(() => {
    loadGlobalSettings()
  }, [])

  return (
    <div className={`h-screen bg-bg flex flex-col density-${density} font-size-${fontSize} scanlines`}>
      <TitleBar />
      <ErrorBoundary>
        <div className="flex-1 min-h-0" key={view}>
          <div className="h-full animate-[fade-scale-in_0.3s_cubic-bezier(0.4,0,0.2,1)]">
            {view === 'projects' && <ProjectSelector />}
            {view === 'dashboard' && <Dashboard />}
            {view === 'git' && <Git />}
          </div>
          {taskDetailOverlayId !== null && <TaskDetail />}
        </div>
      </ErrorBoundary>
      {approvalRequest && <ApprovalDialog />}
      <ArchiveDrawer />
      <ToastContainer />
      {usagePausedToast && (
        <div
          className="fixed top-4 right-4 z-50 p-4 rounded-lg shadow-lg max-w-sm"
          style={{ background: colors.elevated, border: `1px solid ${colors.accent.amber}` }}
        >
          <div className="flex items-start gap-3">
            <span style={{ color: colors.accent.amber, fontSize: '18px' }}>⚡</span>
            <div className="flex-1">
              <p className="text-sm font-medium" style={{ color: colors.text.primary }}>
                Usage at {Math.round(usagePausedToast.utilization)}%
              </p>
              <p className="text-xs mt-1" style={{ color: colors.text.secondary }}>
                Paused {usagePausedToast.pausedCount} running task{usagePausedToast.pausedCount !== 1 ? 's' : ''}.
                Resets in {usagePausedToast.countdown}.
              </p>
            </div>
            <button
              onClick={dismissToast}
              className="text-sm hover:opacity-70 transition-opacity"
              style={{ color: colors.text.muted }}
            >
              ✕
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
