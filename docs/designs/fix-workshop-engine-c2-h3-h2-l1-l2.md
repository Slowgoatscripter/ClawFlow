# Design: Fix workshop-engine.ts — C2, H3, H2, L1, L2

## Problem Statement

Five issues in `src/main/workshop-engine.ts` need to be addressed:

| ID | Severity | Issue | Impact |
|----|----------|-------|--------|
| C2 | Critical | Singleton `activeGroupId` shared across all sessions | Concurrent sessions corrupt each other's group tracking |
| H3 | High | `trackTokens` has read-modify-write race | Panel discussions lose token counts |
| H2 | High | Verify `getSessionForGroup` returns UUID | Could return numeric rowid breaking session lookups |
| L1 | Low | Verify model ID for `endSession` | Possibly outdated/wrong model string |
| L2 | Low | No `dbPath` getter — index.ts uses bracket notation | Fragile access pattern, bypasses type safety |

---

## Current Code Analysis

### C2: Singleton `activeGroupId`

**Current state** (line 67):
```typescript
private activeGroupId: number | null = null
```

**All 14 callsites:**

| Line | Context | Read/Write |
|------|---------|-----------|
| 67 | Field declaration | — |
| 90 | `setPipelineEngine` → `group:task-stage-complete` filter | Read |
| 103 | `setPipelineEngine` → `group:paused` filter | Read |
| 116 | `setPipelineEngine` → `group:completed` filter | Read |
| 968 | `handleCreateTaskGroup` — sets after creating group | Write |
| 978 | `handleLaunchGroup` — fallback groupId | Read |
| 992 | `handleGetGroupStatus` — fallback groupId | Read |
| 1000 | `handlePauseGroup` — guard + value | Read |
| 1001 | `handlePauseGroup` — passed to pipeline | Read |
| 1006 | `handleResumeGroup` — guard + value | Read |
| 1007 | `handleResumeGroup` — passed to pipeline | Read |
| 1012 | `handleMessageAgent` — emitted in event | Read |
| 1100 | `suggestTasks` (autoMode) — sets after creating group | Write |
| 1124 | `suggestTasks` (non-autoMode) — emitted in event | Read |

**Bug scenario:** Session A creates group #1 → `activeGroupId = 1`. Session B creates group #2 → `activeGroupId = 2`. Now Session A tries to pause — it pauses group #2 instead of group #1.

### H3: `trackTokens` Race Condition

**Current state** (lines 134-146):
```typescript
private trackTokens(sessionId, usage): void {
  const current = this.tokenUsage.get(sessionId) || { input: 0, output: 0 }
  current.input += usage.input_tokens || 0
  current.output += usage.output_tokens || 0
  this.tokenUsage.set(sessionId, current)
  this.emit('stream', { type: 'token_update', sessionId, ...current })
}
```

**Race scenario in `triggerDiscuss`** (lines 578-614):
```typescript
const promises = session.panelPersonas.map(async (persona) => {
  const result = await this.sdkRunner!({ ... })
  this.trackTokens(sessionId, result.usage)  // line 607
})
const responses = await Promise.all(promises)
```

Multiple persona SDK calls complete near-simultaneously, all calling `trackTokens` with the same `sessionId`. Since JavaScript is single-threaded but async, the issue is subtle:
- The `Map.get()` on line 139 gets an **object reference** (same object for all concurrent callers since `Map` stores by reference).
- Since it mutates the object in-place (`current.input += ...`), there is actually NO race on the data itself — all callers mutate the same object.

**Wait — re-analysis:** The code mutates the object in-place. Since JS is single-threaded and `trackTokens` is synchronous, there's no actual data race here. Each `await` yields, and when `trackTokens` runs, it runs to completion before another can start. The `Map.get()` returns the same object reference, and mutations are cumulative.

However, the **`emit` on line 143-145 could emit stale intermediate totals** (e.g., showing input=100 then input=200 instead of input=300 after both complete). The real concern is whether the **final count is correct** — and it is, because each call reads the shared object, mutates it, and writes it back, all synchronously.

**Verdict:** H3 is less severe than described. The token counts are ultimately correct because JS is single-threaded. But the intermediate `token_update` events may show non-monotonic values if multiple personas complete in rapid succession (each emitting its own intermediate total). The task description says "wrong token counts in panel discussions" — this could refer to the intermediate emissions confusing the UI.

### H2: `getSessionForGroup` Return Value

**Current state** (lines 129-132):
```typescript
private getSessionForGroup(groupId: number): string | null {
  const group = getTaskGroup(this.dbPath, groupId)
  return group ? String(group.sessionId) : null
}
```

