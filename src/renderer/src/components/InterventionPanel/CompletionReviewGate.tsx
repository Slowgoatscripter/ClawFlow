import { useState } from 'react'
import type { Task } from '../../../../shared/types'
import { usePipelineStore } from '../../stores/pipelineStore'
import { useTaskStore } from '../../stores/taskStore'
import { useProjectStore } from '../../stores/projectStore'

interface Props {
  task: Task
}

export function CompletionReviewGate({ task }: Props) {
  const [rejecting, setRejecting] = useState(false)
  const [feedback, setFeedback] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const lastHandoff = task.handoffs.length > 0 ? task.handoffs[task.handoffs.length - 1] : null
  const summary = lastHandoff?.summary ?? ''

  const refreshTasks = async () => {
    const project = useProjectStore.getState().currentProject
    if (project) {
      await useTaskStore.getState().loadTasks(project.dbPath)
    }
  }

  const handleApprove = async () => {
    setSubmitting(true)
    try {
      await usePipelineStore.getState().approveStage(task.id)
      await refreshTasks()
    } finally {
      setSubmitting(false)
    }
  }

  const handleReject = async () => {
    if (!feedback.trim()) return
    setSubmitting(true)
    try {
      await usePipelineStore.getState().rejectStage(task.id, feedback.trim())
      await refreshTasks()
      setRejecting(false)
      setFeedback('')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="space-y-4 border-l-4 border-l-accent-green pl-4">
      <h3 className="text-xl font-semibold text-accent-green">Task Complete</h3>

      {summary && (
        <pre className="bg-elevated rounded p-4 font-mono text-sm max-h-[400px] overflow-y-auto text-text-secondary whitespace-pre-wrap">
          {summary}
        </pre>
      )}

      <div className="flex items-center gap-3">
        <button
          onClick={handleApprove}
          disabled={submitting}
          className="bg-accent-green text-white rounded px-4 py-2 text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
        >
          Approve & Close
        </button>
        <button
          onClick={() => setRejecting(!rejecting)}
          disabled={submitting}
          className="bg-accent-magenta text-white rounded px-4 py-2 text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
        >
          Send Back
        </button>
      </div>

      {rejecting && (
        <div className="space-y-3">
          <textarea
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            placeholder="What needs more work?"
            className="bg-elevated border border-border rounded text-text-primary w-full min-h-[80px] p-3 text-sm resize-y focus:outline-none focus:border-accent-green"
          />
          <button
            onClick={handleReject}
            disabled={submitting || !feedback.trim()}
            className="bg-accent-magenta text-white rounded px-4 py-2 text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            Submit
          </button>
        </div>
      )}
    </div>
  )
}
