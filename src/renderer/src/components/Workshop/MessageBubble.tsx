import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { WorkshopMessage, MessageSegment } from '../../../../shared/types'
import { PERSONA_COLORS } from '../../../../shared/panel-personas'
import { ToolCallCard } from './ToolCallCard'
import { ToolCallGroup } from './ToolCallGroup'
import { ThinkingDivider } from './ThinkingDivider'

interface MessageBubbleProps {
  message: WorkshopMessage
  isStreaming?: boolean
  personaColor?: string
  streamingSegments?: MessageSegment[]
}

export function MessageBubble({ message, isStreaming = false, personaColor, streamingSegments }: MessageBubbleProps) {
  if (message.role === 'system') {
    return (
      <div className="flex justify-center">
        <span className="text-xs text-text-muted bg-surface px-3 py-1 rounded-full">
          {message.content}
        </span>
      </div>
    )
  }

  const isUser = message.role === 'user'
  const colors = personaColor ? PERSONA_COLORS[personaColor] : null

  // Determine segments to render
  const segments: MessageSegment[] | null =
    isStreaming && streamingSegments
      ? streamingSegments
      : (message.metadata?.segments as MessageSegment[] | undefined) ?? null

  // Fallback: strip tool_call XML and render as single text block (old messages)
  const displayContent = isUser
    ? message.content
    : message.content.replace(/<tool_call name="\w+">\s*[\s\S]*?<\/tool_call>/g, '').trim()

  if (!segments && !displayContent) return null

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[80%] rounded-lg px-4 py-2.5 ${
          isUser
            ? 'bg-accent-cyan/15 text-text'
            : colors
              ? `${colors.bg} text-text border ${colors.border}`
              : 'bg-surface text-text border border-border'
        }`}
      >
        {message.personaName && colors && (
          <div className="flex items-center gap-2 mb-2 pb-2 border-b border-white/10">
            <span className={`w-2.5 h-2.5 rounded-full ${colors.dot}`} />
            <span className="text-xs font-semibold text-text">{message.personaName}</span>
            {message.roundNumber && message.roundNumber > 1 && (
              <span className="text-xs text-text-muted ml-auto">Round {message.roundNumber}</span>
            )}
          </div>
        )}
        {isUser ? (
          <p className="text-sm whitespace-pre-wrap">{displayContent}</p>
        ) : segments ? (
          <div>
            {segments.map((seg, i) => {
              if (seg.type === 'text') {
                return (
                  <div key={i} className="prose prose-sm prose-invert max-w-none">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{seg.content}</ReactMarkdown>
                  </div>
                )
              }
              if (seg.type === 'thinking') {
                return <ThinkingDivider key={i} isActive={isStreaming && i === segments.length - 1} />
              }
              if (seg.type === 'tool_call') {
                return <ToolCallCard key={i} tool={seg.tool} />
              }
              if (seg.type === 'tool_group') {
                return <ToolCallGroup key={i} toolName={seg.toolName} tools={seg.tools} />
              }
              return null
            })}
            {isStreaming && (
              <span className="inline-block w-1.5 h-4 bg-accent-cyan/70 animate-pulse ml-0.5 align-text-bottom" />
            )}
          </div>
        ) : (
          <div className="prose prose-sm prose-invert max-w-none">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{displayContent}</ReactMarkdown>
          </div>
        )}
      </div>
    </div>
  )
}
