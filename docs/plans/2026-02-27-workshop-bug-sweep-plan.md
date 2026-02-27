# Workshop Bug Sweep Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix all critical, high, and medium bugs in the Workshop layer — engine, IPC handlers, store, and UI components — so that errors propagate to users, edge cases don't crash the app, and the chat experience is resilient.

**Architecture:** A thin `safeIpc()` wrapper in the Zustand store catches all IPC errors and writes them to a shared `error` field. A single `WorkshopErrorBanner` component reads that field and auto-dismisses. Engine-level bugs (null guards, regex, listener leaks) are fixed surgically at the source. No new dependencies.

**Tech Stack:** TypeScript, Electron IPC, Zustand, React

---

### Task 1: Add error state + `safeIpc` wrapper to workshopStore

**Files:**
- Modify: `src/renderer/src/stores/workshopStore.ts:13-56` (WorkshopState interface) and throughout

**Step 1: Add error state fields to the store interface**

In `src/renderer/src/stores/workshopStore.ts`, add `error` and `clearError` to the `WorkshopState` interface (after line 34):

```typescript
// After line 34 (discussRound: number)
error: string | null

clearError: () => void
```

**Step 2: Add the error default and clearError action**

In the store creation (after line 107, `discussRound: 0,`):

```typescript
// After discussRound: 0,
error: null,
```

And add the `clearError` action (can go right after `toggleAutoMode`):

```typescript
clearError: () => set({ error: null }),
```

**Step 3: Create the `safeIpc` helper inside the store file**

Add this function above the `useWorkshopStore` creation (before line 86):

```typescript
async function safeIpc<T>(
  fn: () => Promise<T>,
  fallback: T,
  errorMsg?: string
): Promise<T> {
  try {
    return await fn()
  } catch (err: any) {
    console.error('[Workshop IPC]', err)
    useWorkshopStore.setState({
      error: errorMsg ?? err?.message ?? 'Something went wrong'
    })
    return fallback
  }
}
```

**Step 4: Verify the build compiles**

Run: `cd C:\Users\dutte\OneDrive\Desktop\Projects\ClawFlow && pnpm build`
Expected: Build succeeds (new fields are additive — nothing references them yet)

**Step 5: Commit**

```bash
git add src/renderer/src/stores/workshopStore.ts
git commit -m "feat(workshop): add error state and safeIpc wrapper to store"
```

---

### Task 2: Wrap all store IPC calls with `safeIpc` and add error recovery

**Files:**
- Modify: `src/renderer/src/stores/workshopStore.ts:109-313`

**Step 1: Wrap `loadSessions`** (line 109-112)

Replace:
```typescript
  loadSessions: async (dbPath, projectPath, projectId, projectName) => {
    const sessions = await window.api.workshop.listSessions(dbPath, projectPath, projectId, projectName)
    set({ sessions })
  },
```
With:
```typescript
  loadSessions: async (dbPath, projectPath, projectId, projectName) => {
    const sessions = await safeIpc(
      () => window.api.workshop.listSessions(dbPath, projectPath, projectId, projectName),
      [] as any[],
      'Failed to load sessions'
    )
    set({ sessions })
  },
```

**Step 2: Wrap `startSession`** (line 114-122)

Replace:
```typescript
  startSession: async (dbPath, projectPath, projectId, projectName, title?) => {
    const session = await window.api.workshop.startSession(dbPath, projectPath, projectId, projectName, title)
    set((state) => ({
      sessions: [session, ...state.sessions],
      currentSessionId: session.id,
      currentSession: session,
      messages: []
    }))
  },
```
With:
```typescript
  startSession: async (dbPath, projectPath, projectId, projectName, title?) => {
    const session = await safeIpc(
      () => window.api.workshop.startSession(dbPath, projectPath, projectId, projectName, title),
      null as any,
      'Failed to start session'
    )
    if (!session) return
    set((state) => ({
      sessions: [session, ...state.sessions],
      currentSessionId: session.id,
      currentSession: session,
      messages: []
    }))
  },
```

**Step 3: Wrap `startPanelSession`** (line 124-135)

Replace:
```typescript
  startPanelSession: async (dbPath, projectPath, projectId, projectName, title, panelPersonas) => {
    const session = await window.api.workshop.startPanelSession(dbPath, projectPath, projectId, projectName, title, panelPersonas)
    set((state) => ({
      sessions: [session, ...state.sessions],
      currentSessionId: session.id,
      currentSession: session,
      messages: [],
      streamingContent: '',
      sessionTokens: { input: 0, output: 0 },
      discussRound: 0
    }))
  },
```
With:
```typescript
  startPanelSession: async (dbPath, projectPath, projectId, projectName, title, panelPersonas) => {
    const session = await safeIpc(
      () => window.api.workshop.startPanelSession(dbPath, projectPath, projectId, projectName, title, panelPersonas),
      null as any,
      'Failed to start panel session'
    )
    if (!session) return
    set((state) => ({
      sessions: [session, ...state.sessions],
      currentSessionId: session.id,
      currentSession: session,
      messages: [],
      streamingContent: '',
      sessionTokens: { input: 0, output: 0 },
      discussRound: 0
    }))
  },
```

