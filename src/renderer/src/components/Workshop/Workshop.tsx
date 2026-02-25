import { useEffect } from 'react'
import { useWorkshopStore } from '../../stores/workshopStore'
import { useProjectStore } from '../../stores/projectStore'
import { useLayoutStore } from '../../stores/layoutStore'
import { SessionList } from './SessionList'
import { ConversationPanel } from './ConversationPanel'
import { ArtifactPanel } from './ArtifactPanel'
import { TaskSuggestionModal } from './TaskSuggestionModal'

export function Workshop() {
  const currentProject = useProjectStore((s) => s.currentProject)
  const pendingSuggestions = useWorkshopStore((s) => s.pendingSuggestions)

  useEffect(() => {
    const cleanup = useWorkshopStore.getState().setupListeners()
    if (currentProject) {
      useWorkshopStore.getState().loadSessions(
        currentProject.dbPath,
        currentProject.path,
        currentProject.name,
        currentProject.name
      )
      useWorkshopStore.getState().loadArtifacts()
    }
    return cleanup
  }, [currentProject])

  if (!currentProject) return null

  return (
    <div className="h-full bg-bg flex flex-col">
      {/* Top bar */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <div className="flex items-center gap-3">
          <button
            onClick={() => useLayoutStore.getState().setView('dashboard')}
            className="text-text-muted hover:text-text transition-colors text-sm"
          >
            &larr; Dashboard
          </button>
          <h1 className="text-lg font-semibold text-text">Workshop</h1>
          <span className="text-text-muted text-sm">{currentProject.name}</span>
        </div>
        <AutoModeToggle />
      </div>

      {/* Three-panel layout */}
      <div className="flex-1 flex overflow-hidden">
        <SessionList />
        <ConversationPanel />
        <ArtifactPanel />
      </div>

      {/* Task suggestion modal */}
      {pendingSuggestions && <TaskSuggestionModal />}
    </div>
  )
}

function AutoModeToggle() {
  const autoMode = useWorkshopStore((s) => s.autoMode)
  const toggle = useWorkshopStore((s) => s.toggleAutoMode)

  return (
    <button
      onClick={toggle}
      className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
        autoMode
          ? 'bg-accent-teal/20 text-accent-teal'
          : 'bg-surface text-text-muted hover:text-text'
      }`}
    >
      Auto {autoMode ? 'ON' : 'OFF'}
    </button>
  )
}
