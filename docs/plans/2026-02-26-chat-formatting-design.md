# Workshop Chat Formatting Improvements

**Date:** 2026-02-26
**Status:** Approved

## Problem

Agent responses feel like a wall of text — no visual separation between thinking pauses, tool uses are stripped/hidden, and everything lands in one monolithic bubble. There's no indication when the agent is thinking between response chunks, and no inline tool use indicators.

## Solution: Claude Code-style Message Flow

### 1. Thinking Dividers

When the agent pauses (thinking between response chunks), insert a subtle visual break:

- A thin horizontal line with animated "thinking..." text (dots animation)
- Once thinking completes, collapses to a subtle separator line
- Makes it clear the agent paused and resumed

### 2. Inline Tool Use Cards (Collapsed by Default)

Instead of stripping `<tool_call>` XML and showing a separate activity log, render tool uses **inline** within the message flow:

- Compact bar: chevron icon + tool name + context (file path, command, etc.)
- Click to expand: shows input parameters and result summary
- Color-coded by tool type:
  - Read = blue
  - Edit = amber
  - Bash = green
  - Search (Grep/Glob) = violet
  - Write = amber
  - WebFetch/WebSearch = cyan
  - Task = slate

### 3. Grouped Consecutive Tools

When multiple tools of the same type fire back-to-back:

- Group into a single collapsible: "Read 3 files" / "Edited 2 files"
- Expand to see individual items
- Mixed consecutive tool types stay individual

### 4. Better Message Spacing

- Reduce inner padding: `px-4 py-2.5` (from `py-3`)
- Between messages: `space-y-3` (from `space-y-4`)
- Between user→agent transitions: slightly larger gap
- Thinking dividers: minimal vertical space (`my-2`)

### 5. Streaming Improvements

- During streaming: pulsing cursor at end of text
- Tool activity appears inline in the message as it happens (not in a separate log below)
- After completion: tool activity log removed (now inline in the message)

## Component Architecture

### New Components

- **`ToolCallCard.tsx`** — Reusable expandable tool call card
  - Props: toolName, toolInput, toolResult, isExpanded, onToggle
  - Renders compact bar and expandable detail panel
  - Color-coded by tool type

- **`ToolCallGroup.tsx`** — Groups consecutive same-type tool calls
  - Props: tools[], toolType, isExpanded, onToggle
  - Shows "Read 3 files" summary, expands to list

- **`ThinkingDivider.tsx`** — Animated thinking separator
  - Props: isActive (animating vs collapsed)
  - Thin line with dots animation while active, subtle line when done

### Modified Components

- **`MessageBubble.tsx`** — Parse tool calls from content, render inline ToolCallCards/Groups, interleave with text content
- **`ConversationPanel.tsx`** — Track thinking pauses between stream chunks, insert ThinkingDividers, pass tool data to MessageBubble
- **`workshopStore.ts`** — Store structured tool call data per message (not just raw text), track thinking state transitions
- **`workshop-engine.ts`** — Emit richer tool events (include file paths, input summaries, results), emit thinking state change events

### Data Flow

1. `workshop-engine.ts` emits `tool_call` events with structured data (name, input, result)
2. `workshopStore.ts` accumulates tool calls per streaming message as structured array
3. When message completes, tool call data stored in message `metadata.toolCalls`
4. `MessageBubble.tsx` reads `metadata.toolCalls` and interleaves with text content
5. During streaming, `ConversationPanel.tsx` renders live tool cards from store state

### Message Content Structure

Instead of stripping tool calls from content, parse them into a structured sequence:

```typescript
type MessageSegment =
  | { type: 'text'; content: string }
  | { type: 'thinking'; duration?: number }
  | { type: 'tool_call'; toolName: string; toolInput: Record<string, unknown>; toolResult?: unknown }
  | { type: 'tool_group'; toolName: string; tools: ToolCallData[] }
```

MessageBubble renders these segments in order, producing the interleaved text + tools + thinking flow.

## What's NOT Changing

- Message bubble alignment (user right, agent left)
- Persona colors for panel discussions
- Markdown rendering engine (ReactMarkdown + remark-gfm)
- Message persistence schema (metadata field absorbs tool data)
- Overall Workshop layout