**Step 4: Wrap `endSession`** (line 137-148)

Replace:
```typescript
  endSession: async (sessionId) => {
    await window.api.workshop.endSession(sessionId)
```
With:
```typescript
  endSession: async (sessionId) => {
    await safeIpc(
      () => window.api.workshop.endSession(sessionId),
      undefined,
      'Failed to end session'
    )
```

**Step 5: Wrap `selectSession`** (line 150-188)

Replace:
```typescript
  selectSession: async (dbPath, sessionId) => {
    const [session, messages] = await Promise.all([
      window.api.workshop.getSession(sessionId),
      window.api.workshop.listMessages(dbPath, sessionId)
    ])
```
With:
```typescript
  selectSession: async (dbPath, sessionId) => {
    const [session, messages] = await safeIpc(
      () => Promise.all([
        window.api.workshop.getSession(sessionId),
        window.api.workshop.listMessages(dbPath, sessionId)
      ]),
      [null, []] as [any, any[]],
      'Failed to load session'
    )
    if (!session) return
```

**Step 6: Wrap `sendMessage` with error recovery** (line 190-211)

Replace:
```typescript
  sendMessage: async (sessionId, content) => {
    const userMsg: WorkshopMessage = {
      id: crypto.randomUUID(),
      sessionId,
      role: 'user',
      content,
      messageType: 'text',
      metadata: null,
      createdAt: new Date().toISOString()
    }
    set((state) => ({
      messages: [...state.messages, userMsg],
      isStreaming: true,
      streamingContent: '',
      streamingSegments: [],
      streamingToolCalls: [],
      currentToolActivity: null,
      toolActivityLog: [],
      isStalled: false
    }))
    await window.api.workshop.sendMessage(sessionId, content)
  },
```
With:
```typescript
  sendMessage: async (sessionId, content) => {
    const userMsg: WorkshopMessage = {
      id: crypto.randomUUID(),
      sessionId,
      role: 'user',
      content,
      messageType: 'text',
      metadata: null,
      createdAt: new Date().toISOString()
    }
    set((state) => ({
      messages: [...state.messages, userMsg],
      isStreaming: true,
      streamingContent: '',
      streamingSegments: [],
      streamingToolCalls: [],
      currentToolActivity: null,
      toolActivityLog: [],
      isStalled: false
    }))
    try {
      await window.api.workshop.sendMessage(sessionId, content)
    } catch (err: any) {
      console.error('[Workshop] sendMessage failed:', err)
      set({
        isStreaming: false,
        streamingContent: '',
        currentToolActivity: null,
        toolActivityLog: [],
        isStalled: false,
        error: err?.message ?? 'Failed to send message'
      })
    }
  },
```

**Step 7: Wrap `sendPanelMessage` with error recovery** (line 213-235)

Replace:
```typescript
    await window.api.workshop.sendPanelMessage(sessionId, content)
```
With:
```typescript
    try {
      await window.api.workshop.sendPanelMessage(sessionId, content)
    } catch (err: any) {
      console.error('[Workshop] sendPanelMessage failed:', err)
      set({
        isStreaming: false,
        streamingContent: '',
        currentToolActivity: null,
        error: err?.message ?? 'Failed to send panel message'
      })
    }
```

**Step 8: Wrap `triggerDiscuss`** (line 237-240)

Replace:
```typescript
  triggerDiscuss: async (sessionId) => {
    set({ isStreaming: true, streamingContent: '' })
    await window.api.workshop.triggerDiscuss(sessionId)
  },
```
With:
```typescript
  triggerDiscuss: async (sessionId) => {
    set({ isStreaming: true, streamingContent: '' })
    try {
      await window.api.workshop.triggerDiscuss(sessionId)
    } catch (err: any) {
      console.error('[Workshop] triggerDiscuss failed:', err)
      set({
        isStreaming: false,
        streamingContent: '',
        error: err?.message ?? 'Failed to trigger discussion'
      })
    }
  },
```

**Step 9: Wrap `renameSession`** (line 263-274)

Replace:
```typescript
    await window.api.workshop.renameSession(sessionId, title)
```
With:
```typescript
    await safeIpc(
      () => window.api.workshop.renameSession(sessionId, title),
      null,
      'Failed to rename session'
    )
```

