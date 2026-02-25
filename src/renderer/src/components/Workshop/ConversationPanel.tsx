import { useState, useRef, useEffect } from 'react'
import { useWorkshopStore } from '../../stores/workshopStore'
import { MessageBubble } from './MessageBubble'

export function ConversationPanel() {
  const messages = useWorkshopStore((s) => s.messages)
  const streamingContent = useWorkshopStore((s) => s.streamingContent)
  const isStreaming = useWorkshopStore((s) => s.isStreaming)
  const currentSessionId = useWorkshopStore((s) => s.currentSessionId)
  const [input, setInput] = useState('')
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, streamingContent])

  const handleSend = async () => {
    const trimmed = input.trim()
    if (!trimmed || !currentSessionId || isStreaming) return
    setInput('')
    await useWorkshopStore.getState().sendMessage(currentSessionId, trimmed)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  if (!currentSessionId) {
    return (
      <div className="flex-1 flex items-center justify-center bg-bg">
        <div className="text-center">
          <p className="text-text-muted text-lg">Select a session or start a new one</p>
          <p className="text-text-muted/60 text-sm mt-2">
            The Workshop is your creative space for brainstorming with Claude
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex-1 flex flex-col bg-bg">
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {messages.map((msg) => (
          <MessageBubble key={msg.id} message={msg} />
        ))}
        {isStreaming && streamingContent && (
          <MessageBubble
            message={{
              id: 'streaming',
              sessionId: currentSessionId,
              role: 'assistant',
              content: streamingContent,
              messageType: 'text',
              metadata: null,
              createdAt: new Date().toISOString(),
            }}
            isStreaming
          />
        )}
        {isStreaming && !streamingContent && (
          <div className="flex items-center gap-2 text-text-muted text-sm">
            <div className="w-2 h-2 rounded-full bg-accent-teal animate-pulse" />
            Claude is thinking...
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      <div className="border-t border-border p-4">
        <div className="flex gap-2">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Message Claude..."
            rows={1}
            className="flex-1 resize-none rounded-lg bg-surface border border-border px-4 py-3 text-text placeholder-text-muted/50 focus:outline-none focus:border-accent-teal text-sm"
            disabled={isStreaming}
          />
          <button
            onClick={handleSend}
            disabled={!input.trim() || isStreaming}
            className="px-4 py-3 rounded-lg bg-accent-teal text-bg font-medium text-sm hover:bg-accent-teal/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            Send
          </button>
        </div>
      </div>
    </div>
  )
}
