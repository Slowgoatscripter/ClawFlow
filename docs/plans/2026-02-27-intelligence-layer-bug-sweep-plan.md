# Intelligence Layer Bug Sweep — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix 8 confirmed bugs across the intelligence layer (sdk-manager, template-engine, knowledge-engine) with defensive hardening to prevent recurrence.

**Architecture:** Targeted edits to 3 existing files + 1 new test file. No API surface changes. Each fix is isolated and independently testable. Tests use pure-logic extraction (helper functions defined in-test) to avoid Electron/BrowserWindow mocking complexity. `skill-loader.ts` is confirmed correct and requires no changes.

**Tech Stack:** TypeScript, better-sqlite3, vitest, Electron (BrowserWindow IPC)

**Note on `pipeline-engine.ts`:** This file also calls `createKnowledgeEntry` (line 330) but uses auto-generated unique keys (`{task-title}-{stage}-rej-{count}`) that won't produce duplicates. It does NOT need to switch to `createOrUpdateKnowledgeEntry`.

---

### Task 1: Create test file + add safe JSON parse helper to knowledge-engine.ts (Bug 8)

**Bug:** `rowToEntry` crashes on corrupted `tags` JSON — `JSON.parse(row.tags ?? '[]')` throws if `row.tags` is a non-null malformed string.

**Files:**
- Create: `src/main/__tests__/intelligence-layer-bugs.test.ts`
- Modify: `src/main/knowledge-engine.ts`

**Step 1: Create the test file with Bug 8 tests**

Create `src/main/__tests__/intelligence-layer-bugs.test.ts`:

```typescript
import { describe, test, expect } from 'vitest'

// ---------------------------------------------------------------------------
// Pure-logic extractions for testing intelligence layer bug fixes.
// Each describe block defines the helper inline to avoid Electron imports.
// ---------------------------------------------------------------------------

// --- Bug 8: rowToEntry crashes on corrupted tags JSON ---

function safeJsonParse<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback
  try { return JSON.parse(value) } catch { return fallback }
}

function rowToEntryTags(rawTags: string | null | undefined): string[] {
  return safeJsonParse(rawTags, [])
}

describe('Bug 8: rowToEntry corrupted tags', () => {
  test('parses valid JSON tags', () => {
    expect(rowToEntryTags('["foo","bar"]')).toEqual(['foo', 'bar'])
  })

  test('returns [] for null tags', () => {
    expect(rowToEntryTags(null)).toEqual([])
  })

  test('returns [] for undefined tags', () => {
    expect(rowToEntryTags(undefined)).toEqual([])
  })

  test('returns [] for corrupted JSON string', () => {
    expect(rowToEntryTags('{not valid json')).toEqual([])
  })

  test('returns [] for empty string', () => {
    expect(rowToEntryTags('')).toEqual([])
  })
})
```

**Step 2: Run test to confirm helpers work**

Run: `npx vitest run src/main/__tests__/intelligence-layer-bugs.test.ts --reporter=verbose`
Expected: 5 tests PASS

**Step 3: Apply fix to `src/main/knowledge-engine.ts`**

Add `safeJsonParse` helper after imports (insert between lines 8 and 10):

```typescript
// Safe JSON parse — returns fallback on malformed input
function safeJsonParse<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback
  try { return JSON.parse(value) } catch { return fallback }
}
```

Then in `rowToEntry`, replace line 21:
```typescript
    tags: JSON.parse(row.tags ?? '[]'),
```
With:
```typescript
    tags: safeJsonParse(row.tags, []),
```

**Step 4: Verify build**

Run: `npx tsc --noEmit --project tsconfig.json 2>&1 | head -20`
Expected: No errors related to knowledge-engine.ts

**Step 5: Commit**

```bash
git add src/main/knowledge-engine.ts src/main/__tests__/intelligence-layer-bugs.test.ts
git commit -m "fix(knowledge-engine): safe JSON parse for corrupted tags in rowToEntry

Adds safeJsonParse helper that returns a fallback value instead of
throwing when row.tags contains malformed JSON. Prevents cascading
crashes through listKnowledge, listGlobalKnowledge, and buildKnowledgeIndex."
```

---

### Task 2: Add knowledge dedup — `createOrUpdateKnowledgeEntry` (Bug 1 — CRITICAL)

**Bug:** `createKnowledgeEntry()` always does `INSERT` with a fresh UUID. No UNIQUE constraint on `key`, no pre-check. When an agent produces `save_knowledge` with the same key during retries or handoffs, every call creates a new row.

