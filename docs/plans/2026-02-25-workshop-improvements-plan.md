# Workshop Improvements Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix the workshop's "stuck thinking" UX by surfacing tool activity, adding stall recovery, persisting partial content, and enabling session naming.

**Architecture:** Four independent improvements layered onto the existing Workshop engine + store. Changes span the shared types, DB schema, backend engine, IPC bridge, preload, and frontend store/components. Each task is independently committable.

**Tech Stack:** Electron (main/renderer), Zustand store, SQLite (better-sqlite3), TypeScript, React, Tailwind CSS

---

## Task 1: DB Migration — Add `pending_content` Column

**Files:**
- Modify: `src/main/db.ts:423-429` (add migration function)
- Modify: `src/main/db.ts:133` (call migration after table creation)
- Modify: `src/main/db.ts:470-479` (update rowToWorkshopSession mapper)
- Modify: `src/shared/types.ts:166-174` (add pendingContent to WorkshopSession)

**Step 1: Add `pendingContent` to the shared type**

In `src/shared/types.ts`, add `pendingContent` to `WorkshopSession`:

```typescript
export interface WorkshopSession {
  id: string
  projectId: string
  title: string
  summary: string | null
  pendingContent: string | null   // <-- add this
  status: WorkshopSessionStatus
  createdAt: string
  updatedAt: string
}
```

**Step 2: Add a migration function for workshop_sessions**

In `src/main/db.ts`, after the `migrateProjectsTable` function (around line 436), add:

```typescript
function migrateWorkshopSessionsTable(db: Database.Database): void {
  const cols = db.pragma('table_info(workshop_sessions)') as { name: string }[]
  const colNames = new Set(cols.map(c => c.name))
  if (!colNames.has('pending_content')) {
    db.prepare('ALTER TABLE workshop_sessions ADD COLUMN pending_content TEXT DEFAULT NULL').run()
  }
}
```

**Step 3: Call the migration in `initProjectDb`**

In `src/main/db.ts`, after the `CREATE TABLE workshop_sessions` block (around line 143), add:

```typescript
  migrateWorkshopSessionsTable(db)
```

**Step 4: Update `rowToWorkshopSession` mapper**

In `src/main/db.ts` at line 470, update:

```typescript
function rowToWorkshopSession(row: any): WorkshopSession {
  return {
    id: row.id,
    projectId: row.project_id,
    title: row.title,
    summary: row.summary,
    pendingContent: row.pending_content ?? null,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}
```

**Step 5: Verify build**

Run: `npm run build`
Expected: Clean build, no type errors

**Step 6: Commit**

```bash
git add src/shared/types.ts src/main/db.ts
git commit -m "feat(workshop): add pending_content column migration"
```

---

## Task 2: Backend — Persist Partial Streaming Content

**Files:**
- Modify: `src/main/workshop-engine.ts:128-187` (sendMessage method)

**Step 1: Add debounced pending content save to `sendMessage`**

In `src/main/workshop-engine.ts`, modify the `sendMessage` method. Add a debounce mechanism that saves accumulated streaming text to the DB every 2 seconds during streaming.

Replace the `sendMessage` method (lines 128-187) with:

