import { useEffect } from 'react'
import { useWorkshopStore } from '../../stores/workshopStore'

export function WorkshopErrorBanner() {
  const error = useWorkshopStore((s) => s.error)
  const clearError = useWorkshopStore((s) => s.clearError)

  useEffect(() => {
    if (!error) return
    const timer = setTimeout(clearError, 8000)
    return () => clearTimeout(timer)
  }, [error, clearError])

  if (!error) return null

  return (
    <div className="mx-4 mt-2 px-4 py-2.5 rounded-lg bg-accent-magenta/10 border border-accent-magenta/30 flex items-center justify-between gap-3 text-sm shrink-0">
      <span className="text-accent-magenta">{error}</span>
      <button
        onClick={clearError}
        className="text-text-muted hover:text-text text-xs shrink-0 transition-colors"
      >
        Dismiss
      </button>
    </div>
  )
}
