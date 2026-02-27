# Chat Formatting Improvements Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Transform workshop chat from a wall-of-text experience into a Claude Code-style message flow with inline tool use cards, thinking dividers, and grouped tool calls.

**Architecture:** Add a `MessageSegment` type system that parses raw streaming events into structured text/tool/thinking segments. New components render each segment type inline within the message bubble. The store accumulates structured data during streaming and persists it in message metadata on completion.

**Tech Stack:** React, Zustand, Tailwind CSS, ReactMarkdown, Lucide icons

---

### Task 1: Add Types and Interfaces

**Files:**
- Modify: `src/shared/types.ts:269-284`

**Step 1: Add tool call and segment types to types.ts**

Add after the existing `WorkshopToolCall` interface (line 281):

```typescript
export interface ToolCallData {
  id: string
  toolName: string
  toolInput?: Record<string, unknown>
  toolResult?: unknown
  timestamp: string
}

export type MessageSegment =
  | { type: 'text'; content: string }
  | { type: 'thinking' }
  | { type: 'tool_call'; tool: ToolCallData }
  | { type: 'tool_group'; toolName: string; tools: ToolCallData[] }
```

**Step 2: Update WorkshopStreamEvent to include tool input**

Update the `WorkshopStreamEvent` interface to add `toolInput` field (it already exists in the type but engine doesn't send it for SDK tool calls — we'll use it now).

**Step 3: Commit**

```bash
git add src/shared/types.ts
git commit -m "feat(workshop): add ToolCallData and MessageSegment types"
```

---

### Task 2: Update Workshop Engine to Emit Richer Tool Events

**Files:**
- Modify: `src/main/workshop-engine.ts:193-209`

**Step 1: Emit tool_call events with input data**

In `sendMessage()`, the `onStream` callback currently emits:
```typescript
{ type: 'tool_call', toolName: streamContent.replace('Tool: ', ''), sessionId }
```

Update to also parse and include tool input when available. The SDK `onStream` callback receives `(streamContent, streamType)` — for `tool_use`, `streamContent` is `"Tool: ToolName"`. We can't get input from the stream callback alone, so we keep the current behavior but ensure the store can reconstruct from the activity log.

Also emit a new `'thinking'` event when there's a gap between tool_result and next text:

```typescript
// In the onStream callback, track state:
let lastEventType: string = 'text'

onStream: (streamContent: string, streamType: string) => {
  if (streamType === 'tool_use') {
    lastEventType = 'tool_use'
    this.emit('stream', {
      type: 'tool_call',
      toolName: streamContent.replace('Tool: ', ''),
      sessionId,
    } as WorkshopStreamEvent)
  } else {
    // If we were doing tool work and now getting text, emit thinking marker
    if (lastEventType === 'tool_use' && streamContent.trim()) {
      this.emit('stream', { type: 'thinking' as any, sessionId })
    }
    lastEventType = 'text'
    accumulatedText += streamContent
    debouncedSave()
    this.emit('stream', {
      type: 'text',
      content: streamContent,
      sessionId,
    } as WorkshopStreamEvent)
  }
}
```

**Step 2: Commit**

```bash
git add src/main/workshop-engine.ts
git commit -m "feat(workshop): emit thinking markers between tool use and text"
```

---

### Task 3: Update Workshop Store for Structured Streaming

**Files:**
- Modify: `src/renderer/src/stores/workshopStore.ts`

**Step 1: Add new state fields**

Add to the `WorkshopState` interface:

```typescript
streamingSegments: MessageSegment[]
streamingToolCalls: ToolCallData[]
```

Initialize in the store defaults:
```typescript
streamingSegments: [],
streamingToolCalls: [],
```

**Step 2: Update the stream event handler**

In `setupListeners()`, modify the `onStream` handler:

- On `text` event: If the last segment is `text`, append to it. Otherwise push a new text segment.
- On `tool_call` event: Push a `tool_call` segment. Also add to `streamingToolCalls` array.
- On `thinking` event: Push a `thinking` segment.
- On `done` event: Store `streamingSegments` and `streamingToolCalls` into the final message's metadata. Group consecutive same-name tool calls into `tool_group` segments.

