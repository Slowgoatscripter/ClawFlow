import { useState, useRef, useEffect } from 'react'
import { useWorkshopStore } from '../../stores/workshopStore'
import { useProjectStore } from '../../stores/projectStore'
import type { WorkshopSession } from '../../../../shared/types'

export function SessionList() {
  const sessions = useWorkshopStore((s) => s.sessions)
  const currentSessionId = useWorkshopStore((s) => s.currentSessionId)
  const isStreaming = useWorkshopStore((s) => s.isStreaming)
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

  const handleStopSession = (e: React.MouseEvent, sessionId: string) => {
    e.stopPropagation()
    useWorkshopStore.getState().stopSession(sessionId)
  }

  const handleDeleteSession = (e: React.MouseEvent, sessionId: string) => {
    e.stopPropagation()
    useWorkshopStore.getState().deleteSession(sessionId)
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
            isStreamingHere={isStreaming && session.id === currentSessionId}
            onClick={() => handleSelectSession(session.id)}
            onStop={(e) => handleStopSession(e, session.id)}
            onDelete={(e) => handleDeleteSession(e, session.id)}
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
  isStreamingHere,
  onClick,
  onStop,
  onDelete,
}: {
  session: WorkshopSession
  isActive: boolean
  isStreamingHere: boolean
  onClick: () => void
  onStop: (e: React.MouseEvent) => void
  onDelete: (e: React.MouseEvent) => void
}) {
  const [isEditing, setIsEditing] = useState(false)
  const [editTitle, setEditTitle] = useState(session.title)
  const inputRef = useRef<HTMLInputElement>(null)
  const date = new Date(session.createdAt)
  const timeStr = date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [isEditing])

  useEffect(() => {
    if (!isEditing) setEditTitle(session.title)
  }, [session.title, isEditing])

  const handleDoubleClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    setIsEditing(true)
  }

  const handleSave = () => {
    const trimmed = editTitle.trim()
    if (trimmed && trimmed !== session.title) {
      useWorkshopStore.getState().renameSession(session.id, trimmed)
    } else {
      setEditTitle(session.title)
    }
    setIsEditing(false)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      handleSave()
    } else if (e.key === 'Escape') {
      setEditTitle(session.title)
      setIsEditing(false)
    }
  }

  return (
    <button
      onClick={onClick}
      className={`group w-full text-left px-3 py-3 border-b border-border/50 transition-colors ${
        isActive ? 'bg-accent-teal/10 border-l-2 border-l-accent-teal' : 'hover:bg-surface'
      }`}
    >
      <div className="flex items-center justify-between">
        {isEditing ? (
          <input
            ref={inputRef}
            value={editTitle}
            onChange={(e) => setEditTitle(e.target.value)}
            onBlur={handleSave}
            onKeyDown={handleKeyDown}
            onClick={(e) => e.stopPropagation()}
            className="text-sm font-medium flex-1 bg-surface border border-accent-teal rounded px-1.5 py-0.5 text-text focus:outline-none"
          />
        ) : (
          <span
            onDoubleClick={handleDoubleClick}
            className={`text-sm font-medium truncate flex-1 ${isActive ? 'text-accent-teal' : 'text-text'}`}
            title="Double-click to rename"
          >
            {isStreamingHere && (
              <span className="inline-block w-2 h-2 rounded-full bg-accent-teal animate-pulse mr-1.5 align-middle" />
            )}
            {session.title}
          </span>
        )}
        <div className="flex items-center gap-1 ml-1 shrink-0">
          {isStreamingHere && (
            <span
              onClick={onStop}
              title="Stop generation"
              className="p-0.5 rounded hover:bg-red-500/20 text-text-muted hover:text-red-400 transition-colors"
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                <rect x="3" y="3" width="10" height="10" rx="1" />
              </svg>
            </span>
          )}
          {!isStreamingHere && (
            <span
              onClick={onDelete}
              title="Delete session"
              className="p-0.5 rounded hover:bg-red-500/20 text-text-muted hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all"
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M5 4V3a1 1 0 011-1h4a1 1 0 011 1v1M2 4h12M6 7v5M10 7v5M3 4l1 9a1 1 0 001 1h6a1 1 0 001-1l1-9" />
              </svg>
            </span>
          )}
          {session.status === 'ended' && (
            <span className="text-xs text-text-muted">ended</span>
          )}
        </div>
      </div>
      <p className="text-xs text-text-muted mt-1">{timeStr}</p>
      {session.summary && (
        <p className="text-xs text-text-muted mt-1 truncate">{session.summary}</p>
      )}
    </button>
  )
}
