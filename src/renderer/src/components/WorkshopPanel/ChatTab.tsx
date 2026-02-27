import { useState, useRef, useEffect, useCallback } from 'react'
import { Send } from 'lucide-react'
import { useWorkshopStore } from '../../stores/workshopStore'
import { ChatMessage } from './ChatMessage'

// Distance from bottom (px) within which we consider the user "at bottom"
const SCROLL_THRESHOLD = 100

export function ChatTab() {
  const messages = useWorkshopStore((s) => s.messages)
  const streamingContent = useWorkshopStore((s) => s.streamingContent)
  const isStreaming = useWorkshopStore((s) => s.isStreaming)
  const currentToolActivity = useWorkshopStore((s) => s.currentToolActivity)
  const streamingSegments = useWorkshopStore((s) => s.streamingSegments)
  const isStalled = useWorkshopStore((s) => s.isStalled)
  const currentSessionId = useWorkshopStore((s) => s.currentSessionId)
  const currentSession = useWorkshopStore((s) => s.currentSession)

  const [input, setInput] = useState('')
  const [userScrolledUp, setUserScrolledUp] = useState(false)

  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // ── Auto-resize textarea ───────────────────────────────────────────────────

  useEffect(() => {
    const ta = textareaRef.current
    if (!ta) return
    // Reset height to shrink before measuring
    ta.style.height = 'auto'
    // Cap at ~120px (approx 5 lines)
    ta.style.height = Math.min(ta.scrollHeight, 120) + 'px'
  }, [input])

  // ── Smart auto-scroll ──────────────────────────────────────────────────────

  const handleScroll = useCallback(() => {
    const el = scrollContainerRef.current
    if (!el) return
    const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
    setUserScrolledUp(distFromBottom > SCROLL_THRESHOLD)
  }, [])

  // Scroll to bottom when new content arrives, unless user scrolled up
  useEffect(() => {
    if (userScrolledUp) return
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, streamingContent, streamingSegments, userScrolledUp])

  // ── Send handler ───────────────────────────────────────────────────────────

  const handleSend = async () => {
    const trimmed = input.trim()
    if (!trimmed || !currentSessionId || isStreaming) return
    const savedInput = input
    setInput('')
    // Reset scroll so new response is visible
    setUserScrolledUp(false)
    try {
      const isPanelSession = currentSession?.sessionType === 'panel'
      if (isPanelSession) {
        await useWorkshopStore.getState().sendPanelMessage(currentSessionId, trimmed)
      } else {
        await useWorkshopStore.getState().sendMessage(currentSessionId, trimmed)
      }
    } catch {
      // Restore input so user can retry
      setInput(savedInput)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  // ── Empty state ────────────────────────────────────────────────────────────

  if (!currentSessionId) {
    return (
      <div className="h-full flex items-center justify-center px-4">
        <div className="text-center">
          <p
            className="text-sm font-medium mb-1"
            style={{ color: 'var(--color-text-secondary)' }}
          >
            No session selected
          </p>
          <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
            Pick a session from the dropdown above to start chatting
          </p>
        </div>
      </div>
    )
  }

  const canSend = input.trim().length > 0 && !isStreaming

  return (
    <div className="flex flex-col h-full">
      {/* ── Message list ─────────────────────────────────────────────────── */}
      <div
        ref={scrollContainerRef}
        onScroll={handleScroll}
        className="flex-1 min-h-0 overflow-y-auto py-3"
        style={{ scrollbarWidth: 'thin', scrollbarColor: 'var(--color-border) transparent' }}
      >
        {messages.length === 0 && !isStreaming && (
          <div className="flex items-center justify-center h-full px-4">
            <p className="text-xs text-center" style={{ color: 'var(--color-text-muted)' }}>
              Send a message to get started
            </p>
          </div>
        )}

        {messages.map((msg) => (
          <ChatMessage key={msg.id} message={msg} />
        ))}

        {/* Streaming message */}
        {isStreaming && streamingSegments.length > 0 && (
          <ChatMessage
            message={{
              id: 'streaming',
              sessionId: currentSessionId,
              role: 'assistant',
              content: streamingContent,
              messageType: 'text',
              metadata: null,
              createdAt: new Date().toISOString()
            }}
            isStreaming
            streamingSegments={streamingSegments}
          />
        )}

        {/* Waiting indicator (before first segment arrives) */}
        {isStreaming && streamingSegments.length === 0 && (
          <div
            className="flex items-center gap-2 px-3 py-1 text-xs"
            style={{ color: 'var(--color-text-muted)' }}
          >
            <span
              className="w-1.5 h-1.5 rounded-full animate-pulse flex-shrink-0"
              style={{ background: 'var(--color-accent-cyan)' }}
            />
            ClawFlow is {currentToolActivity ?? 'responding'}...
          </div>
        )}

        {/* Stall warning */}
        {isStalled && isStreaming && (
          <div
            className="mx-3 mt-1 mb-2 flex items-center gap-2 px-3 py-2 rounded-lg text-xs"
            style={{
              background: 'color-mix(in srgb, var(--color-accent-amber) 10%, transparent)',
              border: '1px solid color-mix(in srgb, var(--color-accent-amber) 30%, transparent)'
            }}
          >
            <span style={{ color: 'var(--color-accent-amber)' }}>
              No activity for 60s — session may be stalled
            </span>
            <button
              onClick={() => useWorkshopStore.getState().stopSession(currentSessionId)}
              className="ml-auto px-2 py-0.5 rounded text-[10px] font-medium transition-colors"
              style={{
                background: 'color-mix(in srgb, var(--color-accent-magenta) 20%, transparent)',
                color: 'var(--color-accent-magenta)'
              }}
            >
              Stop
            </button>
            <button
              onClick={() => {
                const dismiss = (useWorkshopStore as any)._dismissStall
                if (dismiss) dismiss()
                else useWorkshopStore.setState({ isStalled: false })
              }}
              className="px-2 py-0.5 rounded text-[10px] font-medium transition-colors"
              style={{
                background: 'var(--color-elevated)',
                color: 'var(--color-text-muted)'
              }}
            >
              Keep Waiting
            </button>
          </div>
        )}

        {/* Scroll anchor */}
        <div ref={messagesEndRef} />
      </div>

      {/* ── Input area ───────────────────────────────────────────────────── */}
      <div
        className="flex-shrink-0 px-3 pb-3 pt-2"
        style={{ borderTop: '1px solid var(--color-border)' }}
      >
        {/* Input wrapper with focus-within glow */}
        <div
          className="flex items-end gap-2 rounded-lg px-3 py-2 transition-all focus-within:shadow-[0_0_0_1px_rgba(0,229,255,0.35)]"
          style={{
            background: 'var(--color-elevated)',
            border: '1px solid var(--color-border)'
          }}
        >
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Message ClawFlow..."
            rows={1}
            disabled={isStreaming}
            className="flex-1 resize-none bg-transparent text-xs leading-relaxed focus:outline-none disabled:opacity-50"
            style={{
              color: 'var(--color-text-primary)',
              caretColor: 'var(--color-accent-cyan)',
              minHeight: '20px',
              maxHeight: '120px',
              overflowY: 'auto'
            }}
          />

          {/* Send button */}
          <button
            onClick={handleSend}
            disabled={!canSend}
            title="Send message"
            className="flex-shrink-0 w-6 h-6 flex items-center justify-center rounded transition-all disabled:opacity-30 disabled:cursor-not-allowed"
            style={{
              color: canSend ? 'var(--color-accent-cyan)' : 'var(--color-text-muted)'
            }}
          >
            <Send size={13} />
          </button>
        </div>

        <p
          className="text-[9px] mt-1 text-center"
          style={{ color: 'var(--color-text-muted)', opacity: 0.6 }}
        >
          Enter to send · Shift+Enter for newline
        </p>
      </div>
    </div>
  )
}
