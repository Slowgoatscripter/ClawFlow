import type { MouseEvent } from 'react'
import { useWorkshopStore } from '../../stores/workshopStore'

export function ChoicesModal() {
  const choices = useWorkshopStore((s) => s.pendingChoices)
  const selectChoice = useWorkshopStore((s) => s.selectChoice)
  const dismissChoices = useWorkshopStore((s) => s.dismissChoices)

  if (!choices) return null

  const handleOverlay = (e: MouseEvent) => {
    if (e.target === e.currentTarget) dismissChoices()
  }

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
      onClick={handleOverlay}
    >
      <div className="bg-surface border border-border rounded-xl shadow-xl w-[520px] max-h-[80vh] flex flex-col">
        <div className="px-6 py-4 border-b border-border">
          <h2 className="text-base font-semibold text-text">{choices.question}</h2>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          {choices.options.map((option) => (
            <button
              key={option.label}
              onClick={() => selectChoice(option.label)}
              className="w-full text-left px-4 py-3 rounded-lg border border-border bg-bg hover:border-accent-cyan/50 hover:bg-accent-cyan/5 transition-colors cursor-pointer group"
            >
              <div className="text-sm font-medium text-text group-hover:text-accent-cyan transition-colors">
                {option.label}
              </div>
              {option.description && (
                <div className="text-xs text-text-muted mt-1">{option.description}</div>
              )}
            </button>
          ))}
        </div>

        <div className="px-6 py-3 border-t border-border flex justify-end">
          <button
            onClick={dismissChoices}
            className="px-4 py-2 rounded-md text-text-muted hover:text-text transition-colors text-sm cursor-pointer"
          >
            Dismiss
          </button>
        </div>
      </div>
    </div>
  )
}
