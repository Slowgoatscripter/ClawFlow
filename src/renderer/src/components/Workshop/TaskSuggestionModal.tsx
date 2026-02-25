import { useState } from 'react'
import type { MouseEvent } from 'react'
import { useWorkshopStore } from '../../stores/workshopStore'
import type { WorkshopSuggestedTask } from '../../../../shared/types'
import type { Tier, Priority } from '../../../../shared/types'

const TIERS: { value: Tier; label: string }[] = [
  { value: 'L1', label: 'L1 Quick' },
  { value: 'L2', label: 'L2 Standard' },
  { value: 'L3', label: 'L3 Full' }
]

const tierActiveColors: Record<Tier, string> = {
  L1: 'bg-accent-green/20 text-accent-green border-accent-green',
  L2: 'bg-accent-teal/20 text-accent-teal border-accent-teal',
  L3: 'bg-accent-mauve/20 text-accent-mauve border-accent-mauve'
}

const PRIORITIES: { value: Priority; label: string }[] = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'critical', label: 'Critical' }
]

const priorityActiveColors: Record<Priority, string> = {
  low: 'bg-text-muted/20 text-text-muted border-text-muted',
  medium: 'bg-accent-teal/20 text-accent-teal border-accent-teal',
  high: 'bg-accent-peach/20 text-accent-peach border-accent-peach',
  critical: 'bg-accent-red/20 text-accent-red border-accent-red'
}

const inactiveBtn = 'border border-border text-text-secondary hover:text-text-primary'

export function TaskSuggestionModal() {
  const suggestions = useWorkshopStore((s) => s.pendingSuggestions)
  const sessionId = useWorkshopStore((s) => s.suggestionsSessionId)
  const [tasks, setTasks] = useState<WorkshopSuggestedTask[]>(suggestions ?? [])
  const [autoMode, setAutoMode] = useState(false)

  if (!suggestions || !sessionId) return null

  const handleOverlay = (e: MouseEvent) => {
    if (e.target === e.currentTarget) handleDismiss()
  }

  const handleApprove = async () => {
    const tasksWithDefaults = tasks.map((t) => ({
      ...t,
      priority: t.priority ?? ('medium' as Priority)
    }))
    await useWorkshopStore.getState().approveSuggestions(sessionId, tasksWithDefaults, autoMode)
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
      <div className="bg-surface border border-border rounded-xl shadow-xl w-[640px] max-h-[80vh] flex flex-col">
        <div className="px-6 py-4 border-b border-border">
          <h2 className="text-lg font-semibold text-text">Create Pipeline Tasks</h2>
          <p className="text-sm text-text-muted mt-1">
            Claude suggests {tasks.length} task{tasks.length !== 1 ? 's' : ''} based on your
            conversation
          </p>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {tasks.map((task, index) => (
            <div key={index} className="bg-bg rounded-lg border border-border p-4 space-y-3">
              {/* Title + Remove */}
              <div className="flex items-start justify-between gap-2">
                <input
                  value={task.title}
                  onChange={(e) => handleUpdateTask(index, { title: e.target.value })}
                  className="flex-1 bg-transparent text-text font-medium text-sm focus:outline-none"
                />
                <button
                  onClick={() => handleRemoveTask(index)}
                  className="text-text-muted hover:text-red-400 transition-colors text-xs shrink-0"
                >
                  Remove
                </button>
              </div>

              {/* Description */}
              <textarea
                value={task.description}
                onChange={(e) => handleUpdateTask(index, { description: e.target.value })}
                className="w-full bg-transparent text-text-muted text-sm resize-none focus:outline-none"
                rows={4}
              />

              {/* Tier */}
              <div>
                <label className="text-[10px] text-text-muted mb-1 block uppercase tracking-wide">
                  Tier
                </label>
                <div className="flex gap-1.5">
                  {TIERS.map((t) => (
                    <button
                      key={t.value}
                      onClick={() => handleUpdateTask(index, { tier: t.value })}
                      className={`text-[10px] font-medium px-2.5 py-1 rounded border transition-colors cursor-pointer ${
                        task.tier === t.value ? tierActiveColors[t.value] : inactiveBtn
                      }`}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Priority */}
              <div>
                <label className="text-[10px] text-text-muted mb-1 block uppercase tracking-wide">
                  Priority
                </label>
                <div className="flex gap-1.5">
                  {PRIORITIES.map((p) => (
                    <button
                      key={p.value}
                      onClick={() => handleUpdateTask(index, { priority: p.value })}
                      className={`text-[10px] font-medium px-2.5 py-1 rounded border transition-colors cursor-pointer ${
                        (task.priority ?? 'medium') === p.value
                          ? priorityActiveColors[p.value]
                          : inactiveBtn
                      }`}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="px-6 py-4 border-t border-border flex items-center justify-between">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={autoMode}
              onChange={(e) => setAutoMode(e.target.checked)}
              className="accent-accent-teal w-3.5 h-3.5"
            />
            <span className="text-xs text-text-secondary">Auto Mode</span>
          </label>

          <div className="flex gap-3">
            <button
              onClick={handleDismiss}
              className="px-4 py-2 rounded-md text-text-muted hover:text-text transition-colors text-sm cursor-pointer"
            >
              Dismiss
            </button>
            <button
              onClick={handleApprove}
              disabled={tasks.length === 0}
              className="px-4 py-2 rounded-md bg-accent-teal text-bg font-medium text-sm hover:bg-accent-teal/90 disabled:opacity-50 transition-colors cursor-pointer"
            >
              Create {tasks.length} Task{tasks.length !== 1 ? 's' : ''}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
