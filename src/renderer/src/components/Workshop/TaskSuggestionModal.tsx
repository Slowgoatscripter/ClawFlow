import { useState } from 'react'
import type { MouseEvent } from 'react'
import { useWorkshopStore } from '../../stores/workshopStore'
import type { WorkshopSuggestedTask } from '../../../../shared/types'

export function TaskSuggestionModal() {
  const suggestions = useWorkshopStore((s) => s.pendingSuggestions)
  const sessionId = useWorkshopStore((s) => s.suggestionsSessionId)
  const [tasks, setTasks] = useState<WorkshopSuggestedTask[]>(suggestions ?? [])

  if (!suggestions || !sessionId) return null

  const handleOverlay = (e: MouseEvent) => {
    if (e.target === e.currentTarget) handleDismiss()
  }

  const handleApprove = async () => {
    await useWorkshopStore.getState().approveSuggestions(sessionId, tasks)
  }

  const handleDismiss = () => {
    useWorkshopStore.getState().dismissSuggestions()
  }

  const handleUpdateTask = (index: number, updates: Partial<WorkshopSuggestedTask>) => {
    setTasks((prev) => prev.map((t, i) => (i === index ? { ...t, ...updates } : t)))
  }

  const handleRemoveTask = (index: number) => {
    setTasks((prev) => prev.filter((_, i) => i !== index))
  }

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
      onClick={handleOverlay}
    >
      <div className="bg-surface border border-border rounded-xl shadow-xl w-[600px] max-h-[80vh] flex flex-col">
        <div className="px-6 py-4 border-b border-border">
          <h2 className="text-lg font-semibold text-text">Create Pipeline Tasks</h2>
          <p className="text-sm text-text-muted mt-1">
            Claude suggests {tasks.length} task{tasks.length !== 1 ? 's' : ''} based on your
            conversation
          </p>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {tasks.map((task, index) => (
            <div key={index} className="bg-bg rounded-lg border border-border p-4">
              <div className="flex items-start justify-between gap-2">
                <input
                  value={task.title}
                  onChange={(e) => handleUpdateTask(index, { title: e.target.value })}
                  className="flex-1 bg-transparent text-text font-medium text-sm focus:outline-none"
                />
                <div className="flex items-center gap-2">
                  <select
                    value={task.tier}
                    onChange={(e) =>
                      handleUpdateTask(index, { tier: e.target.value as 'L1' | 'L2' | 'L3' })
                    }
                    className="bg-surface border border-border rounded px-2 py-1 text-xs text-text"
                  >
                    <option value="L1">L1</option>
                    <option value="L2">L2</option>
                    <option value="L3">L3</option>
                  </select>
                  <button
                    onClick={() => handleRemoveTask(index)}
                    className="text-text-muted hover:text-red-400 transition-colors text-sm"
                  >
                    Remove
                  </button>
                </div>
              </div>
              <textarea
                value={task.description}
                onChange={(e) => handleUpdateTask(index, { description: e.target.value })}
                className="w-full mt-2 bg-transparent text-text-muted text-sm resize-none focus:outline-none"
                rows={2}
              />
            </div>
          ))}
        </div>

        <div className="px-6 py-4 border-t border-border flex justify-end gap-3">
          <button
            onClick={handleDismiss}
            className="px-4 py-2 rounded-md text-text-muted hover:text-text transition-colors text-sm"
          >
            Dismiss
          </button>
          <button
            onClick={handleApprove}
            disabled={tasks.length === 0}
            className="px-4 py-2 rounded-md bg-accent-teal text-bg font-medium text-sm hover:bg-accent-teal/90 disabled:opacity-50 transition-colors"
          >
            Create {tasks.length} Task{tasks.length !== 1 ? 's' : ''}
          </button>
        </div>
      </div>
    </div>
  )
}
