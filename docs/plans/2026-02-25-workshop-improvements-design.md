# Workshop Improvements Design

**Date:** 2026-02-25
**Status:** Approved

## Problem

The Workshop has three UX issues and one missing feature:

1. **Invisible tool-use activity** — When Claude is doing multi-turn tool work (reading files, searching code), the UI only shows "Claude is thinking..." with no progress indication. The message completes on the backend but the frontend has no visibility, making it appear stuck.
2. **No stall recovery** — No timeout or heartbeat on SDK calls. If the API stalls, `isStreaming` stays `true` forever. The only escape is restarting the app.
3. **Lost streaming content on restart** — Partial streaming content lives only in Zustand state. If the app restarts mid-stream, the completed message only appears after reload because it's saved to DB at the end, not during streaming.
4. **All sessions named "New Session"** — No auto-naming or rename capability exists.

## Design

### 1. Tool-Use Activity Indicator

**Replace** the static "Claude is thinking..." with dynamic status + activity log.

**New store state:**
```typescript
currentToolActivity: string | null    // e.g., "reading files"
toolActivityLog: string[]             // e.g., ["Read src/main/index.ts", "Grep handleStream"]
```

**Friendly verb map** (in ConversationPanel or a util):
```typescript
const TOOL_VERBS: Record<string, string> = {
  Read: 'reading files',
  Grep: 'searching code',
  Glob: 'finding files',
  Write: 'writing files',
  Edit: 'editing files',
  Bash: 'running a command',
  WebFetch: 'fetching web content',
  WebSearch: 'searching the web',
}
// Fallback: "using {toolName}"
```

**Stream event handling** — the `workshopStore` stream listener gains a `tool_call` handler:
```typescript
if (event.type === 'tool_call' && event.toolName) {
  const verb = TOOL_VERBS[event.toolName] ?? `using ${event.toolName}`
  set({
    currentToolActivity: verb,
    toolActivityLog: [...state.toolActivityLog, event.toolName + (event.content ? ` ${event.content}` : '')]
  })
}
```

**UI in ConversationPanel** — replace the thinking indicator block:
- Primary line: pulsing dot + `Claude is {currentToolActivity ?? 'thinking'}...`
- Below: scrollable activity log showing each tool call (max ~5 visible, auto-scroll)
- Both reset on `done` or `error`

### 2. Stall Detection & Recovery

**Frontend heartbeat timer** in `workshopStore`:

- On `isStreaming = true`: start a 60-second inactivity timer
- On every stream event (text, tool_call): reset the timer
- On timer expiry: set `isStalled: true`
- On `done` / `error` / manual stop: clear timer, set `isStalled: false`

**New store state:**
```typescript
isStalled: boolean
stallTimerId: ReturnType<typeof setTimeout> | null  // internal, not exposed
```

**UI** — when `isStalled && isStreaming`, show a recovery banner below the activity indicator:
- Text: "No activity for 60 seconds — session may be stalled"
- Button: "Stop & Retry" — calls `stopSession()`, resets streaming state
- Button: "Keep Waiting" — dismisses the banner, resets the 60s timer

### 3. Persist Partial Streaming Content

**Backend approach** — the workshop engine debounce-saves streaming content:

- In `sendMessage()`, track accumulated text content in a local variable
- In the `onStream` callback, when text events arrive, debounce (2s) a DB update:
  ```typescript
  updateWorkshopSession(this.dbPath, sessionId, { pendingContent: accumulatedText })
  ```
- On `done`: save the full assistant message as normal, then clear `pendingContent`
- On error: save whatever was accumulated as a partial message, clear `pendingContent`

**DB change** — add `pending_content` column to `workshop_sessions`:
```sql
ALTER TABLE workshop_sessions ADD COLUMN pending_content TEXT DEFAULT NULL;
```

**Frontend recovery** — in `selectSession()` or on app load:
- If a session has `pending_content` and status is still `active`, display it as the last assistant message and clear `isStreaming`
- Call a new IPC `workshop:recover-session` that clears `pending_content` and returns it

### 4. Session Auto-Naming + Manual Rename

**Auto-name trigger** — after first `done` event on a session titled "New Session":
1. Workshop engine fires a lightweight Haiku call with the user's first message
2. Prompt: `"Generate a 3-5 word title for this conversation. Only output the title, nothing else: {firstUserMessage}"`
3. Update DB title, emit `session:renamed` event
4. Frontend listens for rename event and updates store

**Manual rename** — double-click session title in SessionList:
- Replace title span with an `<input>` (controlled, pre-filled with current title)
- On Enter or blur: save via `workshop:rename-session` IPC
- On Escape: cancel, revert to original title
- Empty input reverts to original title

**New IPC:** `workshop:rename-session` → calls `updateWorkshopSession(dbPath, sessionId, { title })`

**New store action:** `renameSession(sessionId, title)` → IPC call + optimistic local update

**New event listener:** `session:renamed` → update session title in store (for auto-name)

## Files to Modify

| File | Changes |
|------|---------|
| `src/renderer/src/stores/workshopStore.ts` | Add tool activity state, stall timer, rename action, recovery logic |
| `src/renderer/src/components/Workshop/ConversationPanel.tsx` | Dynamic activity indicator, activity log, stall recovery banner |
| `src/renderer/src/components/Workshop/SessionList.tsx` | Inline rename UI (double-click to edit) |
| `src/main/workshop-engine.ts` | Auto-name logic, debounced pending content save, rename method |
| `src/main/db.ts` | Add `pending_content` column migration, recovery query |
| `src/main/index.ts` | Register `workshop:rename-session` and `workshop:recover-session` IPC |
| `src/preload/index.ts` | Expose rename and recover methods, add `onSessionRenamed` listener |
| `src/shared/types.ts` | Add `pendingContent` to `WorkshopSession`, add tool activity to stream event |

## Out of Scope

- Backend-side timeout (SDK level) — frontend recovery is sufficient for now
- Streaming content saved per-message (vs per-session) — overkill for single-stream model
- Session search/filter — separate feature
