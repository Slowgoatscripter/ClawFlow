import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { Components } from 'react-markdown'
import type { WorkshopMessage, MessageSegment, ToolCallData } from '../../../../shared/types'
import { CodeBlock } from './CodeBlock'
import { ThinkingPill } from './ThinkingPill'
import { ToolCallChip } from './ToolCallChip'

// ── Helpers ────────────────────────────────────────────────────────────────

function formatTime(iso: string): string {
  try {
    const d = new Date(iso)
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  } catch {
    return ''
  }
}

function stripLegacyToolXml(content: string): string {
  return content.replace(/<tool_call name="[\w-]+">\s*[\s\S]*?<\/tool_call>/g, '').trim()
}

// Custom ReactMarkdown code renderer — routes fenced blocks through CodeBlock
const markdownComponents: Components = {
  code({ className, children, ...props }) {
    const match = /language-(\w+)/.exec(className ?? '')
    const isBlock = 'node' in props

    if (isBlock && match) {
      const rawCode = String(children).replace(/\n$/, '')
      return <CodeBlock language={match[1]} code={rawCode} />
    }

    // Inline code
    return (
      <code
        className="px-1 py-0.5 rounded text-xs font-mono"
        style={{
          background: 'var(--color-elevated)',
          color: 'var(--color-accent-cyan)',
          border: '1px solid var(--color-border)'
        }}
        {...props}
      >
        {children}
      </code>
    )
  }
}

// ── Segment renderer ────────────────────────────────────────────────────────

interface SegmentListProps {
  segments: MessageSegment[]
  isStreaming: boolean
}

function SegmentList({ segments, isStreaming }: SegmentListProps) {
  return (
    <div>
      {segments.map((seg, i) => {
        const isLast = i === segments.length - 1

        if (seg.type === 'text') {
          const cleaned = stripLegacyToolXml(seg.content)
          if (!cleaned) return null
          return (
            <div key={i} className="prose prose-sm prose-invert max-w-none text-sm">
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={markdownComponents}
              >
                {cleaned}
              </ReactMarkdown>
            </div>
          )
        }

        if (seg.type === 'thinking') {
          return (
            <ThinkingPill
              key={i}
              content={seg.content || ''}
              duration={seg.duration}
              streaming={isStreaming && isLast}
            />
          )
        }

        if (seg.type === 'tool_call') {
          return (
            <div key={i} className="my-1">
              <ToolCallChip tool={seg.tool} />
            </div>
          )
        }

        if (seg.type === 'tool_group') {
          return (
            <div key={i} className="my-1">
              <ToolCallChip tools={seg.tools} />
            </div>
          )
        }

        return (
          <div key={i} className="text-xs italic" style={{ color: 'var(--color-text-muted)' }}>
            [Unsupported segment]
          </div>
        )
      })}

      {/* Streaming cursor */}
      {isStreaming && (
        <span
          className="inline-block w-1.5 h-3.5 ml-0.5 align-text-bottom animate-pulse"
          style={{ background: 'var(--color-accent-cyan)', opacity: 0.7 }}
        />
      )}
    </div>
  )
}

// ── Tool call footer ────────────────────────────────────────────────────────

interface ToolFooterProps {
  toolCalls: ToolCallData[]
}

function ToolFooter({ toolCalls }: ToolFooterProps) {
  if (toolCalls.length === 0) return null
  return (
    <div
      className="mt-2 pt-1.5 flex flex-wrap gap-1"
      style={{ borderTop: '1px solid var(--color-border)' }}
    >
      <ToolCallChip tools={toolCalls} />
    </div>
  )
}

// ── ChatMessage ─────────────────────────────────────────────────────────────

interface ChatMessageProps {
  message: WorkshopMessage
  isStreaming?: boolean
  streamingSegments?: MessageSegment[]
}

export function ChatMessage({ message, isStreaming = false, streamingSegments }: ChatMessageProps) {
  // System messages: centered pill
  if (message.role === 'system') {
    return (
      <div className="flex justify-center my-2">
        <span
          className="text-xs px-3 py-1 rounded-full"
          style={{
            color: 'var(--color-text-muted)',
            background: 'var(--color-elevated)',
            border: '1px solid var(--color-border)'
          }}
        >
          {message.content}
        </span>
      </div>
    )
  }

  const isUser = message.role === 'user'
  const timestamp = formatTime(message.createdAt)

  // Resolve segments: streaming segments take priority, then stored metadata
  const rawSegments = isStreaming && streamingSegments
    ? streamingSegments
    : (message.metadata?.segments as unknown)
  const segments: MessageSegment[] | null = Array.isArray(rawSegments) ? rawSegments : null

  // Fallback display content for messages without segment data
  const displayContent = isUser
    ? message.content
    : stripLegacyToolXml(message.content)

  // Tool calls stored in metadata (for completed messages with no segments)
  const metaToolCalls = (message.metadata?.toolCalls as ToolCallData[] | undefined) ?? []

  if (!segments && !displayContent && metaToolCalls.length === 0) return null

  // ── User message ──────────────────────────────────────────────────────────
  if (isUser) {
    return (
      <div className="group flex justify-end mb-3 px-3">
        <div className="max-w-[80%] flex flex-col items-end gap-0.5">
          <span
            className="text-xs font-semibold tracking-wide mb-0.5"
            style={{ color: 'var(--color-accent-cyan)' }}
          >
            You
          </span>

          <div
            className="rounded-lg px-3 py-2 text-sm whitespace-pre-wrap leading-relaxed"
            style={{
              background: 'color-mix(in srgb, var(--color-accent-cyan) 8%, var(--color-elevated))',
              border: '1px solid color-mix(in srgb, var(--color-accent-cyan) 20%, transparent)',
              color: 'var(--color-text-primary)'
            }}
          >
            {displayContent}
          </div>

          {timestamp && (
            <span
              className="text-[10px] opacity-0 group-hover:opacity-100 transition-opacity"
              style={{ color: 'var(--color-text-muted)' }}
            >
              {timestamp}
            </span>
          )}
        </div>
      </div>
    )
  }

  // ── Agent message ─────────────────────────────────────────────────────────
  return (
    <div className="group flex justify-start mb-3 px-3">
      <div className="max-w-[90%] flex flex-col gap-0.5">
        {/* Label — persona name if set, otherwise "ClawFlow" */}
        <span
          className="text-xs font-semibold tracking-wide mb-0.5"
          style={{ color: 'var(--color-accent-magenta, var(--color-accent-violet))' }}
        >
          {message.personaName ?? 'ClawFlow'}
        </span>

        {/* Content — no bubble for agent messages */}
        <div className="text-sm leading-relaxed" style={{ color: 'var(--color-text-primary)' }}>
          {segments ? (
            <SegmentList segments={segments} isStreaming={isStreaming} />
          ) : (
            <div className="prose prose-sm prose-invert max-w-none">
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={markdownComponents}
              >
                {displayContent}
              </ReactMarkdown>
            </div>
          )}

          {/* Tool call footer for completed messages */}
          {!segments && metaToolCalls.length > 0 && (
            <ToolFooter toolCalls={metaToolCalls} />
          )}
        </div>

        {timestamp && (
          <span
            className="text-[10px] opacity-0 group-hover:opacity-100 transition-opacity"
            style={{ color: 'var(--color-text-muted)' }}
          >
            {timestamp}
          </span>
        )}
      </div>
    </div>
  )
}