```typescript
  async sendMessage(sessionId: string, content: string): Promise<void> {
    if (!this.sdkRunner) throw new Error('SDK runner not set')

    createWorkshopMessage(this.dbPath, sessionId, 'user', content)

    const prompt = this.buildPrompt(sessionId, content)
    const resumeSessionId = this.sessionIds.get(sessionId)

    let accumulatedText = ''
    let pendingSaveTimer: ReturnType<typeof setTimeout> | null = null

    const savePendingContent = () => {
      if (accumulatedText) {
        updateWorkshopSession(this.dbPath, sessionId, { pendingContent: accumulatedText })
      }
    }

    const debouncedSave = () => {
      if (pendingSaveTimer) clearTimeout(pendingSaveTimer)
      pendingSaveTimer = setTimeout(savePendingContent, 2000)
    }

    try {
      this.emit('stream', { type: 'text', content: '', sessionId } as WorkshopStreamEvent)

      const result = await this.sdkRunner({
        prompt,
        model: 'claude-sonnet-4-20250514',
        maxTurns: 10,
        cwd: this.projectPath,
        taskId: 0,
        autoMode: true,
        resumeSessionId,
        sessionKey: sessionId,
        onStream: (streamContent: string, streamType: string) => {
          if (streamType === 'tool_use') {
            this.emit('stream', {
              type: 'tool_call',
              toolName: streamContent.replace('Tool: ', ''),
              sessionId,
            } as WorkshopStreamEvent)
          } else {
            accumulatedText += streamContent
            debouncedSave()
            this.emit('stream', {
              type: 'text',
              content: streamContent,
              sessionId,
            } as WorkshopStreamEvent)
          }
        },
        onApprovalRequest: () => {
          return { behavior: 'allow' as const }
        },
      })

      // Clear debounce timer
      if (pendingSaveTimer) clearTimeout(pendingSaveTimer)

      if (result.sessionId) {
        this.sessionIds.set(sessionId, result.sessionId)
      }

      await this.handleToolCalls(sessionId, result)

      // Strip tool_call XML blocks from the displayed message
      const cleanOutput = (result.output ?? '').replace(/<tool_call name="\w+">\s*[\s\S]*?<\/tool_call>/g, '').trim()
      createWorkshopMessage(this.dbPath, sessionId, 'assistant', cleanOutput)

      // Clear pending content now that full message is saved
      updateWorkshopSession(this.dbPath, sessionId, { pendingContent: null })

      this.emit('stream', { type: 'done', sessionId } as WorkshopStreamEvent)
    } catch (error: any) {
      // Clear debounce timer
      if (pendingSaveTimer) clearTimeout(pendingSaveTimer)

      // Save whatever we accumulated as a partial message if there's content
      if (accumulatedText.trim()) {
        createWorkshopMessage(this.dbPath, sessionId, 'assistant', accumulatedText.trim())
      }
      updateWorkshopSession(this.dbPath, sessionId, { pendingContent: null })

      this.emit('stream', {
        type: 'error',
        error: error.message,
        sessionId,
      } as WorkshopStreamEvent)
    }
  }
```

**Step 2: Verify build**

Run: `npm run build`
Expected: Clean build

**Step 3: Commit**

```bash
git add src/main/workshop-engine.ts
git commit -m "feat(workshop): persist streaming content to DB during long responses"
```

---

## Task 3: Frontend — Recover Pending Content on Load

**Files:**
- Modify: `src/renderer/src/stores/workshopStore.ts:84-93` (selectSession)

**Step 1: Add pending content recovery to `selectSession`**

When selecting a session that has `pendingContent` (meaning the app was restarted mid-stream), display it as the final assistant message.

In `workshopStore.ts`, modify `selectSession` (lines 84-93):

```typescript
  selectSession: async (dbPath, sessionId) => {
    const [session, messages] = await Promise.all([
      window.api.workshop.getSession(sessionId),
      window.api.workshop.listMessages(dbPath, sessionId)
    ])

    // Recover pending content from interrupted streaming
    let recoveredMessages = messages
    if (session?.pendingContent) {
      recoveredMessages = [
        ...messages,
        {
          id: 'recovered-' + crypto.randomUUID(),
          sessionId,
          role: 'assistant' as const,
          content: session.pendingContent,
          messageType: 'text' as const,
          metadata: null,
          createdAt: new Date().toISOString()
        }
      ]
      // Clear pending content via IPC
      window.api.workshop.recoverSession(sessionId)
    }

    set({
      currentSessionId: sessionId,
      currentSession: session,
      messages: recoveredMessages,
      isStreaming: false
    })
  },
```

**Step 2: Add `recoverSession` IPC**

In `src/preload/index.ts`, add to the workshop object (after `createTasks`, around line 65):

```typescript
    recoverSession: (sessionId: string) =>
      ipcRenderer.invoke('workshop:recover-session', sessionId),
```

In `src/main/index.ts`, add to `registerWorkshopIpc` (after the `workshop:create-tasks` handler, around line 309):

