import { useWorkshopStore } from '../../stores/workshopStore'
import { useProjectStore } from '../../stores/projectStore'
import type { WorkshopSession } from '../../../../shared/types'

export function SessionList() {
  const sessions = useWorkshopStore((s) => s.sessions)
  const currentSessionId = useWorkshopStore((s) => s.currentSessionId)
  const currentProject = useProjectStore((s) => s.currentProject)

  const handleNewSession = async () => {
    if (!currentProject) return
    await useWorkshopStore.getState().startSession(
      currentProject.dbPath,
      currentProject.path,
      currentProject.name,
      currentProject.name
    )
  }

  const handleSelectSession = async (sessionId: string) => {
    if (!currentProject) return
    await useWorkshopStore.getState().selectSession(currentProject.dbPath, sessionId)
  }

  return (
    <div className="w-64 border-r border-border flex flex-col bg-surface/50">
      <div className="p-3 border-b border-border">
        <button
          onClick={handleNewSession}
          className="w-full px-3 py-2 rounded-md bg-accent-teal text-bg text-sm font-medium hover:bg-accent-teal/90 transition-colors"
        >
          New Session
        </button>
      </div>
      <div className="flex-1 overflow-y-auto">
        {sessions.map((session) => (
          <SessionItem
            key={session.id}
            session={session}
            isActive={session.id === currentSessionId}
            onClick={() => handleSelectSession(session.id)}
          />
        ))}
        {sessions.length === 0 && (
          <p className="p-4 text-text-muted text-sm text-center">
            No sessions yet. Start one to begin collaborating.
          </p>
        )}
      </div>
    </div>
  )
}

function SessionItem({
  session,
  isActive,
  onClick,
}: {
  session: WorkshopSession
  isActive: boolean
  onClick: () => void
}) {
  const date = new Date(session.createdAt)
  const timeStr = date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })

  return (
    <button
      onClick={onClick}
      className={`w-full text-left px-3 py-3 border-b border-border/50 transition-colors ${
        isActive ? 'bg-accent-teal/10 border-l-2 border-l-accent-teal' : 'hover:bg-surface'
      }`}
    >
      <div className="flex items-center justify-between">
        <span className={`text-sm font-medium truncate ${isActive ? 'text-accent-teal' : 'text-text'}`}>
          {session.title}
        </span>
        {session.status === 'ended' && (
          <span className="text-xs text-text-muted ml-1">ended</span>
        )}
      </div>
      <p className="text-xs text-text-muted mt-1">{timeStr}</p>
      {session.summary && (
        <p className="text-xs text-text-muted mt-1 truncate">{session.summary}</p>
      )}
    </button>
  )
}
