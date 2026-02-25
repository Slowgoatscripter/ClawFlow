# Workshop Stop & Delete Sessions Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add ability to stop in-flight Claude SDK calls and delete workshop sessions, preventing orphaned processes.

**Architecture:** Expose the existing AbortController from sdk-manager via a session-keyed Map. Workshop engine gets stop/delete methods. UI gets stop + delete buttons on session items.

**Tech Stack:** Electron IPC, Zustand, React, better-sqlite3

---

### Task 1: Expose AbortController from SDK Manager

**Files:**
- Modify: `src/main/sdk-manager.ts`

**Step 1: Add active controllers map and abort function**

Add a module-level Map and export an `abortSession` function. Store controller when SDK call starts, clean up when it ends.

```typescript
// After line 12 (after pendingApprovals map)
const activeControllers = new Map<string, AbortController>()

export function abortSession(sessionKey: string): boolean {
  const controller = activeControllers.get(sessionKey)
  if (!controller) return false
  controller.abort()
  activeControllers.delete(sessionKey)
  return true
}
```

**Step 2: Wire AbortController storage into runSdkSessionOnce**

The function needs a `sessionKey` param to store/cleanup the controller. Modify `createSdkRunner` to accept and pass it through.

In `runSdkSessionOnce`:
- Accept `sessionKey?: string` parameter
- After creating `abortController`, if sessionKey: `activeControllers.set(sessionKey, abortController)`
- In finally block: `activeControllers.delete(sessionKey)`

In `createSdkRunner` / `runSdkSession`:
- Pass `params.sessionKey` through to `runSdkSessionOnce`

**Step 3: Add sessionKey to SdkRunnerParams type**

In `src/main/pipeline-engine.ts` (where `SdkRunnerParams` is defined), add `sessionKey?: string`.

---

### Task 2: Workshop Engine — Stop & Delete Methods

**Files:**
- Modify: `src/main/workshop-engine.ts`
- Modify: `src/main/db.ts`

**Step 1: Add deleteWorkshopSession to db.ts**

```typescript
export function deleteWorkshopSession(dbPath: string, sessionId: string): void {
  const db = getProjectDb(dbPath)
  db.prepare('DELETE FROM workshop_task_links WHERE session_id = ?').run(sessionId)
  db.prepare('DELETE FROM workshop_messages WHERE session_id = ?').run(sessionId)
  db.prepare('DELETE FROM workshop_sessions WHERE id = ?').run(sessionId)
}
```

**Step 2: Add stopSession and deleteSession to WorkshopEngine**

```typescript
// Add import for abortSession at top
import { abortSession } from './sdk-manager'

// Add to activeSessionIds tracking
private activeSessionKeys = new Set<string>()

stopSession(sessionId: string): void {
  abortSession(sessionId)
  this.activeSessionKeys.delete(sessionId)
  this.emit('stream', { type: 'done', sessionId } as WorkshopStreamEvent)
}

deleteSession(sessionId: string): void {
  this.stopSession(sessionId)
  this.sessionIds.delete(sessionId)
  deleteWorkshopSession(this.dbPath, sessionId)
  this.emit('session:deleted', { sessionId })
}
```

**Step 3: Pass sessionKey when calling sdkRunner in sendMessage**

In `sendMessage`, add `sessionKey: sessionId` to the sdkRunner params so the AbortController is tracked.

---

### Task 3: IPC Handlers & Preload

**Files:**
- Modify: `src/main/index.ts`
- Modify: `src/preload/index.ts`

**Step 1: Add IPC handlers in index.ts**

```typescript
ipcMain.handle('workshop:stop-session', (_e, sessionId) => {
  currentWorkshopEngine?.stopSession(sessionId)
})

ipcMain.handle('workshop:delete-session', (_e, sessionId) => {
  currentWorkshopEngine?.deleteSession(sessionId)
})
```

**Step 2: Expose in preload**

```typescript
stopSession: (sessionId: string) =>
  ipcRenderer.invoke('workshop:stop-session', sessionId),
deleteSession: (sessionId: string) =>
  ipcRenderer.invoke('workshop:delete-session', sessionId),
```

---

### Task 4: Workshop Store — Stop & Delete Actions

**Files:**
- Modify: `src/renderer/src/stores/workshopStore.ts`

**Step 1: Add stopSession and deleteSession to store interface and implementation**

```typescript
// Interface additions
stopSession: (sessionId: string) => void
deleteSession: (sessionId: string) => void

// Implementation
stopSession: (sessionId) => {
  window.api.workshop.stopSession(sessionId)
  set({ isStreaming: false, streamingContent: '' })
},

deleteSession: (sessionId) => {
  window.api.workshop.deleteSession(sessionId)
  set((state) => {
    const sessions = state.sessions.filter((s) => s.id !== sessionId)
    const isCurrentDeleted = state.currentSessionId === sessionId
    return {
      sessions,
      currentSessionId: isCurrentDeleted ? null : state.currentSessionId,
      currentSession: isCurrentDeleted ? null : state.currentSession,
      messages: isCurrentDeleted ? [] : state.messages,
      isStreaming: isCurrentDeleted ? false : state.isStreaming,
      streamingContent: isCurrentDeleted ? '' : state.streamingContent,
    }
  })
},
```

---

### Task 5: UI — Stop & Delete Buttons on Session Items

**Files:**
- Modify: `src/renderer/src/components/Workshop/SessionList.tsx`

**Step 1: Add stop and delete buttons to SessionItem**

- Stop button: visible only when `isStreaming && isActive`, square icon (stop), calls `stopSession`
- Delete button: visible on hover (unless streaming on this session), trash icon, calls `deleteSession`
- Need to pass `isStreaming` from store into SessionList

---

### Task 6: TypeScript Types

**Files:**
- Modify: `src/preload/index.ts` (already covered in Task 3)
- Possibly: `src/shared/types.ts` if `window.api` types need updating

Check if there's a global type declaration for `window.api.workshop` and add the new methods.
