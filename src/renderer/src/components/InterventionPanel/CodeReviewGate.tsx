import { useState } from 'react'
import type { Task } from '../../../../shared/types'
import { usePipelineStore } from '../../stores/pipelineStore'
import { useTaskStore } from '../../stores/taskStore'
import { useProjectStore } from '../../stores/projectStore'

interface Props {
  task: Task
}

function scoreColor(score: number): string {
  if (score >= 4) return 'text-accent-green'
  if (score >= 3) return 'text-accent-gold'
  return 'text-accent-red'
}

export function CodeReviewGate({ task }: Props) {
  const [rejecting, setRejecting] = useState(false)
  const [feedback, setFeedback] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const reviewText = task.reviewComments
    ? typeof task.reviewComments === 'string'
      ? task.reviewComments
      : JSON.stringify(task.reviewComments, null, 2)
    : ''

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
    <div className="space-y-4">
      <h3 className="text-xl font-semibold text-accent-gold">Code Review</h3>

      {task.reviewScore !== null && task.reviewScore !== undefined && (
        <div className="flex items-center gap-3">
          <span className={`text-4xl font-bold ${scoreColor(task.reviewScore)}`}>
            {task.reviewScore.toFixed(1)}
          </span>
          <span className="text-sm text-text-muted">/ 5.0</span>
        </div>
      )}

      {reviewText && (
        <pre className="bg-elevated rounded p-4 font-mono text-sm max-h-[400px] overflow-y-auto text-text-secondary whitespace-pre-wrap">
          {reviewText}
        </pre>
      )}

      <div className="flex items-center gap-3">
        <button
          onClick={handleApprove}
          disabled={submitting}
          className="bg-accent-green text-white rounded px-4 py-2 text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
        >
          Approve
        </button>
        <button
          onClick={() => setRejecting(!rejecting)}
          disabled={submitting}
          className="bg-accent-red text-white rounded px-4 py-2 text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
        >
          Reject
        </button>
      </div>

      {rejecting && (
        <div className="space-y-3">
          <textarea
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            placeholder="Provide feedback..."
            className="bg-elevated border border-border rounded text-text-primary w-full min-h-[80px] p-3 text-sm resize-y focus:outline-none focus:border-accent-gold"
          />
          <button
            onClick={handleReject}
            disabled={submitting || !feedback.trim()}
            className="bg-accent-red text-white rounded px-4 py-2 text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            Submit Rejection
          </button>
        </div>
      )}
    </div>
  )
}
