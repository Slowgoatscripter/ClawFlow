import { useState } from 'react'
import type { Task } from '../../../../shared/types'
import { usePipelineStore } from '../../stores/pipelineStore'
import { useTaskStore } from '../../stores/taskStore'
import { useProjectStore } from '../../stores/projectStore'

interface Props {
  task: Task
}

export function OpenQuestionsPanel({ task }: Props) {
  const [response, setResponse] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const lastHandoff = task.handoffs.length > 0 ? task.handoffs[task.handoffs.length - 1] : null
  const questions = lastHandoff?.openQuestions ?? ''

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
      await usePipelineStore.getState().rejectStage(task.id, response.trim())
      await refreshTasks()
      setResponse('')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="space-y-4">
      <h3 className="text-xl font-semibold text-accent-teal">Agent Has Questions</h3>

      <pre className="bg-elevated rounded p-4 font-mono text-sm max-h-[400px] overflow-y-auto text-text-secondary whitespace-pre-wrap">
        {questions}
      </pre>

      <textarea
        value={response}
        onChange={(e) => setResponse(e.target.value)}
        placeholder="Provide your response to the agent's questions..."
        className="bg-elevated border border-border rounded text-text-primary w-full min-h-[80px] p-3 text-sm resize-y focus:outline-none focus:border-accent-teal"
      />

      <button
        onClick={handleSubmit}
        disabled={submitting || !response.trim()}
        className="bg-accent-teal text-white rounded px-4 py-2 text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
      >
        Submit Response
      </button>
    </div>
  )
}