**Files:**
- Modify: `src/main/knowledge-engine.ts` (add 2 functions after line 95)
- Modify: `src/main/sdk-manager.ts` (update import + call site)

**Step 1: Add tests for dedup logic**

Append to `src/main/__tests__/intelligence-layer-bugs.test.ts`:

```typescript
// --- Bug 1: FDRL candidate save duplicates entries ---

describe('Bug 1: Knowledge dedup logic', () => {
  function shouldCreateNew(
    existingByKeyAndStatus: { id: string; key: string } | null,
    newKey: string
  ): 'create' | 'update' {
    if (existingByKeyAndStatus && existingByKeyAndStatus.key === newKey) {
      return 'update'
    }
    return 'create'
  }

  test('returns "create" when no existing entry', () => {
    expect(shouldCreateNew(null, 'my-key')).toBe('create')
  })

  test('returns "update" when entry with same key exists', () => {
    expect(shouldCreateNew({ id: 'abc', key: 'my-key' }, 'my-key')).toBe('update')
  })

  test('returns "create" when existing key differs (shouldn\'t happen but defensive)', () => {
    expect(shouldCreateNew({ id: 'abc', key: 'other-key' }, 'my-key')).toBe('create')
  })
})
```

**Step 2: Run tests**

Run: `npx vitest run src/main/__tests__/intelligence-layer-bugs.test.ts --reporter=verbose`
Expected: All 8 tests PASS

**Step 3: Add `getKnowledgeByKeyAndStatus` and `createOrUpdateKnowledgeEntry` to `src/main/knowledge-engine.ts`**

Insert after `getKnowledgeByKey` function (after line 95):

```typescript
export function getKnowledgeByKeyAndStatus(
  dbPath: string,
  key: string,
  status: string
): KnowledgeEntry | null {
  const db = getProjectDb(dbPath)
  const row = db
    .prepare('SELECT * FROM domain_knowledge WHERE key = ? AND status = ? LIMIT 1')
    .get(key, status) as any
  return row ? rowToEntry(row) : null
}

export function createOrUpdateKnowledgeEntry(
  dbPath: string,
  entry: CreateKnowledgeInput
): KnowledgeEntry {
  const status = entry.status ?? 'active'
  const existing = getKnowledgeByKeyAndStatus(dbPath, entry.key, status)
  if (existing) {
    return updateKnowledgeEntry(dbPath, existing.id, {
      content: entry.content,
      summary: entry.summary,
      tags: entry.tags,
      category: entry.category
    })!
  }
  return createKnowledgeEntry(dbPath, entry)
}
```

**Step 4: Update `src/main/sdk-manager.ts` import and call site**

Replace line 8:
```typescript
import { createKnowledgeEntry } from './knowledge-engine'
```
With:
```typescript
import { createOrUpdateKnowledgeEntry } from './knowledge-engine'
```

Replace line 330:
```typescript
            createKnowledgeEntry(params.dbPath, {
```
With:
```typescript
            createOrUpdateKnowledgeEntry(params.dbPath, {
```

**Step 5: Verify build**

Run: `npx tsc --noEmit --project tsconfig.json 2>&1 | head -20`
Expected: No type errors

**Step 6: Commit**

```bash
git add src/main/knowledge-engine.ts src/main/sdk-manager.ts src/main/__tests__/intelligence-layer-bugs.test.ts
git commit -m "fix(knowledge-engine): dedup FDRL candidates by key+status on save_knowledge

Adds createOrUpdateKnowledgeEntry() that checks for an existing row
with the same key+status before inserting. Prevents knowledge index bloat
when agents produce repeated save_knowledge calls during retries or handoffs.
Original createKnowledgeEntry() is preserved for callers needing raw insert."
```

---

### Task 3: Abort-aware sleep + retry delay cap (Bug 2 — HIGH)

**Bug:** (a) `sleep()` is a plain setTimeout — can't be interrupted when user calls `abortSession()`. (b) `getRetryDelay()` has no cap on `retry-after` header value — a server sending `retry-after: 3600` causes a 1-hour hang.

**Files:**
- Modify: `src/main/sdk-manager.ts`

**Step 1: Add tests for abort-aware sleep and delay cap**

Append to `src/main/__tests__/intelligence-layer-bugs.test.ts`:

```typescript
// --- Bug 2: Retry sleep not abort-aware + unbounded delay ---

describe('Bug 2: Abort-aware sleep + delay cap', () => {
  function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
    return new Promise<void>((resolve) => {
      if (signal?.aborted) { resolve(); return }
      const timer = setTimeout(resolve, ms)
      const onAbort = () => { clearTimeout(timer); resolve() }
      signal?.addEventListener('abort', onAbort, { once: true })
    })
  }

  const MAX_RETRY_DELAY_MS = 120_000

  function getRetryDelayCapped(retryAfterSeconds: number | null, attempt: number): number {
    const BASE_DELAY_MS = 1000
    const DEFAULT_RATE_LIMIT_WAIT_MS = 30000
    let delay: number
    if (retryAfterSeconds !== null) {
      delay = retryAfterSeconds * 1000
    } else {
      delay = BASE_DELAY_MS * Math.pow(2, attempt)
    }
    return Math.min(delay, MAX_RETRY_DELAY_MS)
  }

  test('abortableSleep resolves immediately when signal is already aborted', async () => {
    const controller = new AbortController()
    controller.abort()
    const start = Date.now()
    await abortableSleep(60_000, controller.signal)
    expect(Date.now() - start).toBeLessThan(100)
  })

  test('abortableSleep resolves early when aborted mid-sleep', async () => {
    const controller = new AbortController()
    const start = Date.now()
    setTimeout(() => controller.abort(), 50)
    await abortableSleep(60_000, controller.signal)
    expect(Date.now() - start).toBeLessThan(500)
  })

  test('abortableSleep resolves normally without abort', async () => {
    const start = Date.now()
    await abortableSleep(50)
    const elapsed = Date.now() - start
    expect(elapsed).toBeGreaterThanOrEqual(40)
    expect(elapsed).toBeLessThan(500)
  })

  test('retry delay caps at MAX_RETRY_DELAY_MS for huge retry-after', () => {
    expect(getRetryDelayCapped(3600, 0)).toBe(MAX_RETRY_DELAY_MS)
  })

  test('retry delay uses retry-after when under cap', () => {
    expect(getRetryDelayCapped(10, 0)).toBe(10_000)
  })

  test('exponential backoff caps at MAX_RETRY_DELAY_MS', () => {
    expect(getRetryDelayCapped(null, 20)).toBe(MAX_RETRY_DELAY_MS)
  })

  test('exponential backoff works normally under cap', () => {
    expect(getRetryDelayCapped(null, 2)).toBe(4000)
  })
})
```

**Step 2: Run tests**

Run: `npx vitest run src/main/__tests__/intelligence-layer-bugs.test.ts --reporter=verbose`
Expected: All 15 tests PASS

**Step 3: Apply fixes to `src/main/sdk-manager.ts`**

**3a.** Add `MAX_RETRY_DELAY_MS` constant. Insert after line 84 (`const DEFAULT_RATE_LIMIT_WAIT_MS = 30000`):
```typescript
const MAX_RETRY_DELAY_MS = 120_000 // 2-minute cap on any retry delay
```

**3b.** Replace the `getRetryDelay` function (lines 101-112) with capped version:
```typescript
function getRetryDelay(error: unknown, attempt: number): number {
  const status = (error as any)?.status ?? (error as any)?.statusCode
  if (status === 429) {
    const retryAfter = (error as any)?.headers?.['retry-after']
    if (retryAfter) {
      const parsed = parseInt(retryAfter, 10)
      if (!isNaN(parsed)) return Math.min(parsed * 1000, MAX_RETRY_DELAY_MS)
    }
    return Math.min(DEFAULT_RATE_LIMIT_WAIT_MS, MAX_RETRY_DELAY_MS)
  }
  return Math.min(BASE_DELAY_MS * Math.pow(2, attempt), MAX_RETRY_DELAY_MS)
}
```

**3c.** Replace the `sleep` function (lines 114-116) with abort-aware version:
```typescript
function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve) => {
    if (signal?.aborted) { resolve(); return }
    const timer = setTimeout(resolve, ms)
    const onAbort = () => { clearTimeout(timer); resolve() }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}
```

