import { useState } from 'react'
import { useProjectStore } from '../../stores/projectStore'
import { useLayoutStore } from '../../stores/layoutStore'
import { CreateTaskModal } from './CreateTaskModal'

export function TopBar() {
  const currentProject = useProjectStore((s) => s.currentProject)
  const clearCurrentProject = useProjectStore((s) => s.clearCurrentProject)
  const setView = useLayoutStore((s) => s.setView)
  const activityFeedOpen = useLayoutStore((s) => s.activityFeedOpen)
  const toggleActivityFeed = useLayoutStore((s) => s.toggleActivityFeed)
  const [showCreateModal, setShowCreateModal] = useState(false)

  const handleBack = () => {
    clearCurrentProject()
    setView('projects')
  }

  return (
    <>
      <div className="bg-surface border-b border-border px-4 py-3 flex items-center justify-between">
        {/* Left side */}
        <div className="flex items-center gap-3">
          <button
            onClick={handleBack}
            className="text-text-secondary hover:text-text-primary transition-colors cursor-pointer"
            aria-label="Back to projects"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M19 12H5" />
              <path d="m12 19-7-7 7-7" />
            </svg>
          </button>
          <h1 className="text-xl font-semibold text-text-primary">
            {currentProject?.name ?? 'Dashboard'}
          </h1>
        </div>

        {/* Right side */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => useLayoutStore.getState().setView('workshop')}
            className="px-3 py-1.5 rounded-md bg-accent-teal/10 text-accent-teal hover:bg-accent-teal/20 transition-colors text-sm font-medium cursor-pointer"
          >
            Workshop
          </button>
          <button
            onClick={() => useLayoutStore.getState().setView('git')}
            className="px-3 py-1.5 rounded-md bg-accent-teal/10 text-accent-teal hover:bg-accent-teal/20 transition-colors text-sm font-medium cursor-pointer"
          >
            Git
          </button>
          <button
            onClick={toggleActivityFeed}
            className={`transition-colors cursor-pointer p-1 ${
              activityFeedOpen ? 'text-accent-teal' : 'text-text-secondary hover:text-text-primary'
            }`}
            aria-label="Toggle activity feed"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
            </svg>
          </button>
          <button
            onClick={() => setShowCreateModal(true)}
            className="text-text-secondary hover:text-text-primary transition-colors cursor-pointer p-1"
            aria-label="Add task"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M12 5v14" />
              <path d="M5 12h14" />
            </svg>
          </button>
          <button
            className="text-text-secondary hover:text-text-primary transition-colors cursor-pointer p-1"
            aria-label="Settings"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
              <circle cx="12" cy="12" r="3" />
            </svg>
          </button>
        </div>
      </div>
      <CreateTaskModal isOpen={showCreateModal} onClose={() => setShowCreateModal(false)} />
    </>
  )
}