**DB schema for `task_groups`:**
```sql
CREATE TABLE IF NOT EXISTS task_groups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  ...
  FOREIGN KEY (session_id) REFERENCES workshop_sessions(id) ON DELETE CASCADE
)
```

**`rowToTaskGroup`** maps `row.session_id` → `sessionId: row.session_id`.

**`createTaskGroup`** stores the `input.sessionId` directly (passed from `handleCreateTaskGroup(sessionId, ...)` where `sessionId` is the workshop session UUID).

**Verdict:** `group.sessionId` is already a UUID string (TEXT column, foreign key to `workshop_sessions.id` which is `crypto.randomUUID()`). The `String()` call is redundant but harmless. **This is confirmed correct.** The `String()` coercion is unnecessary but doesn't cause a bug.

### L1: Model ID for `endSession`

**Current state** (line 175):
```typescript
model: 'claude-haiku-4-5-20251001',
```

**Valid model IDs in the codebase** (`src/shared/settings.ts`):
```typescript
export type ModelOption = 'claude-opus-4-6' | 'claude-sonnet-4-6' | 'claude-haiku-4-5-20251001'
```

The same model is used in two places in workshop-engine.ts:
- Line 175: `endSession` summarization
- Line 421: Auto-naming the session

**Verdict:** `claude-haiku-4-5-20251001` is listed as a valid `ModelOption` in `settings.ts` (line 23) and is the appropriate choice for lightweight tasks like summarization and session naming. **This is confirmed correct.**

### L2: Missing `dbPath` Getter

**Current state** (line 59):
```typescript
private dbPath: string
```

**index.ts uses bracket notation to bypass `private`:**
- Line 130: `currentGitEngine['dbPath'] !== dbPath` (GitEngine has same pattern)
- Line 352: `currentWorkshopEngine['dbPath'] !== dbPath`
- Line 446: `const dbPath = currentWorkshopEngine['dbPath']`
- Line 475: `createWorkshopMessage(currentWorkshopEngine['dbPath'], ...)`
- Line 476: `updateWorkshopSession(currentWorkshopEngine['dbPath'], ...)`

This is fragile: bracket notation bypasses TypeScript's type checker, so renames or type changes won't be caught at compile time.

**Note:** The task says "protected getter" but `protected` means accessible only to subclasses — index.ts is NOT a subclass of `WorkshopEngine`. For index.ts to access `.dbPath` without bracket notation, the getter must be `public`. Alternatively, we could use `protected` and accept that index.ts still needs bracket notation temporarily (but at least the getter exists for future subclass use). **The practical solution is `public`.**

---

## Approach Options

### Approach A: Minimal Targeted Fixes (Recommended)

Apply each fix independently, touching only the necessary lines. Keep changes localized.

**C2:** Replace `private activeGroupId: number | null = null` with `private activeGroupBySession = new Map<string, number>()`. Update all 14 callsites:
- **Writes (968, 1100):** Change `this.activeGroupId = group.id` → `this.activeGroupBySession.set(sessionId, group.id)`
- **Reads with sessionId available (978, 992, 1000, 1006, 1012, 1124):** Change `this.activeGroupId` → `this.activeGroupBySession.get(sessionId)`
- **Pipeline event handlers (90, 103, 116):** These don't have a sessionId directly. Change the logic:
  - Remove the `activeGroupId` guard
  - Instead, rely on `getSessionForGroup(data.groupId)` — if a session is found, the group is valid and should emit. This is actually *better* behavior since currently events for non-active groups of an active session are silently dropped.
  - OR: Keep the filter by iterating the map values to check if `data.groupId` matches any session's active group

**H3:** Since the actual token counts are correct (JS is single-threaded), the fix is about ensuring consistent intermediate emissions. Add a per-session update queue:
```typescript
private tokenUpdateQueue = new Map<string, Promise<void>>()

private async trackTokens(sessionId, usage): Promise<void> {
  if (!usage) return
  const prev = this.tokenUpdateQueue.get(sessionId) ?? Promise.resolve()
  const next = prev.then(() => {
    const current = this.tokenUsage.get(sessionId) || { input: 0, output: 0 }
    current.input += usage.input_tokens || 0
    current.output += usage.output_tokens || 0
    this.tokenUsage.set(sessionId, current)
    this.emit('stream', { type: 'token_update', sessionId, ...current })
  })
  this.tokenUpdateQueue.set(sessionId, next)
  await next
}
```

**H2:** Already verified correct. Add a comment documenting the UUID return type. Remove redundant `String()` call.

**L1:** Already verified correct. No change needed. Add a comment noting the model choice rationale.