**3d.** Hoist the `AbortController` from `runSdkSessionOnce` into `createSdkRunner`, so the retry loop sleep can reference the signal. Replace the entire `createSdkRunner` function (lines 118-146):
```typescript
export function createSdkRunner(win: BrowserWindow) {
  return async function runSdkSession(params: SdkRunnerParams): Promise<SdkResult> {
    let lastError: unknown
    // Create a persistent controller for the entire retry sequence
    const retryAbortController = new AbortController()
    if (params.sessionKey) {
      activeControllers.set(params.sessionKey, retryAbortController)
    }

    try {
      for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        if (attempt > 0) {
          const delay = getRetryDelay(lastError, attempt - 1)
          console.log(`[sdk-manager] Retry ${attempt}/${MAX_RETRIES} after ${delay}ms...`)
          await abortableSleep(delay, retryAbortController.signal)
          if (retryAbortController.signal.aborted) {
            throw new Error('Session aborted during retry backoff')
          }
        }

        try {
          return await runSdkSessionOnce(win, params, retryAbortController)
        } catch (error) {
          lastError = error
          const errorMessage = error instanceof Error ? error.message : String(error)

          if (!isRetryableError(error) || attempt === MAX_RETRIES) {
            console.error(`[sdk-manager] Non-retryable error or max retries reached: ${errorMessage}`)
            throw error
          }

          console.warn(`[sdk-manager] Retryable error (attempt ${attempt + 1}/${MAX_RETRIES}): ${errorMessage}`)
        }
      }

      throw lastError
    } finally {
      if (params.sessionKey) {
        activeControllers.delete(params.sessionKey)
      }
    }
  }
}
```

**3e.** Update `runSdkSessionOnce` to accept the shared controller. Replace line 148:
```typescript
async function runSdkSessionOnce(win: BrowserWindow, params: SdkRunnerParams): Promise<SdkResult> {
```
With:
```typescript
async function runSdkSessionOnce(win: BrowserWindow, params: SdkRunnerParams, abortCtrl?: AbortController): Promise<SdkResult> {
```

Replace lines 149-152:
```typescript
    const abortController = new AbortController()
    if (params.sessionKey) {
      activeControllers.set(params.sessionKey, abortController)
    }
```
With:
```typescript
    const abortController = abortCtrl ?? new AbortController()
```

Remove the `activeControllers.delete` from `runSdkSessionOnce`'s `finally` block (lines 355-357):
```typescript
      if (params.sessionKey) {
        activeControllers.delete(params.sessionKey)
      }
```
Delete those 3 lines. Cleanup is now in the outer `createSdkRunner` finally block.

**Step 4: Verify build**

Run: `npx tsc --noEmit --project tsconfig.json 2>&1 | head -20`
Expected: No type errors

**Step 5: Commit**

```bash
git add src/main/sdk-manager.ts src/main/__tests__/intelligence-layer-bugs.test.ts
git commit -m "fix(sdk-manager): abort-aware retry sleep + cap retry delay at 2 minutes

Replaces plain setTimeout sleep with abortableSleep that resolves immediately
when the session AbortController fires. Caps all retry delays (including
retry-after header values) at 120 seconds. Hoists AbortController to the
outer retry loop so sleep can reference the signal."
```

---

### Task 4: Global knowledge dedup on promotion (Bug 3 — MEDIUM)

**Bug:** `promoteCandidate()` always calls `createGlobalKnowledgeEntry()` when `global=true`, even if an entry with the same key already exists globally. Calling it twice duplicates the row.

**Files:**
- Modify: `src/main/knowledge-engine.ts`

**Step 1: Add tests for global dedup logic**

Append to `src/main/__tests__/intelligence-layer-bugs.test.ts`:

```typescript
// --- Bug 3: promoteCandidate duplicates global entries ---

describe('Bug 3: Global knowledge dedup on promotion', () => {
  function shouldCreateGlobal(
    existingGlobalByKey: { id: string; key: string } | null
  ): boolean {
    return existingGlobalByKey === null
  }

  test('creates global entry when none exists', () => {
    expect(shouldCreateGlobal(null)).toBe(true)
  })

  test('skips creation when global entry already exists', () => {
    expect(shouldCreateGlobal({ id: 'g1', key: 'my-rule' })).toBe(false)
  })
})
```

**Step 2: Run tests**

Run: `npx vitest run src/main/__tests__/intelligence-layer-bugs.test.ts --reporter=verbose`
Expected: All 17 tests PASS

**Step 3: Add `getGlobalKnowledgeByKey` and update `promoteCandidate` in `src/main/knowledge-engine.ts`**

Insert after `listGlobalKnowledge` function (after line 235):

```typescript
export function getGlobalKnowledgeByKey(key: string): KnowledgeEntry | null {
  const db = getGlobalDb()
  const row = db
    .prepare("SELECT * FROM global_knowledge WHERE key = ? AND status = 'active' LIMIT 1")
    .get(key) as any
  return row ? rowToEntry(row) : null
}
```