```typescript
if (event.type === 'text' && event.content) {
  const segments = [...state.streamingSegments]
  const last = segments[segments.length - 1]
  if (last && last.type === 'text') {
    segments[segments.length - 1] = { type: 'text', content: last.content + event.content }
  } else {
    segments.push({ type: 'text', content: event.content })
  }
  set({
    streamingContent: state.streamingContent + event.content,
    streamingSegments: segments
  })
} else if (event.type === 'tool_call' && event.toolName) {
  const verb = TOOL_VERBS[event.toolName] ?? `using ${event.toolName}`
  const toolData: ToolCallData = {
    id: crypto.randomUUID(),
    toolName: event.toolName,
    toolInput: event.toolInput,
    timestamp: new Date().toISOString()
  }
  set({
    currentToolActivity: verb,
    toolActivityLog: [...state.toolActivityLog, event.toolName],
    streamingToolCalls: [...state.streamingToolCalls, toolData],
    streamingSegments: [...state.streamingSegments, { type: 'tool_call', tool: toolData }]
  })
} else if ((event as any).type === 'thinking') {
  set({
    streamingSegments: [...state.streamingSegments, { type: 'thinking' }]
  })
}
```

**Step 3: On `done`, group consecutive tools and store in metadata**

```typescript
} else if (event.type === 'done') {
  clearStallTimer()
  const groupedSegments = groupConsecutiveTools(state.streamingSegments)
  const assistantMsg: WorkshopMessage = {
    id: crypto.randomUUID(),
    sessionId: event.sessionId ?? state.currentSessionId ?? '',
    role: 'assistant',
    content: state.streamingContent,
    messageType: 'text',
    metadata: {
      segments: groupedSegments,
      toolCalls: state.streamingToolCalls
    },
    createdAt: new Date().toISOString()
  }
  set((s) => ({
    messages: [...s.messages, assistantMsg],
    streamingContent: '',
    streamingSegments: [],
    streamingToolCalls: [],
    isStreaming: false,
    currentToolActivity: null,
    toolActivityLog: [],
    isStalled: false
  }))
}
```

**Step 4: Add the `groupConsecutiveTools` helper**

Place above `setupListeners`:

```typescript
function groupConsecutiveTools(segments: MessageSegment[]): MessageSegment[] {
  const result: MessageSegment[] = []
  let i = 0
  while (i < segments.length) {
    const seg = segments[i]
    if (seg.type === 'tool_call') {
      // Collect consecutive tool_calls with same name
      const group: ToolCallData[] = [seg.tool]
      while (
        i + 1 < segments.length &&
        segments[i + 1].type === 'tool_call' &&
        (segments[i + 1] as any).tool.toolName === seg.tool.toolName
      ) {
        i++
        group.push((segments[i] as any).tool)
      }
      if (group.length > 1) {
        result.push({ type: 'tool_group', toolName: seg.tool.toolName, tools: group })
      } else {
        result.push(seg)
      }
    } else {
      result.push(seg)
    }
    i++
  }
  return result
}
```

**Step 5: Reset streaming segments on sendMessage/sendPanelMessage**

In both `sendMessage` and `sendPanelMessage`, add to the `set()` call:
```typescript
streamingSegments: [],
streamingToolCalls: [],
```

**Step 6: Commit**

```bash
git add src/renderer/src/stores/workshopStore.ts
git commit -m "feat(workshop): track structured segments and tool calls during streaming"
```

---

### Task 4: Create ThinkingDivider Component

**Files:**
- Create: `src/renderer/src/components/Workshop/ThinkingDivider.tsx`

**Step 1: Create the component**