**Step 10: Wrap `loadArtifacts`** (line 276-283)

Replace:
```typescript
    const artifacts = await window.api.workshop.listArtifacts()
```
With:
```typescript
    const artifacts = await safeIpc(
      () => window.api.workshop.listArtifacts(),
      [] as any[],
      'Failed to load artifacts'
    )
```

**Step 11: Fix `selectArtifact` — surface error instead of swallowing** (line 285-293)

Replace:
```typescript
  selectArtifact: async (artifactId) => {
    set({ selectedArtifactId: artifactId, artifactLoading: true, artifactContent: null })
    try {
      const result = await window.api.workshop.getArtifact(artifactId)
      set({ artifactContent: result.content ?? null, artifactLoading: false })
    } catch {
      set({ artifactLoading: false })
    }
  },
```
With:
```typescript
  selectArtifact: async (artifactId) => {
    set({ selectedArtifactId: artifactId, artifactLoading: true, artifactContent: null })
    const result = await safeIpc(
      () => window.api.workshop.getArtifact(artifactId),
      { artifact: null, content: null } as { artifact: any; content: string | null },
      'Failed to load artifact'
    )
    set({ artifactContent: result.content ?? null, artifactLoading: false })
  },
```

**Step 12: Wrap `approveSuggestions`** (line 297-300)

Replace:
```typescript
    await window.api.workshop.createTasks(sessionId, tasks.map((t) => ({ ...t, autoMode })))
```
With:
```typescript
    await safeIpc(
      () => window.api.workshop.createTasks(sessionId, tasks.map((t) => ({ ...t, autoMode }))),
      undefined,
      'Failed to create tasks'
    )
```

**Step 13: Surface stream error messages** (line 467-469)

Replace:
```typescript
      } else if (event.type === 'error') {
        clearStallTimer()
        set({ isStreaming: false, streamingContent: '', currentToolActivity: null, toolActivityLog: [], isStalled: false })
      }
```
With:
```typescript
      } else if (event.type === 'error') {
        clearStallTimer()
        set({
          isStreaming: false,
          streamingContent: '',
          currentToolActivity: null,
          toolActivityLog: [],
          isStalled: false,
          error: event.error ?? 'An error occurred during streaming'
        })
      }
```

**Step 14: Fix stale artifact cache** (line 279-281)

Replace:
```typescript
    if (artifacts.length === 0 && prev.length > 0) {
      return
    }
```
With:
```typescript
    // Always update — don't preserve stale data when backend returns empty
```

(Just delete the guard block entirely.)

**Step 15: Verify the build compiles**

Run: `cd C:\Users\dutte\OneDrive\Desktop\Projects\ClawFlow && pnpm build`
Expected: Build succeeds

**Step 16: Commit**

```bash
git add src/renderer/src/stores/workshopStore.ts
git commit -m "fix(workshop): wrap all IPC calls with safeIpc, surface errors to store"
```

---

### Task 3: Create WorkshopErrorBanner component

**Files:**
- Create: `src/renderer/src/components/Workshop/WorkshopErrorBanner.tsx`

**Step 1: Create the error banner component**

Create `src/renderer/src/components/Workshop/WorkshopErrorBanner.tsx`:

```typescript
import { useEffect } from 'react'
import { useWorkshopStore } from '../../stores/workshopStore'

export function WorkshopErrorBanner() {
  const error = useWorkshopStore((s) => s.error)
  const clearError = useWorkshopStore((s) => s.clearError)

  useEffect(() => {
    if (!error) return
    const timer = setTimeout(clearError, 8000)
    return () => clearTimeout(timer)
  }, [error, clearError])

  if (!error) return null

  return (
    <div className="mx-4 mt-2 px-4 py-2.5 rounded-lg bg-accent-magenta/10 border border-accent-magenta/30 flex items-center justify-between gap-3 text-sm animate-in fade-in slide-in-from-top-1 duration-200">
      <span className="text-accent-magenta">{error}</span>
      <button
        onClick={clearError}
        className="text-text-muted hover:text-text text-xs shrink-0 transition-colors"
      >
        Dismiss
      </button>
    </div>
  )
}
```

**Step 2: Wire it into the Workshop layout**

Find the file that renders `<ConversationPanel>` and add the banner above it. Search for the parent Workshop component:

```bash
cd C:\Users\dutte\OneDrive\Desktop\Projects\ClawFlow && grep -rn "ConversationPanel" src/renderer/src --include="*.tsx" -l
```