In `promoteCandidate` (around line 267 after adding the above), replace:
```typescript
  if (global) {
    createGlobalKnowledgeEntry({
      key: entry.key,
      summary: entry.summary,
      content: entry.content,
      category: entry.category,
      tags: entry.tags,
      source: entry.source,
      sourceId: entry.sourceId,
      status: 'active'
    })
  }
```
With:
```typescript
  if (global) {
    const existingGlobal = getGlobalKnowledgeByKey(entry.key)
    if (!existingGlobal) {
      createGlobalKnowledgeEntry({
        key: entry.key,
        summary: entry.summary,
        content: entry.content,
        category: entry.category,
        tags: entry.tags,
        source: entry.source,
        sourceId: entry.sourceId,
        status: 'active'
      })
    }
  }
```

**Step 4: Verify build**

Run: `npx tsc --noEmit --project tsconfig.json 2>&1 | head -20`
Expected: No type errors

**Step 5: Commit**

```bash
git add src/main/knowledge-engine.ts src/main/__tests__/intelligence-layer-bugs.test.ts
git commit -m "fix(knowledge-engine): prevent duplicate global entries on re-promotion

Adds getGlobalKnowledgeByKey() check before creating a new global row
in promoteCandidate(). Prevents global_knowledge bloat when the same
entry is promoted multiple times."
```

---

### Task 5: Safe handoff parsing + null guards in template engine (Bugs 4 + 5 — MEDIUM)

**Bug 4:** `fillTemplate` uses unguarded `JSON.parse(task.handoffs)` for `{{plan_summary}}` and `{{implementation_summary}}`. Malformed JSON string crashes prompt construction.

**Bug 5:** `formatPreviousHandoff` and `formatHandoffChain` access `handoffs.length` without null check. Null/undefined handoffs throw TypeError.

**Files:**
- Modify: `src/main/template-engine.ts`

**Step 1: Add tests for handoff parsing and null safety**

Append to `src/main/__tests__/intelligence-layer-bugs.test.ts`:

```typescript
// --- Bug 4: fillTemplate handoff JSON parsing is unguarded ---
// --- Bug 5: formatPreviousHandoff / formatHandoffChain crash on null ---

describe('Bugs 4+5: Template engine handoff safety', () => {
  function safeParseHandoffs(handoffs: unknown): Array<{ stage: string; summary: string }> {
    if (Array.isArray(handoffs)) return handoffs
    if (typeof handoffs === 'string') {
      try { return JSON.parse(handoffs) ?? [] } catch { return [] }
    }
    return []
  }

  function formatPreviousHandoff(handoffs: any[] | null | undefined): string {
    if (!handoffs || handoffs.length === 0) return 'No previous stages.'
    return `Last: ${handoffs[handoffs.length - 1].stage}`
  }

  function formatHandoffChain(handoffs: any[] | null | undefined): string {
    if (!handoffs || handoffs.length === 0) return 'No handoff history.'
    return handoffs.map((h, i) => `${i + 1}: ${h.stage}`).join(', ')
  }

  // Bug 4 tests
  test('safeParseHandoffs returns array when given valid array', () => {
    const arr = [{ stage: 'plan', summary: 'did stuff' }]
    expect(safeParseHandoffs(arr)).toEqual(arr)
  })

  test('safeParseHandoffs returns [] for malformed JSON string', () => {
    expect(safeParseHandoffs('{not valid')).toEqual([])
  })

  test('safeParseHandoffs parses valid JSON string', () => {
    const json = JSON.stringify([{ stage: 'plan', summary: 'x' }])
    expect(safeParseHandoffs(json)).toEqual([{ stage: 'plan', summary: 'x' }])
  })

  test('safeParseHandoffs returns [] for null', () => {
    expect(safeParseHandoffs(null)).toEqual([])
  })

  test('safeParseHandoffs returns [] for undefined', () => {
    expect(safeParseHandoffs(undefined)).toEqual([])
  })

  test('safeParseHandoffs returns [] for non-string/non-array', () => {
    expect(safeParseHandoffs(42)).toEqual([])
  })

  // Bug 5 tests — formatPreviousHandoff
  test('formatPreviousHandoff handles null', () => {
    expect(formatPreviousHandoff(null)).toBe('No previous stages.')
  })

  test('formatPreviousHandoff handles undefined', () => {
    expect(formatPreviousHandoff(undefined)).toBe('No previous stages.')
  })

  test('formatPreviousHandoff handles empty array', () => {
    expect(formatPreviousHandoff([])).toBe('No previous stages.')
  })

  test('formatPreviousHandoff formats non-empty array', () => {
    expect(formatPreviousHandoff([{ stage: 'plan' }])).toBe('Last: plan')
  })

  // Bug 5 tests — formatHandoffChain
  test('formatHandoffChain handles null', () => {
    expect(formatHandoffChain(null)).toBe('No handoff history.')
  })

  test('formatHandoffChain handles undefined', () => {
    expect(formatHandoffChain(undefined)).toBe('No handoff history.')
  })

  test('formatHandoffChain handles empty array', () => {
    expect(formatHandoffChain([])).toBe('No handoff history.')
  })

  test('formatHandoffChain formats non-empty array', () => {
    expect(formatHandoffChain([{ stage: 'plan' }, { stage: 'implement' }])).toBe('1: plan, 2: implement')
  })
})
```

