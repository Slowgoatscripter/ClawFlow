import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { WorkshopMessage } from '../../../../shared/types'
import { PERSONA_COLORS } from '../../../../shared/panel-personas'

interface MessageBubbleProps {
  message: WorkshopMessage
  isStreaming?: boolean
  personaColor?: string
}

export function MessageBubble({ message, isStreaming = false, personaColor }: MessageBubbleProps) {
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

  // Strip tool_call XML blocks from assistant messages (they get parsed separately by the engine)
  const displayContent = isUser
    ? message.content
    : message.content.replace(/<tool_call name="\w+">\s*[\s\S]*?<\/tool_call>/g, '').trim()

  if (!displayContent) return null

  const colors = personaColor ? PERSONA_COLORS[personaColor] : null

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[80%] rounded-lg px-4 py-3 ${
          isUser
            ? 'bg-accent-teal/15 text-text'
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
        ) : (
          <div className="prose prose-sm prose-invert max-w-none">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {displayContent}
            </ReactMarkdown>
          </div>
        )}
      </div>
    </div>
  )
}