```tsx
interface ThinkingDividerProps {
  isActive?: boolean
}

export function ThinkingDivider({ isActive = false }: ThinkingDividerProps) {
  return (
    <div className="flex items-center gap-2 my-2">
      <div className="flex-1 h-px bg-border/50" />
      {isActive ? (
        <span className="text-xs text-text-muted flex items-center gap-1">
          <span className="flex gap-0.5">
            <span className="w-1 h-1 rounded-full bg-accent-teal animate-bounce [animation-delay:0ms]" />
            <span className="w-1 h-1 rounded-full bg-accent-teal animate-bounce [animation-delay:150ms]" />
            <span className="w-1 h-1 rounded-full bg-accent-teal animate-bounce [animation-delay:300ms]" />
          </span>
          thinking
        </span>
      ) : (
        <span className="text-[10px] text-text-muted/40">·</span>
      )}
      <div className="flex-1 h-px bg-border/50" />
    </div>
  )
}
```

**Step 2: Commit**

```bash
git add src/renderer/src/components/Workshop/ThinkingDivider.tsx
git commit -m "feat(workshop): add ThinkingDivider component"
```

---

### Task 5: Create ToolCallCard Component

**Files:**
- Create: `src/renderer/src/components/Workshop/ToolCallCard.tsx`

**Step 1: Create the component**

Tool color mapping:
- Read → blue (`text-blue-400 bg-blue-500/10 border-blue-500/20`)
- Edit/Write → amber (`text-amber-400 bg-amber-500/10 border-amber-500/20`)
- Bash → green (`text-green-400 bg-green-500/10 border-green-500/20`)
- Grep/Glob → violet (`text-violet-400 bg-violet-500/10 border-violet-500/20`)
- WebFetch/WebSearch → cyan (`text-cyan-400 bg-cyan-500/10 border-cyan-500/20`)
- Task → slate (`text-slate-400 bg-slate-500/10 border-slate-500/20`)

```tsx
import { useState } from 'react'
import { ChevronRight, ChevronDown, FileText, Pencil, Terminal, Search, Globe, Users } from 'lucide-react'
import type { ToolCallData } from '../../../../shared/types'

const TOOL_STYLES: Record<string, { color: string; bg: string; border: string; icon: any }> = {
  Read: { color: 'text-blue-400', bg: 'bg-blue-500/10', border: 'border-blue-500/20', icon: FileText },
  Edit: { color: 'text-amber-400', bg: 'bg-amber-500/10', border: 'border-amber-500/20', icon: Pencil },
  Write: { color: 'text-amber-400', bg: 'bg-amber-500/10', border: 'border-amber-500/20', icon: Pencil },
  Bash: { color: 'text-green-400', bg: 'bg-green-500/10', border: 'border-green-500/20', icon: Terminal },
  Grep: { color: 'text-violet-400', bg: 'bg-violet-500/10', border: 'border-violet-500/20', icon: Search },
  Glob: { color: 'text-violet-400', bg: 'bg-violet-500/10', border: 'border-violet-500/20', icon: Search },
  WebFetch: { color: 'text-cyan-400', bg: 'bg-cyan-500/10', border: 'border-cyan-500/20', icon: Globe },
  WebSearch: { color: 'text-cyan-400', bg: 'bg-cyan-500/10', border: 'border-cyan-500/20', icon: Globe },
  Task: { color: 'text-slate-400', bg: 'bg-slate-500/10', border: 'border-slate-500/20', icon: Users },
  LS: { color: 'text-blue-400', bg: 'bg-blue-500/10', border: 'border-blue-500/20', icon: FileText },
}

const DEFAULT_STYLE = { color: 'text-text-muted', bg: 'bg-surface', border: 'border-border', icon: Terminal }

function getToolContext(tool: ToolCallData): string {
  const input = tool.toolInput
  if (!input) return ''
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
      {expanded && tool.toolInput && (
        <div className="px-3 py-2 border-t border-white/5 text-xs font-mono text-text-muted/80 max-h-32 overflow-y-auto">
          <pre className="whitespace-pre-wrap">{JSON.stringify(tool.toolInput, null, 2)}</pre>
        </div>
      )}
    </div>
  )
}
```

