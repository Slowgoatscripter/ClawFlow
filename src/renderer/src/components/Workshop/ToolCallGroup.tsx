import { useState } from 'react'
import { ChevronRight, ChevronDown } from 'lucide-react'
import { ToolCallCard } from './ToolCallCard'
import type { ToolCallData } from '../../../../shared/types'

const TOOL_STYLES: Record<string, { color: string; bg: string; border: string }> = {
  Read: { color: 'text-accent-cyan', bg: 'bg-accent-cyan/10', border: 'border-accent-cyan/20' },
  Edit: { color: 'text-accent-amber', bg: 'bg-accent-amber/10', border: 'border-accent-amber/20' },
  Write: { color: 'text-accent-amber', bg: 'bg-accent-amber/10', border: 'border-accent-amber/20' },
  Bash: { color: 'text-accent-green', bg: 'bg-accent-green/10', border: 'border-accent-green/20' },
  Grep: { color: 'text-accent-violet', bg: 'bg-accent-violet/10', border: 'border-accent-violet/20' },
  Glob: { color: 'text-accent-violet', bg: 'bg-accent-violet/10', border: 'border-accent-violet/20' },
  WebFetch: { color: 'text-accent-cyan', bg: 'bg-accent-cyan/10', border: 'border-accent-cyan/20' },
  WebSearch: { color: 'text-accent-cyan', bg: 'bg-accent-cyan/10', border: 'border-accent-cyan/20' },
  Task: { color: 'text-text-secondary', bg: 'bg-elevated', border: 'border-border' },
  LS: { color: 'text-accent-cyan', bg: 'bg-accent-cyan/10', border: 'border-accent-cyan/20' },
}

const DEFAULT_STYLE = { color: 'text-text-muted', bg: 'bg-surface', border: 'border-border' }

const TOOL_LABELS: Record<string, string> = {
  Read: 'files read',
  Edit: 'files edited',
  Write: 'files written',
  Bash: 'commands run',
  Grep: 'searches',
  Glob: 'file searches',
  WebFetch: 'pages fetched',
  WebSearch: 'web searches',
  Task: 'tasks delegated',
  LS: 'directories listed',
}

interface ToolCallGroupProps {
  toolName: string
  tools: ToolCallData[]
}

export function ToolCallGroup({ toolName, tools }: ToolCallGroupProps) {
  const [expanded, setExpanded] = useState(false)
  const style = TOOL_STYLES[toolName] || DEFAULT_STYLE
  const label = TOOL_LABELS[toolName] || `${toolName} calls`

  return (
    <div className={`my-1 rounded border ${style.border} ${style.bg}`}>
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-2.5 py-1.5 text-xs hover:bg-white/5 transition-colors"
      >
        {expanded ? (
          <ChevronDown size={12} className={style.color} />
        ) : (
          <ChevronRight size={12} className={style.color} />
        )}
        <span className={`font-medium ${style.color}`}>
          {tools.length} {label}
        </span>
      </button>
      {expanded && (
        <div className="border-t border-white/5 px-1 py-1">
          {tools.map((tool) => (
            <ToolCallCard key={tool.id} tool={tool} />
          ))}
        </div>
      )}
    </div>
  )
}