```typescript
  ipcMain.handle('workshop:recover-session', (_e, sessionId) => {
    if (!currentWorkshopEngine) return
    const session = currentWorkshopEngine.getSession(sessionId)
    if (session?.pendingContent) {
      // Save pending content as a proper message, then clear it
      createWorkshopMessage(currentWorkshopEngine['dbPath'], sessionId, 'assistant', session.pendingContent)
      updateWorkshopSession(currentWorkshopEngine['dbPath'], sessionId, { pendingContent: null })
    }
  })
```

Add the `updateWorkshopSession` import if not already present in index.ts. Check for existing imports:

```typescript
import { ..., updateWorkshopSession, createWorkshopMessage, ... } from './db'
```

**Step 3: Verify build**

Run: `npm run build`
Expected: Clean build

**Step 4: Commit**

```bash
git add src/renderer/src/stores/workshopStore.ts src/preload/index.ts src/main/index.ts
git commit -m "feat(workshop): recover partial content on app restart"
```

---

## Task 4: Frontend — Tool Activity Indicator & Activity Log

**Files:**
- Modify: `src/renderer/src/stores/workshopStore.ts:10-54` (state interface + initial state)
- Modify: `src/renderer/src/stores/workshopStore.ts:166-188` (stream listener)
- Modify: `src/renderer/src/components/Workshop/ConversationPanel.tsx:5-16` (store selectors + scroll deps)
- Modify: `src/renderer/src/components/Workshop/ConversationPanel.tsx:51-70` (streaming/thinking UI)

**Step 1: Add tool activity state to the store interface**

In `workshopStore.ts`, add to the `WorkshopState` interface (around line 20, after `isStreaming`):

```typescript
  currentToolActivity: string | null
  toolActivityLog: string[]
```

And add initial values (around line 51, after `isStreaming: false`):

```typescript
  currentToolActivity: null,
  toolActivityLog: [],
```

**Step 2: Handle tool_call events in the stream listener**

In `workshopStore.ts`, modify the `onStream` callback inside `setupListeners` (lines 166-188). Add a `tool_call` handler and reset activity on `done`/`error`:

```typescript
    const cleanupStream = window.api.workshop.onStream((event: WorkshopStreamEvent) => {
      const state = get()
      if (event.type === 'text' && event.content) {
        set({ streamingContent: state.streamingContent + event.content })
      } else if (event.type === 'tool_call' && event.toolName) {
        const TOOL_VERBS: Record<string, string> = {
          Read: 'reading files',
          Grep: 'searching code',
          Glob: 'finding files',
          Write: 'writing files',
          Edit: 'editing files',
          Bash: 'running a command',
          WebFetch: 'fetching web content',
          WebSearch: 'searching the web',
          Task: 'delegating work',
          LS: 'listing directory',
        }
        const verb = TOOL_VERBS[event.toolName] ?? `using ${event.toolName}`
        set({
          currentToolActivity: verb,
          toolActivityLog: [...state.toolActivityLog, event.toolName]
        })
      } else if (event.type === 'done') {
        const assistantMsg: WorkshopMessage = {
          id: crypto.randomUUID(),
          sessionId: event.sessionId ?? state.currentSessionId ?? '',
          role: 'assistant',
          content: state.streamingContent,
          messageType: 'text',
          metadata: null,
          createdAt: new Date().toISOString()
        }
        set((s) => ({
          messages: [...s.messages, assistantMsg],
          streamingContent: '',
          isStreaming: false,
          currentToolActivity: null,
          toolActivityLog: []
        }))
      } else if (event.type === 'error') {
        set({ isStreaming: false, streamingContent: '', currentToolActivity: null, toolActivityLog: [] })
      }
    })
```

**Step 3: Update `sendMessage` to reset activity state**

In `workshopStore.ts`, in the `sendMessage` action (line 106), add resets:

```typescript
    set((state) => ({
      messages: [...state.messages, userMsg],
      isStreaming: true,
      streamingContent: '',
      currentToolActivity: null,
      toolActivityLog: []
    }))
```

**Step 4: Update ConversationPanel with dynamic activity indicator**

In `ConversationPanel.tsx`, add store selectors (after the existing ones, around line 9):

