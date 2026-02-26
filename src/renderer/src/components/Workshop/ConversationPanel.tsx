import { useState, useRef, useEffect } from 'react'
import { useWorkshopStore } from '../../stores/workshopStore'
import { MessageBubble } from './MessageBubble'
import { PanelPersona } from '../../../../shared/types'
import { PERSONA_COLORS } from '../../../../shared/panel-personas'

export function ConversationPanel() {
  const messages = useWorkshopStore((s) => s.messages)
  const streamingContent = useWorkshopStore((s) => s.streamingContent)
  const isStreaming = useWorkshopStore((s) => s.isStreaming)
  const currentToolActivity = useWorkshopStore((s) => s.currentToolActivity)
  const streamingSegments = useWorkshopStore((s) => s.streamingSegments)
  const isStalled = useWorkshopStore((s) => s.isStalled)
  const currentSessionId = useWorkshopStore((s) => s.currentSessionId)
  const currentSession = useWorkshopStore((s) => s.currentSession)
  const sessionTokens = useWorkshopStore((s) => s.sessionTokens)
  const triggerDiscuss = useWorkshopStore((s) => s.triggerDiscuss)
  const sendPanelMessage = useWorkshopStore((s) => s.sendPanelMessage)
  const isPanelSession = currentSession?.sessionType === 'panel'
  const personas = currentSession?.panelPersonas || []
  const [input, setInput] = useState('')
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  const personaColorMap = new Map<string, string>()
  personas.forEach((p: PanelPersona) => personaColorMap.set(p.id, p.color))

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, streamingContent, streamingSegments])

  const handleSend = async () => {
    const trimmed = input.trim()
    if (!trimmed || !currentSessionId || isStreaming) return
    setInput('')
    if (isPanelSession) {
      await sendPanelMessage(currentSessionId, trimmed)
    } else {
      await useWorkshopStore.getState().sendMessage(currentSessionId, trimmed)
    }
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
      {isPanelSession && (
        <div className="flex items-center justify-between px-4 py-2 border-b border-border text-xs text-text-muted">
          <div className="flex items-center gap-3">
            {personas.map((p: PanelPersona) => {
              const colors = PERSONA_COLORS[p.color] || PERSONA_COLORS.emerald
              return (
                <span key={p.id} className="flex items-center gap-1.5">
                  <span className={`w-2 h-2 rounded-full ${colors.dot}`} />
                  {p.name}
                </span>
              )
            })}
          </div>
          <span>
            Tokens: {sessionTokens.input.toLocaleString()} in / {sessionTokens.output.toLocaleString()} out
          </span>
        </div>
      )}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        {messages.map((msg) => (
          <MessageBubble
            key={msg.id}
            message={msg}
            personaColor={msg.personaId ? personaColorMap.get(msg.personaId) : undefined}
          />
        ))}
        {isStreaming && streamingSegments.length > 0 && (
          <MessageBubble
            message={{
              id: 'streaming',
              sessionId: currentSessionId!,
              role: 'assistant',
              content: streamingContent,
              messageType: 'text',
              metadata: null,
              createdAt: new Date().toISOString(),
            }}
            isStreaming
            streamingSegments={streamingSegments}
          />
        )}
        {isStreaming && streamingSegments.length === 0 && (
          <div className="flex items-center gap-2 text-text-muted text-sm">
            <div className="w-2 h-2 rounded-full bg-accent-teal animate-pulse" />
            Claude is {currentToolActivity ?? 'thinking'}...
          </div>
        )}
        {isStalled && isStreaming && (
          <div className="flex items-center gap-3 px-3 py-2 rounded-lg bg-yellow-500/10 border border-yellow-500/30 text-sm">
            <span className="text-yellow-400">No activity for 60 seconds — session may be stalled</span>
            <button
              onClick={() => {
                useWorkshopStore.getState().stopSession(currentSessionId!)
              }}
              className="px-2 py-1 rounded bg-red-500/20 text-red-400 hover:bg-red-500/30 text-xs font-medium transition-colors"
            >
              Stop
            </button>
            <button
              onClick={() => {
                const dismiss = (useWorkshopStore as any)._dismissStall
                if (dismiss) dismiss()
                else useWorkshopStore.setState({ isStalled: false })
              }}
              className="px-2 py-1 rounded bg-surface text-text-muted hover:text-text text-xs font-medium transition-colors"
            >
              Keep Waiting
            </button>
          </div>
        )}
        {isPanelSession && !isStreaming && messages.length > 0 && (
          <div className="flex justify-center py-3">
            <button
              onClick={() => currentSession && triggerDiscuss(currentSession.id)}
              className="px-4 py-1.5 text-xs font-medium text-text-muted border border-border rounded-full hover:border-accent-teal/50 hover:text-text transition-colors"
            >
              Discuss further
            </button>
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
