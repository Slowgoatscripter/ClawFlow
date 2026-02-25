import { useState } from 'react'
import type { Task } from '../../../../shared/types'
import { CIRCUIT_BREAKER_LIMIT } from '../../../../shared/constants'
import { usePipelineStore } from '../../stores/pipelineStore'
import { useTaskStore } from '../../stores/taskStore'
import { useProjectStore } from '../../stores/projectStore'

interface Props {
  task: Task
}

export function CircuitBreakerPanel({ task }: Props) {
  const [mode, setMode] = useState<'idle' | 'change'>('idle')
  const [newDirection, setNewDirection] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const isPlanTripped = task.planReviewCount >= CIRCUIT_BREAKER_LIMIT
  const rejectionCount = isPlanTripped ? task.planReviewCount : task.implReviewCount
  const rejectionType = isPlanTripped ? 'plan' : 'implementation'

  const refreshTasks = async () => {
    const project = useProjectStore.getState().currentProject
    if (project) {
      await useTaskStore.getState().loadTasks(project.dbPath)
    }
  }

  const handleRetry = async () => {
    setSubmitting(true)
    try {
      const project = useProjectStore.getState().currentProject
      if (!project) return

      // Reset the relevant rejection counter
      const updates = isPlanTripped
        ? { planReviewCount: 0, status: 'planning' }
        : { implReviewCount: 0, status: 'code_review' }

      await useTaskStore.getState().updateTask(project.dbPath, task.id, updates)
      await usePipelineStore.getState().stepPipeline(task.id)
      await refreshTasks()
    } finally {
      setSubmitting(false)
    }
  }

  const handleChangeApproach = async () => {
    if (!newDirection.trim()) return
    setSubmitting(true)
    try {
      const project = useProjectStore.getState().currentProject
      if (!project) return

      // Reset counter so rejection can proceed
      const resetField = isPlanTripped ? { planReviewCount: 0 } : { implReviewCount: 0 }
      await useTaskStore.getState().updateTask(project.dbPath, task.id, {
        ...resetField,
        status: isPlanTripped ? 'planning' : 'code_review'
      })

      await usePipelineStore.getState().rejectStage(task.id, newDirection.trim())
      await refreshTasks()
      setMode('idle')
      setNewDirection('')
    } finally {
      setSubmitting(false)
    }
  }

  const handleForceAdvance = async () => {
    setSubmitting(true)
    try {
      const project = useProjectStore.getState().currentProject
      if (!project) return

      // Move to the next stage, bypassing the gate
      const nextStatus = isPlanTripped ? 'implementing' : 'verifying'
      await useTaskStore.getState().updateTask(project.dbPath, task.id, {
        status: nextStatus
      })
      await refreshTasks()
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="space-y-4">
      <h3 className="text-xl font-semibold text-accent-red flex items-center gap-2">
        <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 20 20">
          <path
            fillRule="evenodd"
            d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z"
            clipRule="evenodd"
          />
        </svg>
        Circuit Breaker Tripped
      </h3>

      <p className="text-sm text-text-secondary">
        The {rejectionType} has been rejected{' '}
        <span className="font-bold text-accent-red">{rejectionCount} times</span>, reaching the
        circuit breaker limit of {CIRCUIT_BREAKER_LIMIT}. The pipeline has been halted to prevent
        infinite loops. Choose how to proceed:
      </p>

      <div className="flex items-center gap-3 flex-wrap">
        <button
          onClick={handleRetry}
          disabled={submitting}
          className="bg-accent-teal text-white rounded px-4 py-2 text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
        >
          Retry
        </button>
        <button
          onClick={() => setMode(mode === 'change' ? 'idle' : 'change')}
          disabled={submitting}
          className="bg-accent-gold text-white rounded px-4 py-2 text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
        >
          Change Approach
        </button>
        <button
          onClick={handleForceAdvance}
          disabled={submitting}
          className="border border-accent-red text-accent-red rounded px-4 py-2 text-sm font-medium hover:bg-accent-red/10 transition-colors disabled:opacity-50"
        >
          Force Advance
        </button>
      </div>

      {mode === 'change' && (
        <div className="space-y-3">
          <textarea
            value={newDirection}
            onChange={(e) => setNewDirection(e.target.value)}
            placeholder="Describe the new direction or approach..."
            className="bg-elevated border border-border rounded text-text-primary w-full min-h-[80px] p-3 text-sm resize-y focus:outline-none focus:border-accent-gold"
          />
          <button
            onClick={handleChangeApproach}
            disabled={submitting || !newDirection.trim()}
            className="bg-accent-gold text-white rounded px-4 py-2 text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            Submit New Direction
          </button>
        </div>
      )}
    </div>
  )
}