Add `import { WorkshopErrorBanner } from './WorkshopErrorBanner'` and render `<WorkshopErrorBanner />` directly above the `<ConversationPanel />` inside the main flex container. The banner should be inside the same column so it appears between the header and chat.

**Step 3: Verify the build compiles**

Run: `cd C:\Users\dutte\OneDrive\Desktop\Projects\ClawFlow && pnpm build`
Expected: Build succeeds

**Step 4: Commit**

```bash
git add src/renderer/src/components/Workshop/WorkshopErrorBanner.tsx
git add -A src/renderer/src/components/Workshop/
git commit -m "feat(workshop): add WorkshopErrorBanner for user-facing error messages"
```

---

### Task 4: Harden IPC handlers in main process

**Files:**
- Modify: `src/main/index.ts:314-429`

**Step 1: Add listener cleanup in `ensureWorkshopEngine`** (line 314-340)

Replace:
```typescript
function ensureWorkshopEngine(dbPath: string, projectPath: string, projectId: string, projectName: string): WorkshopEngine {
  if (!currentWorkshopEngine || currentWorkshopEngine['dbPath'] !== dbPath) {
    currentWorkshopEngine = new WorkshopEngine(dbPath, projectPath, projectId, projectName)
```
With:
```typescript
function ensureWorkshopEngine(dbPath: string, projectPath: string, projectId: string, projectName: string): WorkshopEngine {
  if (!currentWorkshopEngine || currentWorkshopEngine['dbPath'] !== dbPath) {
    // Clean up old listeners to prevent memory leaks on project switch
    if (currentWorkshopEngine) {
      currentWorkshopEngine.removeAllListeners()
    }
    currentWorkshopEngine = new WorkshopEngine(dbPath, projectPath, projectId, projectName)
```

**Step 2: Add null guards with explicit throws to IPC handlers**

Replace the `workshop:end-session` handler (line 348-350):
```typescript
  ipcMain.handle('workshop:end-session', async (_e, sessionId) => {
    await currentWorkshopEngine?.endSession(sessionId)
  })
```
With:
```typescript
  ipcMain.handle('workshop:end-session', async (_e, sessionId) => {
    if (!currentWorkshopEngine) throw new Error('Workshop not initialized')
    await currentWorkshopEngine.endSession(sessionId)
  })
```

Replace the `workshop:stop-session` handler (line 352-354):
```typescript
  ipcMain.handle('workshop:stop-session', (_e, sessionId) => {
    currentWorkshopEngine?.stopSession(sessionId)
  })
```
With:
```typescript
  ipcMain.handle('workshop:stop-session', (_e, sessionId) => {
    if (!currentWorkshopEngine) throw new Error('Workshop not initialized')
    currentWorkshopEngine.stopSession(sessionId)
  })
```

Replace the `workshop:delete-session` handler (line 356-358):
```typescript
  ipcMain.handle('workshop:delete-session', (_e, sessionId) => {
    currentWorkshopEngine?.deleteSession(sessionId)
  })
```
With:
```typescript
  ipcMain.handle('workshop:delete-session', (_e, sessionId) => {
    if (!currentWorkshopEngine) throw new Error('Workshop not initialized')
    currentWorkshopEngine.deleteSession(sessionId)
  })
```

Replace the `workshop:send-message` handler (line 369-371):
```typescript
  ipcMain.handle('workshop:send-message', async (_e, sessionId, content) => {
    await currentWorkshopEngine?.sendMessage(sessionId, content)
  })
```
With:
```typescript
  ipcMain.handle('workshop:send-message', async (_e, sessionId, content) => {
    if (!currentWorkshopEngine) throw new Error('Workshop not initialized')
    await currentWorkshopEngine.sendMessage(sessionId, content)
  })
```

Replace the `workshop:create-tasks` handler (line 388-393):
```typescript
  ipcMain.handle('workshop:create-tasks', async (_e, sessionId, tasks) => {
    if (!currentWorkshopEngine) return
    for (const task of tasks) {
      await currentWorkshopEngine.createPipelineTask(sessionId, task)
    }
  })
```
With:
```typescript
  ipcMain.handle('workshop:create-tasks', async (_e, sessionId, tasks) => {
    if (!currentWorkshopEngine) throw new Error('Workshop not initialized')
    let created = 0
    for (const task of tasks) {
      try {
        await currentWorkshopEngine.createPipelineTask(sessionId, task)
        created++
      } catch (err: any) {
        console.error(`[Workshop] Failed to create task ${created + 1}/${tasks.length}:`, err.message)
        throw new Error(`Created ${created}/${tasks.length} tasks. Failed on: ${err.message}`)
      }
    }
  })
```

