import { useState, useRef, useEffect } from 'react'
import { MessageSquare } from 'lucide-react'
import type { Task, WorkshopSession } from '../../../../shared/types'
import { usePipelineStore } from '../../stores/pipelineStore'
import { useTaskStore } from '../../stores/taskStore'
import { useProjectStore } from '../../stores/projectStore'
import { useWorkshopStore } from '../../stores/workshopStore'

interface Props {
  task: Task
}

export function OpenQuestionsPanel({ task }: Props) {
  const [response, setResponse] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [showSessionPicker, setShowSessionPicker] = useState(false)
  const [sendingToWorkshop, setSendingToWorkshop] = useState(false)
  const [activeSessions, setActiveSessions] = useState<WorkshopSession[]>([])
  const pickerRef = useRef<HTMLDivElement>(null)

  const lastHandoff = task.handoffs.length > 0 ? task.handoffs[task.handoffs.length - 1] : null
  const questions = lastHandoff?.openQuestions ?? ''

  // Close picker on outside click
  useEffect(() => {
    if (!showSessionPicker) return
    const handler = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setShowSessionPicker(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [showSessionPicker])

  const refreshTasks = async () => {
    const project = useProjectStore.getState().currentProject
    if (project) {
      await useTaskStore.getState().loadTasks(project.dbPath)
    }
  }

  const handleSubmit = async () => {
    if (!response.trim()) return
    setSubmitting(true)
    try {
      await usePipelineStore.getState().respondToQuestions(task.id, response.trim())
      await refreshTasks()
      setResponse('')
    } finally {
      setSubmitting(false)
    }
  }

  const handleTogglePicker = () => {
    if (!showSessionPicker) {
      // Snapshot sessions on open — avoids subscribing to workshop store updates
      const sessions = useWorkshopStore.getState().sessions
      setActiveSessions(sessions.filter((s) => s.status === 'active'))
    }
    setShowSessionPicker(!showSessionPicker)
  }

  const handleSendToWorkshop = async (sessionId: string | null) => {
    setSendingToWorkshop(true)
    setShowSessionPicker(false)
    try {
      const project = useProjectStore.getState().currentProject
      if (!project) return

      const questionText = `**Agent Questions (Task #${task.id}: ${task.title})**\n\n${questions}`

      if (sessionId) {
        // Send to existing session
        await useWorkshopStore.getState().sendMessage(sessionId, questionText)
        await useWorkshopStore.getState().selectSession(project.dbPath, sessionId)
      } else {
        // Create new session then send
        await useWorkshopStore.getState().startSession(
          project.dbPath,
          project.path,
          project.name,
          project.name,
          `Questions: ${task.title}`
        )
        const newSessionId = useWorkshopStore.getState().currentSessionId
        if (newSessionId) {
          await useWorkshopStore.getState().sendMessage(newSessionId, questionText)
        }
      }
    } finally {
      setSendingToWorkshop(false)
    }
  }

  return (
    <div className="space-y-4 border-l-4 border-l-accent-cyan pl-4">
      <h3 className="text-xl font-semibold text-accent-cyan">Agent Has Questions</h3>

      <pre className="bg-elevated rounded p-4 font-mono text-sm max-h-[400px] overflow-y-auto text-text-secondary whitespace-pre-wrap">
        {questions}
      </pre>

      <textarea
        value={response}
        onChange={(e) => setResponse(e.target.value)}
        placeholder="Provide your response to the agent's questions..."
        className="bg-elevated border border-border rounded text-text-primary w-full min-h-[80px] p-3 text-sm resize-y focus:outline-none focus:border-accent-cyan"
      />

      <div className="flex items-center gap-2">
        <button
          onClick={handleSubmit}
          disabled={submitting || !response.trim()}
          className="bg-accent-cyan text-white rounded px-4 py-2 text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
        >
          Submit Response
        </button>

        <div className="relative" ref={pickerRef}>
          <button
            onClick={handleTogglePicker}
            disabled={sendingToWorkshop}
            className="flex items-center gap-1.5 rounded px-3 py-2 text-sm font-medium transition-opacity hover:opacity-90 disabled:opacity-50"
            style={{
              color: 'var(--color-accent-violet)',
              backgroundColor: 'color-mix(in srgb, var(--color-accent-violet) 12%, transparent)',
              border: '1px solid color-mix(in srgb, var(--color-accent-violet) 30%, transparent)',
            }}
          >
            <MessageSquare size={14} />
            {sendingToWorkshop ? 'Sending...' : 'Send to Workshop'}
          </button>

          {showSessionPicker && (
            <div
              className="absolute bottom-full mb-1 left-0 min-w-[220px] rounded-lg py-1 z-50 shadow-lg"
              style={{
                backgroundColor: 'var(--color-elevated)',
                border: '1px solid var(--color-border)',
              }}
            >
              <button
                onClick={() => handleSendToWorkshop(null)}
                className="w-full text-left px-3 py-2 text-sm font-medium transition-colors hover:bg-white/5"
                style={{ color: 'var(--color-accent-green)' }}
              >
                + New Session
              </button>
              {activeSessions.length > 0 && (
                <div
                  className="border-t my-1"
                  style={{ borderColor: 'var(--color-border)' }}
                />
              )}
              {activeSessions.map((session) => (
                <button
                  key={session.id}
                  onClick={() => handleSendToWorkshop(session.id)}
                  className="w-full text-left px-3 py-2 text-sm truncate transition-colors hover:bg-white/5"
                  style={{ color: 'var(--color-text-primary)' }}
                >
                  {session.title}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
