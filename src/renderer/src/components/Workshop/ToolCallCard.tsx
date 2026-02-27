import { useState } from 'react'
import { ChevronRight, ChevronDown, FileText, Pencil, Terminal, Search, Globe, Users } from 'lucide-react'
import type { ToolCallData } from '../../../../shared/types'

const TOOL_STYLES: Record<string, { color: string; bg: string; border: string; icon: any }> = {
  Read: { color: 'text-accent-cyan', bg: 'bg-accent-cyan/10', border: 'border-accent-cyan/20', icon: FileText },
  Edit: { color: 'text-accent-amber', bg: 'bg-accent-amber/10', border: 'border-accent-amber/20', icon: Pencil },
  Write: { color: 'text-accent-amber', bg: 'bg-accent-amber/10', border: 'border-accent-amber/20', icon: Pencil },
  Bash: { color: 'text-accent-green', bg: 'bg-accent-green/10', border: 'border-accent-green/20', icon: Terminal },
  Grep: { color: 'text-accent-violet', bg: 'bg-accent-violet/10', border: 'border-accent-violet/20', icon: Search },
  Glob: { color: 'text-accent-violet', bg: 'bg-accent-violet/10', border: 'border-accent-violet/20', icon: Search },
  WebFetch: { color: 'text-accent-cyan', bg: 'bg-accent-cyan/10', border: 'border-accent-cyan/20', icon: Globe },
  WebSearch: { color: 'text-accent-cyan', bg: 'bg-accent-cyan/10', border: 'border-accent-cyan/20', icon: Globe },
  Task: { color: 'text-text-secondary', bg: 'bg-elevated', border: 'border-border', icon: Users },
  LS: { color: 'text-accent-cyan', bg: 'bg-accent-cyan/10', border: 'border-accent-cyan/20', icon: FileText },
}

const DEFAULT_STYLE = { color: 'text-text-muted', bg: 'bg-surface', border: 'border-border', icon: Terminal }

function getToolContext(tool: ToolCallData): string {
  const input = tool.toolInput
  if (!input || typeof input !== 'object') return ''
  if (input.file_path) return String(input.file_path).split('/').slice(-2).join('/')
  if (input.path) return String(input.path).split('/').slice(-2).join('/')
  if (input.pattern) return String(input.pattern)
  if (input.command) return String(input.command).slice(0, 40)
  if (input.query) return String(input.query).slice(0, 40)
  if (input.url) return String(input.url).slice(0, 40)
  return ''
}

interface ToolCallCardProps {
  tool: ToolCallData
}

export function ToolCallCard({ tool }: ToolCallCardProps) {
  const [expanded, setExpanded] = useState(false)
  const style = TOOL_STYLES[tool.toolName] || DEFAULT_STYLE
  const Icon = style.icon
  const context = getToolContext(tool)

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
        <Icon size={12} className={style.color} />
        <span className={`font-medium ${style.color}`}>{tool.toolName}</span>
        {context && (
          <span className="text-text-muted/60 font-mono truncate">{context}</span>
        )}
      </button>
      {expanded && (
        <div className="px-3 py-2 border-t border-white/5 text-xs font-mono text-text-muted/80 max-h-32 overflow-y-auto">
          {tool.toolInput ? (
            <pre className="whitespace-pre-wrap">{(() => {
              try { return JSON.stringify(tool.toolInput, null, 2) }
              catch { return '[Unable to display input]' }
            })()}</pre>
          ) : (
            <span className="text-text-muted/40 italic">Tool executed</span>
          )}
        </div>
      )}
    </div>
  )
}