Replace the `workshop:send-panel-message` handler (line 416-421):
```typescript
  ipcMain.handle(
    'workshop:send-panel-message',
    async (_e, sessionId, content) => {
      await currentWorkshopEngine?.sendPanelMessage(sessionId, content)
    }
  )
```
With:
```typescript
  ipcMain.handle(
    'workshop:send-panel-message',
    async (_e, sessionId, content) => {
      if (!currentWorkshopEngine) throw new Error('Workshop not initialized')
      await currentWorkshopEngine.sendPanelMessage(sessionId, content)
    }
  )
```

Replace the `workshop:trigger-discuss` handler (line 423-428):
```typescript
  ipcMain.handle(
    'workshop:trigger-discuss',
    async (_e, sessionId) => {
      await currentWorkshopEngine?.triggerDiscuss(sessionId)
    }
  )
```
With:
```typescript
  ipcMain.handle(
    'workshop:trigger-discuss',
    async (_e, sessionId) => {
      if (!currentWorkshopEngine) throw new Error('Workshop not initialized')
      await currentWorkshopEngine.triggerDiscuss(sessionId)
    }
  )
```

**Step 3: Verify the build compiles**

Run: `cd C:\Users\dutte\OneDrive\Desktop\Projects\ClawFlow && pnpm build`
Expected: Build succeeds

**Step 4: Commit**

```bash
git add src/main/index.ts
git commit -m "fix(workshop): add listener cleanup and null guards to IPC handlers"
```

---

### Task 5: Fix critical engine bugs — parsePanelResponse, tool calls, context parsing

**Files:**
- Modify: `src/main/workshop-engine.ts:560-581` (parsePanelResponse)
- Modify: `src/main/workshop-engine.ts:596-609` (handleToolCalls)
- Modify: `src/main/workshop-engine.ts:269-274` (context parsing)

**Step 1: Guard against empty personas in `parsePanelResponse`** (line 574-579)

Replace:
```typescript
    if (results.length === 0 && output.trim()) {
      const cleanOutput = output.replace(/<tool_call[\s\S]*?<\/tool_call>/g, '').trim()
      if (cleanOutput) {
        results.push({ personaId: personas[0].id, personaName: personas[0].name, content: cleanOutput })
      }
    }
```
With:
```typescript
    if (results.length === 0 && output.trim() && personas.length > 0) {
      const cleanOutput = output.replace(/<tool_call[\s\S]*?<\/tool_call>/g, '').trim()
      if (cleanOutput) {
        results.push({ personaId: personas[0].id, personaName: personas[0].name, content: cleanOutput })
      }
    }
```

**Step 2: Log dropped tool calls instead of silently continuing** (line 605-609)

Replace:
```typescript
      try {
        toolInput = JSON.parse(match[2].trim())
      } catch {
        continue
      }
```
With:
```typescript
      try {
        toolInput = JSON.parse(match[2].trim())
      } catch (parseErr: any) {
        console.warn(`[Workshop] Failed to parse tool call "${toolName}" JSON — skipping:`, parseErr.message)
        continue
      }
```

**Step 3: Fix tool call regex to match hyphenated names** (line 599)

Replace:
```typescript
    const toolCallRegex = /<tool_call name="(\w+)">([\s\S]*?)<\/tool_call>/g
```
With:
```typescript
    const toolCallRegex = /<tool_call name="([\w-]+)">([\s\S]*?)<\/tool_call>/g
```

**Step 4: Validate context parsing** (line 270-273)

Replace:
```typescript
          if (streamType === 'context') {
            const parts = streamContent.replace('__context:', '').split(':')
            this.emit('context-update', { sessionId, contextTokens: parseInt(parts[0], 10), contextMax: parseInt(parts[1], 10) })
            return
          }
```
With:
```typescript
          if (streamType === 'context') {
            const parts = streamContent.replace('__context:', '').split(':')
            const contextTokens = parseInt(parts[0], 10)
            const contextMax = parts.length >= 2 ? parseInt(parts[1], 10) : 0
            if (!isNaN(contextTokens) && !isNaN(contextMax)) {
              this.emit('context-update', { sessionId, contextTokens, contextMax })
            }
            return
          }
```

**Step 5: Add toolInput validation before dispatching** (line 611-614)

After the JSON.parse try/catch and before the `switch (toolName)`, add:

```typescript
      // Validate toolInput is a proper object
      if (typeof toolInput !== 'object' || toolInput === null) {
        console.warn(`[Workshop] Tool call "${toolName}" has non-object input — skipping`)
        continue
      }
```

**Step 6: Log file read errors in `getArtifactContent`** (line 915-920)