**Step 2: Commit**

```bash
git add src/renderer/src/components/Workshop/ToolCallCard.tsx
git commit -m "feat(workshop): add ToolCallCard component with color-coded tool types"
```

---

### Task 6: Create ToolCallGroup Component

**Files:**
- Create: `src/renderer/src/components/Workshop/ToolCallGroup.tsx`

**Step 1: Create the component**

```tsx
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
```

**Step 2: Commit**

```bash
git add src/renderer/src/components/Workshop/ToolCallGroup.tsx
git commit -m "feat(workshop): add ToolCallGroup component for consecutive tool grouping"
```

---

### Task 7: Update MessageBubble to Render Segments

**Files:**
- Modify: `src/renderer/src/components/Workshop/MessageBubble.tsx`

**Step 1: Rewrite MessageBubble to render segments**

The key change: instead of rendering `displayContent` as a single markdown block, check for `message.metadata?.segments`. If segments exist, render each segment type with its appropriate component. If no segments (old messages / user messages), fall back to current behavior.

```tsx
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
              <span className="inline-block w-1.5 h-4 bg-accent-teal/70 animate-pulse ml-0.5 align-text-bottom" />
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
```

**Step 2: Commit**

```bash
git add src/renderer/src/components/Workshop/MessageBubble.tsx
git commit -m "feat(workshop): render message segments with inline tool cards and thinking dividers"
```

---

### Task 8: Update ConversationPanel for New Streaming Flow

**Files:**
- Modify: `src/renderer/src/components/Workshop/ConversationPanel.tsx`

**Step 1: Use streamingSegments and update spacing**

Key changes:
1. Subscribe to `streamingSegments` from store
2. Pass `streamingSegments` to the streaming MessageBubble
3. Replace the separate thinking/tool activity indicators with the inline segment rendering
4. Update spacing from `space-y-4` to `space-y-3`
5. Keep the stall detection and panel session UI as-is

```tsx
import { useState, useRef, useEffect } from 'react'
import { useWorkshopStore } from '../../stores/workshopStore'
import { MessageBubble } from './MessageBubble'
import { PanelPersona } from '../../../../shared/types'
import { PERSONA_COLORS } from '../../../../shared/panel-personas'

export function ConversationPanel() {
  const messages = useWorkshopStore((s) => s.messages)
  const streamingContent = useWorkshopStore((s) => s.streamingContent)
  const streamingSegments = useWorkshopStore((s) => s.streamingSegments)
  const isStreaming = useWorkshopStore((s) => s.isStreaming)
  const currentToolActivity = useWorkshopStore((s) => s.currentToolActivity)
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

  // ... handleSend and handleKeyDown stay the same ...

  // In the message list area, change space-y-4 to space-y-3:
  // <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">

  // Replace the streaming section (lines 91-121) with:
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

  // Remove the old toolActivityLog rendering (lines 111-119)
}
```

**Step 2: Commit**

```bash
git add src/renderer/src/components/Workshop/ConversationPanel.tsx
git commit -m "feat(workshop): use streaming segments for inline tool/thinking display"
```

---

### Task 9: Build and Verify

**Step 1: Run build**

```bash
npm run build
```

Expected: Clean build with no TypeScript errors.

**Step 2: Manual test checklist**

1. Open Workshop, start a new session
2. Send a message that triggers tool use (e.g., "look at the project structure")
3. Verify: tool calls appear as collapsed cards inline in the message
4. Verify: clicking a tool card expands it to show input details
5. Verify: consecutive same-type tools are grouped (e.g., "3 files read")
6. Verify: thinking dividers appear between tool work and text responses
7. Verify: spacing feels tighter and cleaner
8. Verify: old messages (before this change) still render correctly via fallback
9. Verify: panel session messages still show persona colors and names

**Step 3: Final commit**

```bash
git add -A
git commit -m "feat(workshop): chat formatting improvements - inline tools, thinking dividers, grouped calls"
```