```typescript
  const currentToolActivity = useWorkshopStore((s) => s.currentToolActivity)
  const toolActivityLog = useWorkshopStore((s) => s.toolActivityLog)
```

Update the scroll dependency (line 16):

```typescript
  }, [messages, streamingContent, toolActivityLog])
```

Replace the thinking indicator block (lines 65-70) with:

```tsx
        {isStreaming && !streamingContent && (
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-text-muted text-sm">
              <div className="w-2 h-2 rounded-full bg-accent-teal animate-pulse" />
              Claude is {currentToolActivity ?? 'thinking'}...
            </div>
            {toolActivityLog.length > 0 && (
              <div className="ml-4 space-y-0.5 max-h-24 overflow-y-auto">
                {toolActivityLog.slice(-5).map((tool, i) => (
                  <div key={i} className="text-xs text-text-muted/60 font-mono">
                    &gt; {tool}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
```

**Step 5: Verify build**

Run: `npm run build`
Expected: Clean build

**Step 6: Commit**

```bash
git add src/renderer/src/stores/workshopStore.ts src/renderer/src/components/Workshop/ConversationPanel.tsx
git commit -m "feat(workshop): show tool activity instead of static thinking indicator"
```

---

## Task 5: Frontend — Stall Detection & Recovery

**Files:**
- Modify: `src/renderer/src/stores/workshopStore.ts` (stall timer logic)
- Modify: `src/renderer/src/components/Workshop/ConversationPanel.tsx` (recovery banner)

**Step 1: Add stall detection state to the store**

In `workshopStore.ts`, add to the interface (after `toolActivityLog`):

```typescript
  isStalled: boolean
```

Add initial value:

```typescript
  isStalled: false,
```

**Step 2: Add stall timer logic to the stream listener**

In `workshopStore.ts`, modify `setupListeners`. Add a timer variable outside the callback, and manage it within:

```typescript
  setupListeners: () => {
    let stallTimer: ReturnType<typeof setTimeout> | null = null

    const resetStallTimer = () => {
      if (stallTimer) clearTimeout(stallTimer)
      set({ isStalled: false })
      stallTimer = setTimeout(() => {
        if (get().isStreaming) {
          set({ isStalled: true })
        }
      }, 60000)
    }

    const clearStallTimer = () => {
      if (stallTimer) clearTimeout(stallTimer)
      stallTimer = null
      set({ isStalled: false })
    }

    const cleanupStream = window.api.workshop.onStream((event: WorkshopStreamEvent) => {
      const state = get()

      // Reset stall timer on any event
      if (state.isStreaming && (event.type === 'text' || event.type === 'tool_call')) {
        resetStallTimer()
      }

      if (event.type === 'text' && event.content) {
        set({ streamingContent: state.streamingContent + event.content })
      } else if (event.type === 'tool_call' && event.toolName) {
        // ... tool activity handling (same as Task 4) ...
      } else if (event.type === 'done') {
        clearStallTimer()
        // ... done handling (same as Task 4, already includes isStreaming: false) ...
      } else if (event.type === 'error') {
        clearStallTimer()
        set({ isStreaming: false, streamingContent: '', currentToolActivity: null, toolActivityLog: [], isStalled: false })
      }
    })

    // ... rest of setupListeners ...

    return () => {
      clearStallTimer()
      cleanupStream()
      cleanupToolEvent()
    }
  }
```

Also update `sendMessage` to start the stall timer:

```typescript
  sendMessage: async (sessionId, content) => {
    // ... existing code to build userMsg ...
    set((state) => ({
      messages: [...state.messages, userMsg],
      isStreaming: true,
      streamingContent: '',
      currentToolActivity: null,
      toolActivityLog: [],
      isStalled: false
    }))
    await window.api.workshop.sendMessage(sessionId, content)
  },
```

Update `stopSession` to clear stall state:

```typescript
  stopSession: (sessionId) => {
    window.api.workshop.stopSession(sessionId)
    set({ isStreaming: false, streamingContent: '', currentToolActivity: null, toolActivityLog: [], isStalled: false })
  },
```

**Step 3: Add recovery banner to ConversationPanel**