Replace:
```typescript
    try {
      return fs.readFileSync(fullPath, 'utf-8')
    } catch {
      return null
    }
```
With:
```typescript
    try {
      return fs.readFileSync(fullPath, 'utf-8')
    } catch (err: any) {
      console.error(`[Workshop] Failed to read artifact at ${fullPath}:`, err.message)
      return null
    }
```

**Step 7: Verify the build compiles**

Run: `cd C:\Users\dutte\OneDrive\Desktop\Projects\ClawFlow && pnpm build`
Expected: Build succeeds

**Step 8: Commit**

```bash
git add src/main/workshop-engine.ts
git commit -m "fix(workshop): guard empty personas, log dropped tool calls, validate context parsing"
```

---

### Task 6: Fix tool call regex in MessageBubble + safe JSON.stringify in ToolCallCard

**Files:**
- Modify: `src/renderer/src/components/Workshop/MessageBubble.tsx:39`
- Modify: `src/renderer/src/components/Workshop/ToolCallCard.tsx:20-29,59-66`

**Step 1: Fix tool_call XML stripping regex in MessageBubble** (line 39)

Replace:
```typescript
    : message.content.replace(/<tool_call name="\w+">\s*[\s\S]*?<\/tool_call>/g, '').trim()
```
With:
```typescript
    : message.content.replace(/<tool_call name="[\w-]+">\s*[\s\S]*?<\/tool_call>/g, '').trim()
```

**Step 2: Add `Array.isArray` guard for segments** (line 31-34)

Replace:
```typescript
  const segments: MessageSegment[] | null =
    isStreaming && streamingSegments
      ? streamingSegments
      : (message.metadata?.segments as MessageSegment[] | undefined) ?? null
```
With:
```typescript
  const rawSegments = isStreaming && streamingSegments
    ? streamingSegments
    : (message.metadata?.segments as unknown)
  const segments: MessageSegment[] | null =
    Array.isArray(rawSegments) ? rawSegments : null
```

**Step 3: Add fallback for unknown segment types** (line 83-84)

Replace:
```typescript
              return null
```
With:
```typescript
              return (
                <div key={i} className="text-xs text-text-muted italic my-1">
                  [Unsupported content]
                </div>
              )
```

**Step 4: Safe JSON.stringify in ToolCallCard** (line 60-66)

Replace:
```typescript
        <div className="px-3 py-2 border-t border-white/5 text-xs font-mono text-text-muted/80 max-h-32 overflow-y-auto">
          {tool.toolInput ? (
            <pre className="whitespace-pre-wrap">{JSON.stringify(tool.toolInput, null, 2)}</pre>
          ) : (
            <span className="text-text-muted/40 italic">Tool executed</span>
          )}
        </div>
```
With:
```typescript
        <div className="px-3 py-2 border-t border-white/5 text-xs font-mono text-text-muted/80 max-h-32 overflow-y-auto">
          {tool.toolInput ? (
            <pre className="whitespace-pre-wrap">{(() => {
              try { return JSON.stringify(tool.toolInput, null, 2) }
              catch { return '[Unable to display input]' }
            })()}</pre>
          ) : (
            <span className="text-text-muted/40 italic">Tool executed</span>
          )}
        </div>
```

**Step 5: Guard `getToolContext` against non-object input** (line 20-30)

Replace:
```typescript
function getToolContext(tool: ToolCallData): string {
  const input = tool.toolInput
  if (!input) return ''
  if (input.file_path) return String(input.file_path).split('/').slice(-2).join('/')
```
With:
```typescript
function getToolContext(tool: ToolCallData): string {
  const input = tool.toolInput
  if (!input || typeof input !== 'object') return ''
  if (input.file_path) return String(input.file_path).split('/').slice(-2).join('/')
```

**Step 6: Verify the build compiles**

Run: `cd C:\Users\dutte\OneDrive\Desktop\Projects\ClawFlow && pnpm build`
Expected: Build succeeds

**Step 7: Commit**

```bash
git add src/renderer/src/components/Workshop/MessageBubble.tsx src/renderer/src/components/Workshop/ToolCallCard.tsx
git commit -m "fix(workshop): safe JSON.stringify, fix tool_call regex, validate segments array"
```

---

### Task 7: Fix ConversationPanel input preservation on error

**Files:**
- Modify: `src/renderer/src/components/Workshop/ConversationPanel.tsx:32-41`

**Step 1: Preserve input on send failure** (line 32-41)

Replace:
```typescript
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
```
With:
```typescript
  const handleSend = async () => {
    const trimmed = input.trim()
    if (!trimmed || !currentSessionId || isStreaming) return
    const savedInput = input
    setInput('')
    try {
      if (isPanelSession) {
        await sendPanelMessage(currentSessionId, trimmed)
      } else {
        await useWorkshopStore.getState().sendMessage(currentSessionId, trimmed)
      }
    } catch {
      // Restore input so user can retry
      setInput(savedInput)
    }
  }
```