**L2:** Rename `private dbPath` → `private _dbPath`, add `public get dbPath(): string { return this._dbPath }`. Update all internal references from `this.dbPath` to `this._dbPath`. index.ts can then use `.dbPath` directly.

**Pros:**
- Each fix is independent, easy to review
- Minimal blast radius
- `trackTokens` becomes async but callers already use `await` or can fire-and-forget

**Cons:**
- Making `trackTokens` async changes its signature, requiring updates at 3 callsites (lines 389, 525, 607)
- Renaming `_dbPath` touches many lines (every `this.dbPath` reference in the class)

### Approach B: Broader Refactor with Session Context Object

Group the per-session state (activeGroupId, tokenUsage, tokenUpdateQueue) into a single `SessionContext` type:

```typescript
interface SessionContext {
  activeGroupId: number | null
  tokenUsage: { input: number; output: number }
  tokenUpdateLock: Promise<void>
}
private sessions = new Map<string, SessionContext>()
```

**Pros:**
- Cleaner per-session state management
- Single Map instead of three
- Natural place to add more per-session state in the future

**Cons:**
- Larger refactor scope — risky for a "fix" ticket
- Touches many more lines than needed
- Introduces a new type/interface
- Over-engineering for the stated requirements

### Approach C: Event-Driven Token Accumulation

Instead of fixing `trackTokens` with a queue, change the token tracking to emit only after all panel responses complete (batch approach):

```typescript
// In triggerDiscuss, collect all usages then apply at end
const allUsages = responses.map(r => r.usage)
for (const u of allUsages) this.trackTokens(sessionId, u)
```

**Pros:**
- No async change to `trackTokens`
- Final total is emitted once, no intermediate confusion

**Cons:**
- Requires refactoring `triggerDiscuss` return types to include usage
- Doesn't fix potential future races in other callers
- Only fixes one symptom, not the root pattern

---

## Recommendation: Approach A (Minimal Targeted Fixes)

Approach A is the right choice because:
1. Each fix is isolated and independently testable
2. Minimal blast radius — important for a critical-priority fix
3. The per-session promise queue pattern is standard and proven
4. YAGNI — we don't need a `SessionContext` abstraction yet

---

## Detailed Implementation Plan

### Fix 1: C2 — Per-Session Active Group (Critical)

**File:** `src/main/workshop-engine.ts`

1. **Line 67:** Replace field declaration
   ```diff
   - private activeGroupId: number | null = null
   + private activeGroupBySession = new Map<string, number>()
   ```

2. **Lines 89-126 (pipeline event handlers):** Remove the `activeGroupId` equality check. These handlers already call `getSessionForGroup(data.groupId)` to find the session — if found, the group belongs to a session and should emit. But to preserve existing filtering behavior (only emit for the *active* group of a session):
   ```typescript
   engine.on('group:task-stage-complete', (data) => {
     const sessionId = this.getSessionForGroup(data.groupId)
     if (sessionId && this.activeGroupBySession.get(sessionId) === data.groupId) {
       this.emit('stream', { ... })
     }
   })
   ```
   Same pattern for `group:paused` and `group:completed`.

3. **Line 968:** `this.activeGroupBySession.set(sessionId, group.id)`

4. **Line 978:** `const groupId = input.groupId ?? this.activeGroupBySession.get(sessionId) ?? null`

5. **Line 992:** Same pattern as 978.

6. **Lines 1000-1001:**
   ```typescript
   const activeGroup = this.activeGroupBySession.get(sessionId)
   if (!this.pipelineEngine || !activeGroup) return
   const count = await this.pipelineEngine.pauseGroup(activeGroup)
   ```

7. **Lines 1006-1007:** Same pattern as 1000-1001.

8. **Line 1012:** `this.emit('group:message-agent', { groupId: this.activeGroupBySession.get(sessionId), ... })`

9. **Line 1100:** `this.activeGroupBySession.set(sessionId, group.id)`

10. **Line 1124:** `this.emit('tasks:suggested', { ..., groupId: this.activeGroupBySession.get(sessionId) ?? undefined })`

### Fix 2: H3 — Race-Safe Token Tracking (High)

**File:** `src/main/workshop-engine.ts`

1. **Add field** (after line 66):
   ```typescript
   private tokenUpdateQueue = new Map<string, Promise<void>>()
   ```

