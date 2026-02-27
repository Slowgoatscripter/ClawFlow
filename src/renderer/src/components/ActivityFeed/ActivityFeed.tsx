import { useState, useEffect, useRef } from 'react'
import { usePipelineStore } from '../../stores/pipelineStore'
import { useLayoutStore } from '../../stores/layoutStore'
import { ActivityEntry } from './ActivityEntry'
import type { StreamEvent } from '../../../../shared/types'

type FilterType = 'all' | 'text' | 'tools' | 'errors'

function matchesFilter(event: StreamEvent, filter: FilterType): boolean {
  switch (filter) {
    case 'text':
      return event.type === 'text'
    case 'tools':
      return event.type === 'tool_use' || event.type === 'tool_result'
    case 'errors':
      return event.type === 'error'
    default:
      return true
  }
}

export function ActivityFeed() {
  const streamEvents = usePipelineStore((s) => s.streamEvents)
  const toggleActivityFeed = useLayoutStore((s) => s.toggleActivityFeed)
  const [filter, setFilter] = useState<FilterType>('all')
  const scrollRef = useRef<HTMLDivElement>(null)
  const prevCountRef = useRef(0)

  const filtered = streamEvents
    .filter((e) => matchesFilter(e, filter))
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())

  // Auto-scroll to top when new events arrive
  useEffect(() => {
    if (streamEvents.length > prevCountRef.current && scrollRef.current) {
      scrollRef.current.scrollTop = 0
    }
    prevCountRef.current = streamEvents.length
  }, [streamEvents.length])

  const filters: { label: string; value: FilterType }[] = [
    { label: 'All', value: 'all' },
    { label: 'Text', value: 'text' },
    { label: 'Tools', value: 'tools' },
    { label: 'Errors', value: 'errors' }
  ]

  return (
    <div className="w-80 bg-surface/60 backdrop-blur-lg border-l border-border flex flex-col h-full shrink-0">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <h2 className="font-semibold text-text-primary">Activity</h2>
        <button
          onClick={toggleActivityFeed}
          className="text-text-muted hover:text-text-primary transition-colors cursor-pointer p-1"
          aria-label="Close activity feed"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M18 6 6 18" />
            <path d="m6 6 12 12" />
          </svg>
        </button>
      </div>

      {/* Filter chips */}
      <div className="flex items-center gap-1.5 px-4 py-2 border-b border-border/50">
        {filters.map((f) => (
          <button
            key={f.value}
            onClick={() => setFilter(f.value)}
            className={`text-xs px-2.5 py-1 rounded-full transition-colors cursor-pointer ${
              filter === f.value
                ? 'bg-accent-cyan/20 text-accent-cyan'
                : 'bg-elevated text-text-muted hover:text-text-secondary'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Event list */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        {filtered.length === 0 ? (
          <div className="flex items-center justify-center h-32 text-text-muted text-sm">
            No activity yet
          </div>
        ) : (
          filtered.map((event, i) => <ActivityEntry key={`${event.taskId}-${event.timestamp}-${i}`} event={event} />)
        )}
      </div>
    </div>
  )
}