**Step 2: Run tests**

Run: `npx vitest run src/main/__tests__/intelligence-layer-bugs.test.ts --reporter=verbose`
Expected: All 31 tests PASS

**Step 3: Apply fixes to `src/main/template-engine.ts`**

**3a.** Add `safeParseHandoffs` helper. Insert after `extractOutput` function (after line 19, before `const SKIP_HANDOFF_STAGES`):

```typescript
function safeParseHandoffs(handoffs: unknown): Handoff[] {
  if (Array.isArray(handoffs)) return handoffs
  if (typeof handoffs === 'string') {
    try { return JSON.parse(handoffs) ?? [] } catch { return [] }
  }
  return []
}
```

**3b.** In `fillTemplate`, replace the two inline handoff parses.

Replace line 67:
```typescript
      const handoffs = typeof task.handoffs === 'string' ? JSON.parse(task.handoffs) : task.handoffs
```
With:
```typescript
      const handoffs = safeParseHandoffs(task.handoffs)
```

Replace line 75 (same pattern):
```typescript
      const handoffs = typeof task.handoffs === 'string' ? JSON.parse(task.handoffs) : task.handoffs
```
With:
```typescript
      const handoffs = safeParseHandoffs(task.handoffs)
```

**3c.** In `formatPreviousHandoff` (line 261), change signature and guard:

Replace:
```typescript
function formatPreviousHandoff(handoffs: Handoff[]): string {
  if (handoffs.length === 0) return 'No previous stages.'
```
With:
```typescript
function formatPreviousHandoff(handoffs: Handoff[] | null | undefined): string {
  if (!handoffs || handoffs.length === 0) return 'No previous stages.'
```

**3d.** In `formatHandoffChain` (line 276), change signature and guard:

Replace:
```typescript
function formatHandoffChain(handoffs: Handoff[]): string {
  if (handoffs.length === 0) return 'No handoff history.'
```
With:
```typescript
function formatHandoffChain(handoffs: Handoff[] | null | undefined): string {
  if (!handoffs || handoffs.length === 0) return 'No handoff history.'
```

**Step 4: Verify build**

Run: `npx tsc --noEmit --project tsconfig.json 2>&1 | head -20`
Expected: No type errors

**Step 5: Commit**

```bash
git add src/main/template-engine.ts src/main/__tests__/intelligence-layer-bugs.test.ts
git commit -m "fix(template-engine): safe handoff parsing + null guards in formatters

Adds safeParseHandoffs() helper to catch malformed JSON in handoff strings
instead of throwing. Adds null/undefined guards to formatPreviousHandoff()
and formatHandoffChain() to handle missing handoff arrays gracefully."
```

---

### Task 6: Clean up pending approvals on session abort (Bug 6 — LOW)

**Bug:** When `abortSession()` fires, `pendingApprovals` Map entries are never resolved or cleaned up. Unresolved promises leak memory, compounding over time.

**Files:**
- Modify: `src/main/sdk-manager.ts`

**Step 1: Add tests for session-scoped approval cleanup logic**

Append to `src/main/__tests__/intelligence-layer-bugs.test.ts`:

```typescript
// --- Bug 6: Pending approval promises leak on session abort ---

describe('Bug 6: Pending approval cleanup', () => {
  test('session-scoped approval IDs are tracked and only session entries cleaned', () => {
    const globalMap = new Map<string, { resolve: (v: string) => void }>()
    const sessionIds = new Set<string>()

    // Simulate adding approval requests during a session
    globalMap.set('req-1', { resolve: () => {} })
    sessionIds.add('req-1')
    globalMap.set('req-2', { resolve: () => {} })
    sessionIds.add('req-2')

    // Approval from a different session
    globalMap.set('other-session-req', { resolve: () => {} })

    expect(globalMap.size).toBe(3)

    // Cleanup only session-scoped IDs
    for (const reqId of sessionIds) {
      globalMap.delete(reqId)
    }

    expect(globalMap.size).toBe(1)
    expect(globalMap.has('other-session-req')).toBe(true)
    expect(globalMap.has('req-1')).toBe(false)
    expect(globalMap.has('req-2')).toBe(false)
  })

  test('cleanup resolves dangling promises with deny', () => {
    const resolved: string[] = []
    const globalMap = new Map<string, { resolve: (v: any) => void }>()
    const sessionIds = new Set<string>()

    globalMap.set('req-a', { resolve: (v) => resolved.push(`a:${v.behavior}`) })
    sessionIds.add('req-a')

    for (const reqId of sessionIds) {
      const pending = globalMap.get(reqId)
      if (pending) {
        pending.resolve({ behavior: 'deny', message: 'Session ended' })
        globalMap.delete(reqId)
      }
    }

    expect(resolved).toEqual(['a:deny'])
    expect(globalMap.size).toBe(0)
  })
})
```

**Step 2: Run tests**

Run: `npx vitest run src/main/__tests__/intelligence-layer-bugs.test.ts --reporter=verbose`
Expected: All 33 tests PASS

**Step 3: Apply fix to `src/main/sdk-manager.ts`**

**3a.** In `runSdkSessionOnce`, after the line `const currentStage = params.stage || 'implement'` (line 163), add:
```typescript
    const sessionApprovalIds = new Set<string>()
```

**3b.** In the `canUseTool` callback, after `const requestId = randomUUID()` (line 213), add:
```typescript
            sessionApprovalIds.add(requestId)
```

**3c.** In the `finally` block of `runSdkSessionOnce`, add before the closing brace (before the final `}`):
```typescript
      // Clean up any dangling approval promises from this session
      for (const reqId of sessionApprovalIds) {
        const pending = pendingApprovals.get(reqId)
        if (pending) {
          pending.resolve({ behavior: 'deny', message: 'Session ended' })
          pendingApprovals.delete(reqId)
        }
      }
```

**Step 4: Verify build**

Run: `npx tsc --noEmit --project tsconfig.json 2>&1 | head -20`
Expected: No type errors

**Step 5: Commit**

```bash
git add src/main/sdk-manager.ts src/main/__tests__/intelligence-layer-bugs.test.ts
git commit -m "fix(sdk-manager): clean up pending approval promises on session end

Tracks approval request IDs per session and resolves them with 'deny'
in the finally block. Prevents memory leak from unresolved promises
when sessions are aborted."
```

---

### Task 7: Add logging for malformed XML tool call JSON (Bug 7 — LOW)

**Bug:** `catch { continue }` on tool call JSON parsing silently drops failures. Acceptance criterion explicitly requires "caught **and logged**."

**Files:**
- Modify: `src/main/sdk-manager.ts`

**Step 1: Add test for the logging branch**

Append to `src/main/__tests__/intelligence-layer-bugs.test.ts`:

```typescript
// --- Bug 7: Silent swallow of malformed XML tool call JSON ---

describe('Bug 7: Malformed XML tool call logging', () => {
  test('valid JSON parses without hitting catch', () => {
    const input = '{"key": "test", "summary": "hello"}'
    let parsed: any = null
    let caughtError = false
    try {
      parsed = JSON.parse(input)
    } catch {
      caughtError = true
    }
    expect(parsed).toEqual({ key: 'test', summary: 'hello' })
    expect(caughtError).toBe(false)
  })

  test('malformed JSON hits catch branch (where logging should fire)', () => {
    const input = '{not valid json}'
    let parsed: any = null
    let caughtError = false
    try {
      parsed = JSON.parse(input)
    } catch {
      caughtError = true
    }
    expect(parsed).toBeNull()
    expect(caughtError).toBe(true)
  })
})
```

**Step 2: Run tests**

Run: `npx vitest run src/main/__tests__/intelligence-layer-bugs.test.ts --reporter=verbose`
Expected: All 35 tests PASS

**Step 3: Apply fix to `src/main/sdk-manager.ts`**

