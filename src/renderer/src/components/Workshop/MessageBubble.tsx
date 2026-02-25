import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { WorkshopMessage } from '../../../../shared/types'

export function MessageBubble({
  message,
  isStreaming = false,
}: {
  message: WorkshopMessage
  isStreaming?: boolean
}) {
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

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[80%] rounded-lg px-4 py-3 ${
          isUser
            ? 'bg-accent-teal/15 text-text'
            : 'bg-surface text-text border border-border'
        }`}
      >
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
