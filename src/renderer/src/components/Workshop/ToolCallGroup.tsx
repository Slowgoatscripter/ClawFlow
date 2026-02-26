import { useState } from 'react'
import { ChevronRight, ChevronDown } from 'lucide-react'
import { ToolCallCard } from './ToolCallCard'
import type { ToolCallData } from '../../../../shared/types'

const TOOL_STYLES: Record<string, { color: string; bg: string; border: string }> = {
  Read: { color: 'text-blue-400', bg: 'bg-blue-500/10', border: 'border-blue-500/20' },
  Edit: { color: 'text-amber-400', bg: 'bg-amber-500/10', border: 'border-amber-500/20' },
  Write: { color: 'text-amber-400', bg: 'bg-amber-500/10', border: 'border-amber-500/20' },
  Bash: { color: 'text-green-400', bg: 'bg-green-500/10', border: 'border-green-500/20' },
  Grep: { color: 'text-violet-400', bg: 'bg-violet-500/10', border: 'border-violet-500/20' },
  Glob: { color: 'text-violet-400', bg: 'bg-violet-500/10', border: 'border-violet-500/20' },
  WebFetch: { color: 'text-cyan-400', bg: 'bg-cyan-500/10', border: 'border-cyan-500/20' },
  WebSearch: { color: 'text-cyan-400', bg: 'bg-cyan-500/10', border: 'border-cyan-500/20' },
  Task: { color: 'text-slate-400', bg: 'bg-slate-500/10', border: 'border-slate-500/20' },
  LS: { color: 'text-blue-400', bg: 'bg-blue-500/10', border: 'border-blue-500/20' },
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