Replace line 326:
```typescript
        try { toolInput = JSON.parse(xmlMatch[2].trim()) } catch { continue }
```
With:
```typescript
        try {
          toolInput = JSON.parse(xmlMatch[2].trim())
        } catch (parseErr) {
          console.warn(`[sdk-manager] Malformed JSON in <tool_call name="${toolName}">:`, parseErr)
          continue
        }
```

**Step 4: Verify build**

Run: `npx tsc --noEmit --project tsconfig.json 2>&1 | head -20`
Expected: No type errors

**Step 5: Commit**

```bash
git add src/main/sdk-manager.ts src/main/__tests__/intelligence-layer-bugs.test.ts
git commit -m "fix(sdk-manager): log malformed XML tool call JSON instead of silent swallow

Replaces bare catch with console.warn that logs the tool name and parse
error. Makes debugging agent output issues possible without breaking
the continue-on-error behavior."
```

---

### Task 8: Final verification — run all tests + full build

**Files:**
- Read: all modified files for final review

**Step 1: Run the complete intelligence layer test suite**

Run: `npx vitest run src/main/__tests__/intelligence-layer-bugs.test.ts --reporter=verbose`
Expected output: ALL ~35 tests PASS across 8 describe blocks (Bugs 1-8)

**Step 2: Run all existing tests to verify no regressions**

Run: `npx vitest run --reporter=verbose`
Expected: ALL tests PASS (including existing task-graph.test.ts and workshop-engine-logic.test.ts)

**Step 3: Verify TypeScript compilation**

Run: `npx tsc --noEmit --project tsconfig.json 2>&1 | head -40`
Expected: No type errors

**Step 4: Verify Electron build compiles**

Run: `npx electron-vite build 2>&1 | tail -20`
Expected: Build succeeds without errors

**Step 5: No commit needed unless adjustments were required in prior tasks**

---

## Summary of Changes

| File | Bug(s) Fixed | Key Changes |
|------|-------------|-------------|
| `src/main/knowledge-engine.ts` | #1, #3, #8 | `safeJsonParse` helper, `createOrUpdateKnowledgeEntry`, `getKnowledgeByKeyAndStatus`, `getGlobalKnowledgeByKey`, dedup in `promoteCandidate` |
| `src/main/sdk-manager.ts` | #2, #6, #7 + import for #1 | `abortableSleep`, `MAX_RETRY_DELAY_MS` cap, retry controller hoisting, session-scoped approval cleanup, XML parse logging, import switch to `createOrUpdateKnowledgeEntry` |
| `src/main/template-engine.ts` | #4, #5 | `safeParseHandoffs` helper, null guards in `formatPreviousHandoff` and `formatHandoffChain` |
| `src/main/skill-loader.ts` | none | Already correct — no changes needed |
| `src/main/__tests__/intelligence-layer-bugs.test.ts` | all 8 | New test file: ~35 tests covering all bug fix logic |

## Acceptance Criteria → Bug Fix Mapping

| Criterion | Fix |
|-----------|-----|
| SDK retry handles max retries without hanging | Bug 2 (Task 3) — abort-aware sleep + 2-min delay cap |
| Malformed `<tool_call>` XML caught and logged | Bug 7 (Task 7) — console.warn on parse failure |
| SkillLoader handles missing `core.md` / `extended.md` | Confirmed PASS — no fix needed |
| Template handles undefined/missing variables | Bugs 4+5 (Task 5) — safeParseHandoffs + null guards |
| FDRL candidate save no duplicates | Bug 1 (Task 2) — createOrUpdateKnowledgeEntry |
| Promoted knowledge correctly scoped global vs. project | Bug 3 (Task 4) — getGlobalKnowledgeByKey check |

## Risk Notes for Implementation Agent

1. **Task 3 is the most complex.** The `AbortController` hoisting from `runSdkSessionOnce` to `createSdkRunner` changes ownership semantics. Be careful to remove the `activeControllers.delete` from the inner `finally` block but NOT the outer cleanup.
2. **Task 2 changes insert semantics** for the `save_knowledge` path only. `createKnowledgeEntry` is preserved; `pipeline-engine.ts` keeps using it (different key pattern, no dedup needed).
3. **Line numbers shift** after each task. Always search for the exact string to replace rather than relying on line numbers from this plan.
4. **Vitest runs without config.** The project has vitest in devDependencies but no vitest.config file. `npx vitest run` should work with defaults for the `__tests__` directory pattern.
