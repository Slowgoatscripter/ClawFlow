import type { StreamEvent } from '../../../../shared/types'
import { useTaskStore } from '../../stores/taskStore'
import { useLayoutStore } from '../../stores/layoutStore'

function formatTime(timestamp: string): string {
  const d = new Date(timestamp)
  return d.toLocaleTimeString('en-US', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  })
}

function TypeBadge({ type }: { type: StreamEvent['type'] }) {
  if (type === 'tool_use' || type === 'tool_result') {
    return (
      <span className="inline-flex items-center gap-1 text-xs">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
        </svg>
        <span>tool</span>
      </span>
    )
  }

  return (
    <span className="inline-flex items-center gap-1 text-xs">
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="12"
        height="12"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
      </svg>
      <span>{type}</span>
    </span>
  )
}

export function ActivityEntry({ event }: { event: StreamEvent }) {
  const selectTask = useTaskStore((s) => s.selectTask)
  const setView = useLayoutStore((s) => s.setView)

  const handleClick = () => {
    selectTask(event.taskId)
    setView('task-detail')
  }

  const isToolType = event.type === 'tool_use' || event.type === 'tool_result'
  const isError = event.type === 'error'

  return (
    <button
      onClick={handleClick}
      className="w-full text-left py-2 px-3 hover:bg-elevated cursor-pointer border-b border-border/50 transition-colors"
    >
      <div className="flex items-center gap-2 mb-1">
        <span className="text-xs text-text-muted font-mono">{formatTime(event.timestamp)}</span>
        <span
          className={`text-xs px-1.5 py-0.5 rounded-full ${
            isError
              ? 'bg-accent-red/20 text-accent-red'
              : isToolType
                ? 'bg-accent-teal/20 text-accent-teal'
                : 'bg-accent-mauve/20 text-accent-mauve'
          }`}
        >
          {event.agent}
        </span>
        <span className={isToolType ? 'text-accent-teal' : 'text-text-muted'}>
          <TypeBadge type={event.type} />
        </span>
      </div>
      <p className="text-sm text-text-secondary truncate">{event.content}</p>
    </button>
  )
}