In `ConversationPanel.tsx`, add the `isStalled` selector:

```typescript
  const isStalled = useWorkshopStore((s) => s.isStalled)
```

Add a stall recovery banner after the thinking indicator block (inside the `{isStreaming && !streamingContent && (` block, or right after it):

```tsx
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
                // Dismiss and reset the 60s timer (the stream listener will pick it up)
                useWorkshopStore.setState({ isStalled: false })
              }}
              className="px-2 py-1 rounded bg-surface text-text-muted hover:text-text text-xs font-medium transition-colors"
            >
              Keep Waiting
            </button>
          </div>
        )}
```

**Step 4: Verify build**

Run: `npm run build`
Expected: Clean build

**Step 5: Commit**

```bash
git add src/renderer/src/stores/workshopStore.ts src/renderer/src/components/Workshop/ConversationPanel.tsx
git commit -m "feat(workshop): add 60s stall detection with recovery banner"
```

---

## Task 6: Backend — Session Auto-Naming

**Files:**
- Modify: `src/main/workshop-engine.ts:128-187` (after done event in sendMessage)
- Modify: `src/main/workshop-engine.ts:59-63` (startSession — add rename method)

**Step 1: Add a `renameSession` method to the engine**

In `workshop-engine.ts`, after the `getSession` method (around line 124), add:

```typescript
  renameSession(sessionId: string, title: string): WorkshopSession | null {
    const updated = updateWorkshopSession(this.dbPath, sessionId, { title })
    if (updated) {
      this.emit('session:renamed', { sessionId, title })
    }
    return updated
  }
```

**Step 2: Add auto-naming after first response**

In `workshop-engine.ts`, modify `sendMessage`. After `this.emit('stream', { type: 'done', sessionId })` (around line 179), add the auto-naming logic:

```typescript
      this.emit('stream', { type: 'done', sessionId } as WorkshopStreamEvent)

      // Auto-name the session after first assistant response
      const session = getWorkshopSession(this.dbPath, sessionId)
      if (session && session.title === 'New Session' && this.sdkRunner) {
        const messages = listWorkshopMessages(this.dbPath, sessionId)
        const firstUserMsg = messages.find(m => m.role === 'user')
        if (firstUserMsg) {
          try {
            const nameResult = await this.sdkRunner({
              prompt: `Generate a concise 3-5 word title for this conversation. Only output the title, nothing else:\n\n${firstUserMsg.content.slice(0, 500)}`,
              model: 'claude-haiku-4-5-20251001',
              maxTurns: 1,
              cwd: this.projectPath,
              taskId: 0,
              autoMode: true,
              onStream: () => {},
              onApprovalRequest: () => ({ behavior: 'allow' as const }),
            })
            if (nameResult.output) {
              const title = nameResult.output.trim().replace(/^["']|["']$/g, '')
              this.renameSession(sessionId, title)
            }
          } catch {
            // Auto-naming failure is non-critical, silently ignore
          }
        }
      }
```

**Step 3: Verify build**

Run: `npm run build`
Expected: Clean build

**Step 4: Commit**

```bash
git add src/main/workshop-engine.ts
git commit -m "feat(workshop): auto-name sessions after first exchange using Haiku"
```

---

## Task 7: IPC & Preload — Rename Session + Event Bridge

**Files:**
- Modify: `src/main/index.ts:233-256` (ensureWorkshopEngine — add session:renamed listener)
- Modify: `src/main/index.ts:258-310` (registerWorkshopIpc — add rename handler)
- Modify: `src/preload/index.ts:43-76` (add renameSession + onSessionRenamed)

**Step 1: Add `session:renamed` event bridge**

In `src/main/index.ts`, inside `ensureWorkshopEngine` (around line 253, after the `task:created` listener), add:

```typescript
    currentWorkshopEngine.on('session:renamed', (data) => {
      mainWindow?.webContents.send('workshop:session-renamed', data)
    })
```

**Step 2: Add rename IPC handler**

In `src/main/index.ts`, inside `registerWorkshopIpc` (after the last handler, around line 309), add:

```typescript
  ipcMain.handle('workshop:rename-session', (_e, sessionId, title) => {
    return currentWorkshopEngine?.renameSession(sessionId, title) ?? null
  })
```

**Step 3: Update preload bridge**

In `src/preload/index.ts`, add to the workshop object (after `recoverSession`):

```typescript
    renameSession: (sessionId: string, title: string) =>
      ipcRenderer.invoke('workshop:rename-session', sessionId, title),
    onSessionRenamed: (callback: (data: { sessionId: string; title: string }) => void) => {
      const handler = (_e: any, data: any) => callback(data)
      ipcRenderer.on('workshop:session-renamed', handler)
      return () => { ipcRenderer.removeListener('workshop:session-renamed', handler) }
    },
```

**Step 4: Verify build**

Run: `npm run build`
Expected: Clean build

**Step 5: Commit**

```bash
git add src/main/index.ts src/preload/index.ts
git commit -m "feat(workshop): add rename session IPC and event bridge"
```

---

## Task 8: Frontend Store — Rename Action + Auto-Rename Listener

**Files:**
- Modify: `src/renderer/src/stores/workshopStore.ts` (add renameSession action + listener)

**Step 1: Add `renameSession` to the store interface**

In the `WorkshopState` interface, add (after `deleteSession`):

```typescript
  renameSession: (sessionId: string, title: string) => Promise<void>
```

**Step 2: Implement the action**

In the store implementation, add (after `deleteSession`):

```typescript
  renameSession: async (sessionId, title) => {
    // Optimistic update
    set((state) => ({
      sessions: state.sessions.map((s) =>
        s.id === sessionId ? { ...s, title } : s
      ),
      currentSession:
        state.currentSession?.id === sessionId
          ? { ...state.currentSession, title }
          : state.currentSession
    }))
    await window.api.workshop.renameSession(sessionId, title)
  },
```

**Step 3: Add auto-rename listener in `setupListeners`**

In `setupListeners`, after the `cleanupToolEvent` setup, add:

```typescript
    const cleanupRenamed = window.api.workshop.onSessionRenamed((data: { sessionId: string; title: string }) => {
      set((state) => ({
        sessions: state.sessions.map((s) =>
          s.id === data.sessionId ? { ...s, title: data.title } : s
        ),
        currentSession:
          state.currentSession?.id === data.sessionId
            ? { ...state.currentSession, title: data.title }
            : state.currentSession
      }))
    })
```

Update the cleanup return:

```typescript
    return () => {
      clearStallTimer()
      cleanupStream()
      cleanupToolEvent()
      cleanupRenamed()
    }
```

**Step 4: Verify build**

Run: `npm run build`
Expected: Clean build

**Step 5: Commit**

```bash
git add src/renderer/src/stores/workshopStore.ts
git commit -m "feat(workshop): add rename action and auto-rename listener to store"
```

---

## Task 9: Frontend — Session List Inline Rename UI

**Files:**
- Modify: `src/renderer/src/components/Workshop/SessionList.tsx:68-134` (SessionItem component)

**Step 1: Add inline rename to SessionItem**

Replace the `SessionItem` component with one that supports double-click rename:

```tsx
function SessionItem({
  session,
  isActive,
  isStreamingHere,
  onClick,
  onStop,
  onDelete,
}: {
  session: WorkshopSession
  isActive: boolean
  isStreamingHere: boolean
  onClick: () => void
  onStop: (e: React.MouseEvent) => void
  onDelete: (e: React.MouseEvent) => void
}) {
  const [isEditing, setIsEditing] = useState(false)
  const [editTitle, setEditTitle] = useState(session.title)
  const inputRef = useRef<HTMLInputElement>(null)
  const date = new Date(session.createdAt)
  const timeStr = date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [isEditing])

  // Keep editTitle in sync when title changes externally (e.g., auto-rename)
  useEffect(() => {
    if (!isEditing) setEditTitle(session.title)
  }, [session.title, isEditing])

  const handleDoubleClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    setIsEditing(true)
  }

  const handleSave = () => {
    const trimmed = editTitle.trim()
    if (trimmed && trimmed !== session.title) {
      useWorkshopStore.getState().renameSession(session.id, trimmed)
    } else {
      setEditTitle(session.title)
    }
    setIsEditing(false)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      handleSave()
    } else if (e.key === 'Escape') {
      setEditTitle(session.title)
      setIsEditing(false)
    }
  }

  return (
    <button
      onClick={onClick}
      className={`group w-full text-left px-3 py-3 border-b border-border/50 transition-colors ${
        isActive ? 'bg-accent-teal/10 border-l-2 border-l-accent-teal' : 'hover:bg-surface'
      }`}
    >
      <div className="flex items-center justify-between">
        {isEditing ? (
          <input
            ref={inputRef}
            value={editTitle}
            onChange={(e) => setEditTitle(e.target.value)}
            onBlur={handleSave}
            onKeyDown={handleKeyDown}
            onClick={(e) => e.stopPropagation()}
            className="text-sm font-medium flex-1 bg-surface border border-accent-teal rounded px-1.5 py-0.5 text-text focus:outline-none"
          />
        ) : (
          <span
            onDoubleClick={handleDoubleClick}
            className={`text-sm font-medium truncate flex-1 ${isActive ? 'text-accent-teal' : 'text-text'}`}
            title="Double-click to rename"
          >
            {isStreamingHere && (
              <span className="inline-block w-2 h-2 rounded-full bg-accent-teal animate-pulse mr-1.5 align-middle" />
            )}
            {session.title}
          </span>
        )}
        <div className="flex items-center gap-1 ml-1 shrink-0">
          {isStreamingHere && (
            <span
              onClick={onStop}
              title="Stop generation"
              className="p-0.5 rounded hover:bg-red-500/20 text-text-muted hover:text-red-400 transition-colors"
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                <rect x="3" y="3" width="10" height="10" rx="1" />
              </svg>
            </span>
          )}
          {!isStreamingHere && (
            <span
              onClick={onDelete}
              title="Delete session"
              className="p-0.5 rounded hover:bg-red-500/20 text-text-muted hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all"
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M5 4V3a1 1 0 011-1h4a1 1 0 011 1v1M2 4h12M6 7v5M10 7v5M3 4l1 9a1 1 0 001 1h6a1 1 0 001-1l1-9" />
              </svg>
            </span>
          )}
          {session.status === 'ended' && (
            <span className="text-xs text-text-muted">ended</span>
          )}
        </div>
      </div>
      <p className="text-xs text-text-muted mt-1">{timeStr}</p>
      {session.summary && (
        <p className="text-xs text-text-muted mt-1 truncate">{session.summary}</p>
      )}
    </button>
  )
}
```

Note: Add `useState, useRef, useEffect` to the imports at the top of the file, and import `useWorkshopStore`:

```typescript
import { useState, useRef, useEffect } from 'react'
import { useWorkshopStore } from '../../stores/workshopStore'
import { useProjectStore } from '../../stores/projectStore'
import type { WorkshopSession } from '../../../../shared/types'
```

**Step 2: Verify build**

Run: `npm run build`
Expected: Clean build

**Step 3: Commit**

```bash
git add src/renderer/src/components/Workshop/SessionList.tsx
git commit -m "feat(workshop): add inline rename via double-click on session title"
```

---

## Task 10: Final Build Verification

**Step 1: Clean build**

```bash
rm -rf dist/ .turbo/ node_modules/.cache/
npm run build
```

Expected: Clean build with no errors

**Step 2: Manual smoke test**

1. Start the app, open Workshop
2. Create a new session — should be named "New Session"
3. Send a message — should see "Claude is reading files..." / "Claude is searching code..." during tool use, with an activity log below
4. Wait for response — session title should auto-update to a descriptive name
5. Double-click session title in sidebar — should enter inline edit mode
6. Type a new name, press Enter — should save
7. Press Escape while editing — should cancel
8. During a long response, if 60s passes with no events, a stall recovery banner should appear
9. Kill and restart the app mid-stream — on reload, the partial content should appear as the last message

**Step 3: Final commit (if any adjustments needed)**

```bash
git add -A
git commit -m "chore(workshop): final adjustments from smoke test"
```
