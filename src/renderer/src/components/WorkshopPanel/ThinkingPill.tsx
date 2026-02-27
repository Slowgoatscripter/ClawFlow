import { useState } from 'react'
import { Zap, ChevronDown, ChevronUp } from 'lucide-react'

interface ThinkingPillProps {
  content: string
  duration?: number
  streaming?: boolean
}

export function ThinkingPill({ content, duration, streaming = false }: ThinkingPillProps) {
  const [expanded, setExpanded] = useState(false)

  // Streaming mode: animated pulse
  if (streaming) {
    return (
      <div className="flex items-center gap-1.5 my-2">
        <div
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium animate-pulse"
          style={{
            background: 'var(--color-elevated)',
            border: '1px solid var(--color-border)',
            color: 'var(--color-text-muted)'
          }}
        >
          <Zap
            size={11}
            style={{ color: 'var(--color-accent-cyan)' }}
          />
          <span>Thinking...</span>
        </div>
      </div>
    )
  }

  // Collapsed / expanded mode
  const durationLabel = duration != null ? `Thought for ${duration}s` : 'Thought'

  return (
    <div className="my-2">
      {/* Pill toggle button */}
      <button
        onClick={() => setExpanded((v) => !v)}
        className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium transition-all"
        style={{
          background: 'var(--color-elevated)',
          border: '1px solid var(--color-border)',
          color: 'var(--color-text-muted)'
        }}
      >
        <Zap size={11} style={{ color: 'var(--color-accent-cyan)' }} />
        <span>{durationLabel}</span>
        {expanded ? (
          <ChevronUp size={11} />
        ) : (
          <ChevronDown size={11} />
        )}
      </button>

      {/* Expanded reasoning block */}
      {expanded && content && (
        <div
          className="mt-1.5 ml-3 pl-3 py-2 pr-2 text-xs leading-relaxed rounded-r"
          style={{
            borderLeft: '2px solid var(--color-border)',
            color: 'var(--color-text-muted)',
            background: 'transparent'
          }}
        >
          <p className="whitespace-pre-wrap m-0">{content}</p>
        </div>
      )}
    </div>
  )
}
