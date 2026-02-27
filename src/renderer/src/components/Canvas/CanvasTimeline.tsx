import { useState } from 'react'
import { useCanvasStore } from '../../stores/canvasStore'

interface CanvasTimelineProps {
  taskId: number
}

const EVENT_COLORS: Record<string, string> = {
  'stage-complete': 'var(--color-accent-green)',
  'file-change': 'var(--color-accent-cyan)',
  'test-result': 'var(--color-accent-amber)',
  'agent-question': 'var(--color-accent-magenta)',
  error: 'var(--color-accent-magenta)'
}

export function CanvasTimeline({ taskId }: CanvasTimelineProps) {
  const events = useCanvasStore((s) => s.timelineEvents[taskId])
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null)

  if (!events || events.length === 0) return null

  const visible = events.slice(-20)

  return (
    <div className="relative mt-1.5 px-1">
      <div className="flex items-center gap-0.5">
        <div
          className="flex-1 h-px"
          style={{ backgroundColor: 'var(--color-border)' }}
        />
      </div>
      <div className="flex items-center gap-0.5 mt-0.5">
        {visible.map((event, i) => (
          <div
            key={event.id}
            className="relative"
            onMouseEnter={() => setHoveredIndex(i)}
            onMouseLeave={() => setHoveredIndex(null)}
          >
            <div
              className="w-1.5 h-1.5 rounded-full cursor-default"
              style={{
                backgroundColor: EVENT_COLORS[event.type] ?? 'var(--color-text-muted)'
              }}
            />
            {hoveredIndex === i && (
              <div
                className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 px-2 py-1 rounded text-xs whitespace-nowrap z-50 pointer-events-none"
                style={{
                  backgroundColor: 'var(--color-elevated)',
                  color: 'var(--color-text-secondary)',
                  border: '1px solid var(--color-border)'
                }}
              >
                {event.summary}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