**Step 2: Verify the build compiles**

Run: `cd C:\Users\dutte\OneDrive\Desktop\Projects\ClawFlow && pnpm build`
Expected: Build succeeds

**Step 3: Commit**

```bash
git add src/renderer/src/components/Workshop/ConversationPanel.tsx
git commit -m "fix(workshop): restore input text on send failure for retry"
```

---

### Task 8: Fix PanelSessionModal input validation + MermaidDiagram polish

**Files:**
- Modify: `src/renderer/src/components/Workshop/PanelSessionModal.tsx:147-153`
- Modify: `src/renderer/src/components/Workshop/MermaidDiagram.tsx:4-14,16`

**Step 1: Add maxLength to persona inputs** (PanelSessionModal line 147-159)

Replace:
```typescript
              <input
                type="text"
                value={customName}
                onChange={(e) => setCustomName(e.target.value)}
                placeholder="Persona name"
                className="w-full bg-bg border border-border rounded-md px-3 py-2 text-sm text-text placeholder:text-text-muted/50 focus:outline-none focus:border-accent-cyan/50"
              />
              <textarea
                value={customDescription}
                onChange={(e) => setCustomDescription(e.target.value)}
                placeholder="Describe this persona's focus and expertise..."
                rows={3}
                className="w-full bg-bg border border-border rounded-md px-3 py-2 text-sm text-text placeholder:text-text-muted/50 resize-none focus:outline-none focus:border-accent-cyan/50"
              />
```
With:
```typescript
              <input
                type="text"
                value={customName}
                onChange={(e) => setCustomName(e.target.value.slice(0, 50))}
                placeholder="Persona name"
                maxLength={50}
                className="w-full bg-bg border border-border rounded-md px-3 py-2 text-sm text-text placeholder:text-text-muted/50 focus:outline-none focus:border-accent-cyan/50"
              />
              <textarea
                value={customDescription}
                onChange={(e) => setCustomDescription(e.target.value.slice(0, 500))}
                placeholder="Describe this persona's focus and expertise..."
                rows={3}
                maxLength={500}
                className="w-full bg-bg border border-border rounded-md px-3 py-2 text-sm text-text placeholder:text-text-muted/50 resize-none focus:outline-none focus:border-accent-cyan/50"
              />
```

**Step 2: Move mermaid.initialize into component scope** (MermaidDiagram line 4-16)

Replace:
```typescript
mermaid.initialize({
  startOnLoad: false,
  theme: 'dark',
  themeVariables: {
    darkMode: true,
    background: '#1a1a2e',
    primaryColor: '#2dd4bf',
    primaryTextColor: '#e2e8f0',
    lineColor: '#475569',
  },
})

let renderCounter = 0
```
With:
```typescript
let mermaidInitialized = false
let renderCounter = 0

function ensureMermaidInit() {
  if (mermaidInitialized) return
  mermaid.initialize({
    startOnLoad: false,
    theme: 'dark',
    themeVariables: {
      darkMode: true,
      background: '#1a1a2e',
      primaryColor: '#2dd4bf',
      primaryTextColor: '#e2e8f0',
      lineColor: '#475569',
    },
  })
  mermaidInitialized = true
}
```

Then in `renderDiagram` callback (line 23-34), add `ensureMermaidInit()` as the first line:

Replace:
```typescript
  const renderDiagram = useCallback(async (diagramContent: string, diagramId: string) => {
    // Use a unique element ID per render call to avoid Mermaid DOM element ID conflicts
    const elementId = `mermaid-${diagramId.replace(/[^a-zA-Z0-9]/g, '')}-${++renderCounter}`
```
With:
```typescript
  const renderDiagram = useCallback(async (diagramContent: string, diagramId: string) => {
    ensureMermaidInit()
    const elementId = `mermaid-${diagramId.replace(/[^a-zA-Z0-9]/g, '')}-${++renderCounter}`
```

**Step 3: Verify the build compiles**

Run: `cd C:\Users\dutte\OneDrive\Desktop\Projects\ClawFlow && pnpm build`
Expected: Build succeeds

**Step 4: Commit**

```bash
git add src/renderer/src/components/Workshop/PanelSessionModal.tsx src/renderer/src/components/Workshop/MermaidDiagram.tsx
git commit -m "fix(workshop): add persona input length limits, lazy mermaid init"
```

---

### Task 9: Update global.d.ts with missing Workshop API methods

**Files:**
- Modify: `src/renderer/src/global.d.ts:43-55`

**Step 1: Add missing method declarations**