2. **Replace `trackTokens`** (lines 134-146):
   ```typescript
   private trackTokens(
     sessionId: string,
     usage: { input_tokens?: number; output_tokens?: number } | undefined
   ): Promise<void> {
     if (!usage) return Promise.resolve()
     const prev = this.tokenUpdateQueue.get(sessionId) ?? Promise.resolve()
     const next = prev.then(() => {
       const current = this.tokenUsage.get(sessionId) || { input: 0, output: 0 }
       current.input += usage.input_tokens || 0
       current.output += usage.output_tokens || 0
       this.tokenUsage.set(sessionId, current)
       this.emit('stream', {
         type: 'token_update', sessionId, ...current
       } as any)
     })
     this.tokenUpdateQueue.set(sessionId, next)
     return next
   }
   ```

3. **Update callsites** to `await`:
   - Line 389: `await this.trackTokens(sessionId, result.usage)` (already in async function)
   - Line 525: `await this.trackTokens(sessionId, result.usage)` (already in async function)
   - Line 607: `await this.trackTokens(sessionId, result.usage)` (already in async function)

### Fix 3: H2 — Confirm UUID Return (High — Verify Only)

**File:** `src/main/workshop-engine.ts`

1. **Lines 129-132:** Remove redundant `String()`, add clarifying type annotation:
   ```typescript
   private getSessionForGroup(groupId: number): string | null {
     const group = getTaskGroup(this.dbPath, groupId)
     // group.sessionId is already a UUID string (TEXT FK to workshop_sessions.id)
     return group?.sessionId ?? null
   }
   ```

**Verification chain:**
- `task_groups.session_id` is `TEXT NOT NULL` FK to `workshop_sessions.id`
- `workshop_sessions.id` is `TEXT PRIMARY KEY` set via `crypto.randomUUID()`
- `rowToTaskGroup` maps `row.session_id` → `sessionId` (string)
- ✅ Returns UUID string, not numeric rowid

### Fix 4: L1 — Verify Model ID (Low — Verify Only)

**File:** `src/main/workshop-engine.ts`

**Verification:**
- Line 175: `model: 'claude-haiku-4-5-20251001'` is correct
- Listed in `settings.ts` line 23 as valid `ModelOption`
- Appropriate for lightweight summarization/naming tasks
- Same model used at line 421 for auto-naming (consistent)
- ✅ No change needed

### Fix 5: L2 — Add `dbPath` Getter (Low)

**File:** `src/main/workshop-engine.ts`

1. **Line 59:** Rename private field:
   ```diff
   - private dbPath: string
   + private _dbPath: string
   ```

2. **After line 59:** Add public getter:
   ```typescript
   public get dbPath(): string { return this._dbPath }
   ```

3. **All internal references:** Replace `this.dbPath` → `this._dbPath` throughout the class. (Affects constructor assignment and all DB calls — roughly 40+ occurrences.)

4. **File: `src/main/index.ts`** — Replace bracket notation:
   - Line 352: `currentWorkshopEngine['dbPath']` → `currentWorkshopEngine.dbPath`
   - Line 446: `currentWorkshopEngine['dbPath']` → `currentWorkshopEngine.dbPath`
   - Line 475: `currentWorkshopEngine['dbPath']` → `currentWorkshopEngine.dbPath`
   - Line 476: `currentWorkshopEngine['dbPath']` → `currentWorkshopEngine.dbPath`

**Note:** The task says `protected` but index.ts is not a subclass. Using `public` so index.ts can access it directly. If `protected` is strictly required, index.ts will still need bracket notation (defeating the purpose).

---

## Testing Strategy

1. **Build verification:** `pnpm build` must pass
2. **C2 regression:** Manually verify that creating groups in two sessions doesn't cross-contaminate
3. **H3 regression:** Panel discussion with 3+ personas should show monotonically increasing token counts
4. **H2/L1:** No behavioral change — build passing confirms correctness
5. **L2:** TypeScript compiler will catch any missed `this.dbPath` → `this._dbPath` renames

---

## Risk Assessment

| Fix | Risk | Mitigation |
|-----|------|-----------|
| C2 | Medium — touches 14 callsites | Each change is mechanical; pattern is consistent |
| H3 | Low — async change is straightforward | Callers are already async |
| H2 | None — verify only | No code change beyond cleanup |
| L1 | None — verify only | No code change |
| L2 | Low — many `_dbPath` renames | TypeScript compiler catches misses |

---

## Open Questions

1. **C2 Pipeline event filtering:** Should events from *all* groups of a session be forwarded (not just the "active" one)? Current design filters to active only. Preserving existing behavior for now.
2. **L2 Visibility:** Task says `protected` but `public` is needed for index.ts. Using `public` unless explicitly told otherwise.
3. **GitEngine parity:** `GitEngine` has the same `private dbPath` + bracket notation pattern (line 13, index.ts line 130). Should we fix it too in this PR? Recommending no — out of scope.
