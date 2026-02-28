import { useState } from 'react'
import { FileText, Search, Check, Terminal, ChevronDown, ChevronUp, HelpCircle, Zap, ClipboardList, ClipboardCheck, GitBranch, ListPlus, ListChecks, ListTodo, List, FileSearch, Users, UserMinus, Send, FileOutput, Square } from 'lucide-react'
import type { ToolCallData } from '../../../../shared/types'

// Tool-specific icon mapping (mirrors ToolCallCard but uses Check for test-like tools)
const TOOL_ICONS: Record<string, React.ElementType> = {
  Read: FileText,
  LS: FileText,
  Glob: Search,
  Grep: Search,
  WebSearch: Search,
  WebFetch: Search,
  Edit: Terminal,
  Write: Terminal,
  Bash: Terminal,
  Task: Terminal,
  AskUserQuestion: HelpCircle,
  Skill: Zap,
  EnterPlanMode: ClipboardList,
  ExitPlanMode: ClipboardCheck,
  EnterWorktree: GitBranch,
  TaskCreate: ListPlus,
  TaskUpdate: ListChecks,
  TodoWrite: ListTodo,
  TaskList: List,
  TaskGet: FileSearch,
  TeamCreate: Users,
  TeamDelete: UserMinus,
  SendMessage: Send,
  TaskOutput: FileOutput,
  TaskStop: Square,
}

const TOOL_COLORS: Record<string, string> = {
  Read: 'var(--color-accent-cyan)',
  LS: 'var(--color-accent-cyan)',
  Glob: 'var(--color-accent-violet)',
  Grep: 'var(--color-accent-violet)',
  WebSearch: 'var(--color-accent-cyan)',
  WebFetch: 'var(--color-accent-cyan)',
  Edit: 'var(--color-accent-amber)',
  Write: 'var(--color-accent-amber)',
  Bash: 'var(--color-accent-green)',
  Task: 'var(--color-text-secondary)',
  AskUserQuestion: 'var(--color-accent-amber)',
  Skill: 'var(--color-accent-cyan)',
  EnterPlanMode: 'var(--color-accent-violet)',
  ExitPlanMode: 'var(--color-accent-violet)',
  EnterWorktree: 'var(--color-accent-green)',
  TaskCreate: 'var(--color-text-secondary)',
  TaskUpdate: 'var(--color-text-secondary)',
  TodoWrite: 'var(--color-text-secondary)',
  TaskList: 'var(--color-text-secondary)',
  TaskGet: 'var(--color-text-secondary)',
  TeamCreate: 'var(--color-text-secondary)',
  TeamDelete: 'var(--color-text-secondary)',
  SendMessage: 'var(--color-text-secondary)',
  TaskOutput: 'var(--color-text-secondary)',
  TaskStop: 'var(--color-text-secondary)',
}

function getIcon(toolName: string): React.ElementType {
  return TOOL_ICONS[toolName] ?? Terminal
}

function getColor(toolName: string): string {
  return TOOL_COLORS[toolName] ?? 'var(--color-text-muted)'
}

function getContext(tool: ToolCallData): string {
  const input = tool.toolInput
  if (!input || typeof input !== 'object') return ''
  if (input.questions) return (input.questions as any[])[0]?.question?.slice(0, 60) || ''
  if (input.skill) return String(input.skill)
  if (input.subject) return String(input.subject)
  if (input.recipient) return String(input.recipient)
  if (input.file_path) return String(input.file_path).split('/').slice(-2).join('/')
  if (input.path) return String(input.path).split('/').slice(-2).join('/')
  if (input.pattern) return String(input.pattern).slice(0, 35)
  if (input.command) return String(input.command).slice(0, 35)
  if (input.query) return String(input.query).slice(0, 35)
  if (input.url) return String(input.url).slice(0, 35)
  return ''
}

// ── Individual chip ────────────────────────────────────────────────────────

interface SingleChipProps {
  tool: ToolCallData
}

function SingleChip({ tool }: SingleChipProps) {
  const [expanded, setExpanded] = useState(false)
  const Icon = getIcon(tool.toolName)
  const color = getColor(tool.toolName)
  const context = getContext(tool)

  return (
    <div className="inline-flex flex-col">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium transition-all"
        style={{
          background: 'var(--color-elevated)',
          border: '1px solid var(--color-border)',
          color: 'var(--color-text-muted)'
        }}
        title={`${tool.toolName}${context ? ': ' + context : ''}`}
      >
        <Icon size={10} style={{ color, flexShrink: 0 }} />
        <span style={{ color }}>{tool.toolName}</span>
        {context && (
          <span
            className="font-mono truncate max-w-[120px]"
            style={{ color: 'var(--color-text-muted)', opacity: 0.7 }}
          >
            {context}
          </span>
        )}
        {expanded ? <ChevronUp size={9} /> : <ChevronDown size={9} />}
      </button>

      {expanded && tool.toolInput && (
        <div
          className="mt-1 px-2 py-1.5 rounded text-[10px] font-mono max-h-24 overflow-y-auto"
          style={{
            background: 'var(--color-bg)',
            border: '1px solid var(--color-border)',
            color: 'var(--color-text-muted)'
          }}
        >
          <pre className="whitespace-pre-wrap m-0">
            {(() => {
              try { return JSON.stringify(tool.toolInput, null, 2) }
              catch { return '[Unable to display]' }
            })()}
          </pre>
        </div>
      )}
    </div>
  )
}

// ── Grouped chip (5+ tool calls) ──────────────────────────────────────────

interface GroupedChipProps {
  tools: ToolCallData[]
}

function GroupedChip({ tools }: GroupedChipProps) {
  const [expanded, setExpanded] = useState(false)

  // Use the most common tool name as label
  const firstName = tools[0]?.toolName ?? 'actions'
  const color = getColor(firstName)
  const Icon = getIcon(firstName)

  return (
    <div className="inline-flex flex-col gap-1">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium transition-all"
        style={{
          background: 'var(--color-elevated)',
          border: '1px solid var(--color-border)',
          color: 'var(--color-text-muted)'
        }}
      >
        <Icon size={10} style={{ color, flexShrink: 0 }} />
        <span style={{ color }}>{tools.length} actions</span>
        {expanded ? <ChevronUp size={9} /> : <ChevronDown size={9} />}
      </button>

      {expanded && (
        <div className="flex flex-wrap gap-1 pl-1">
          {tools.map((tool) => (
            <SingleChip key={tool.id} tool={tool} />
          ))}
        </div>
      )}
    </div>
  )
}

// ── Public API ─────────────────────────────────────────────────────────────

interface ToolCallChipProps {
  tool?: ToolCallData
  tools?: ToolCallData[]
}

export function ToolCallChip({ tool, tools }: ToolCallChipProps) {
  // Grouped mode: when an array of 5+ is passed
  if (tools && tools.length >= 5) {
    return <GroupedChip tools={tools} />
  }

  // Grouped mode with fewer items: render individual chips inline
  if (tools && tools.length > 0) {
    return (
      <div className="flex flex-wrap gap-1">
        {tools.map((t) => (
          <SingleChip key={t.id} tool={t} />
        ))}
      </div>
    )
  }

  // Individual chip
  if (tool) {
    return <SingleChip tool={tool} />
  }

  return null
}