Replace:
```typescript
  workshop: {
    startSession: (dbPath: string, projectPath: string, projectId: string, projectName: string, title?: string) => Promise<any>
    endSession: (sessionId: string) => Promise<void>
    listSessions: (dbPath: string, projectPath: string, projectId: string, projectName: string) => Promise<any[]>
    getSession: (sessionId: string) => Promise<any>
    sendMessage: (sessionId: string, content: string) => Promise<void>
    listMessages: (dbPath: string, sessionId: string) => Promise<any[]>
    listArtifacts: () => Promise<any[]>
    getArtifact: (artifactId: string) => Promise<{ artifact: any; content: string | null }>
    createTasks: (sessionId: string, tasks: any[]) => Promise<void>
    onStream: (callback: (event: any) => void) => () => void
    onToolEvent: (callback: (event: any) => void) => () => void
  }
```
With:
```typescript
  workshop: {
    startSession: (dbPath: string, projectPath: string, projectId: string, projectName: string, title?: string) => Promise<any>
    endSession: (sessionId: string) => Promise<void>
    stopSession: (sessionId: string) => Promise<void>
    deleteSession: (sessionId: string) => Promise<void>
    listSessions: (dbPath: string, projectPath: string, projectId: string, projectName: string) => Promise<any[]>
    getSession: (sessionId: string) => Promise<any>
    sendMessage: (sessionId: string, content: string) => Promise<void>
    sendPanelMessage: (sessionId: string, content: string) => Promise<void>
    triggerDiscuss: (sessionId: string) => Promise<void>
    listMessages: (dbPath: string, sessionId: string) => Promise<any[]>
    listArtifacts: () => Promise<any[]>
    getArtifact: (artifactId: string) => Promise<{ artifact: any; content: string | null }>
    createTasks: (sessionId: string, tasks: any[]) => Promise<void>
    recoverSession: (sessionId: string) => Promise<void>
    renameSession: (sessionId: string, title: string) => Promise<any>
    startPanelSession: (dbPath: string, projectPath: string, projectId: string, projectName: string, title: string, panelPersonas: any[]) => Promise<any>
    onStream: (callback: (event: any) => void) => () => void
    onToolEvent: (callback: (event: any) => void) => () => void
    onSessionRenamed: (callback: (data: { sessionId: string; title: string }) => void) => () => void
  }
```

**Step 2: Verify the build compiles**

Run: `cd C:\Users\dutte\OneDrive\Desktop\Projects\ClawFlow && pnpm build`
Expected: Build succeeds

**Step 3: Commit**

```bash
git add src/renderer/src/global.d.ts
git commit -m "fix(workshop): add missing IPC method declarations to global.d.ts"
```

---

### Task 10: Final build verification and manual smoke test

**Files:** None — verification only

**Step 1: Full clean build**

Run: `cd C:\Users\dutte\OneDrive\Desktop\Projects\ClawFlow && pnpm build`
Expected: Build succeeds with no errors

**Step 2: Manual smoke test checklist**

Start the app with `pnpm dev` and verify:

1. **Solo session happy path** — Create session, send message, get response, see it displayed
2. **Error banner** — Kill the engine mid-stream (stop session), verify error banner appears and auto-dismisses
3. **Panel session** — Create panel with 2+ personas, send message, verify persona messages render
4. **Discuss round** — Click "Discuss further" in panel session, verify responses come back
5. **Artifacts** — Create an artifact via workshop, see it in artifact panel, click to view
6. **Mermaid diagram** — Create a diagram artifact, verify it renders; try malformed mermaid content, verify error fallback shows
7. **Tool calls** — Verify tool call cards display with expandable input
8. **Session list** — Rename session (double-click), delete session, verify no crashes
9. **Project switch** — Switch to a different project and back, verify no duplicate events

**Step 3: Commit (if any final tweaks needed)**

```bash
git add -A
git commit -m "chore(workshop): final verification and adjustments"
```

---

## Acceptance Criteria Cross-Check

| Criterion | Tasks |
|-----------|-------|
| All Workshop IPC calls have proper error boundaries and user-facing error messages | Tasks 1-4, 9 |
| Panel session round-robin handles agent failures gracefully | Task 5 (parsePanelResponse guard + triggerDiscuss already has per-persona try/catch) |
| Artifact save/load handles malformed content without throwing | Tasks 2 (selectArtifact), 5 (getArtifactContent logging) |
| Mermaid diagram rendering catches parse errors and shows a fallback | Task 8 (already has error state + fallback UI — now with lazy init) |
| Tool call XML parsing handles malformed blocks without breaking chat | Tasks 5 (engine regex, JSON parse logging), 6 (MessageBubble regex, safe stringify) |
