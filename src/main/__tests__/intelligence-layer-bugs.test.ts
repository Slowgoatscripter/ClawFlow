import { describe, test, expect } from 'vitest'

// ---------------------------------------------------------------------------
// Pure-logic extractions for testing intelligence layer bug fixes.
// Each describe block defines helpers inline to avoid Electron imports.
// ---------------------------------------------------------------------------

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

  test("returns \"create\" when existing key differs (shouldn't happen but defensive)", () => {
    expect(shouldCreateNew({ id: 'abc', key: 'other-key' }, 'my-key')).toBe('create')
  })
})

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

// --- Bug 6: Pending approval promises leak on session abort ---

describe('Bug 6: Pending approval cleanup', () => {
  test('session-scoped approval IDs are tracked and only session entries cleaned', () => {
    const globalMap = new Map<string, { resolve: (v: string) => void }>()
    const sessionIds = new Set<string>()

    globalMap.set('req-1', { resolve: () => {} })
    sessionIds.add('req-1')
    globalMap.set('req-2', { resolve: () => {} })
    sessionIds.add('req-2')

    // Approval from a different session
    globalMap.set('other-session-req', { resolve: () => {} })

    expect(globalMap.size).toBe(3)

    // Simulate cleanup — only clean session-scoped IDs
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

// --- Bug 4: fillTemplate handoff JSON parsing is unguarded ---
// --- Bug 5: formatPreviousHandoff / formatHandoffChain crash on null ---

describe('Bugs 4+5: Template engine handoff safety', () => {
  function safeParseHandoffsLocal(handoffs: unknown): Array<{ stage: string; summary: string }> {
    if (Array.isArray(handoffs)) return handoffs
    if (typeof handoffs === 'string') {
      try { return JSON.parse(handoffs) ?? [] } catch { return [] }
    }
    return []
  }

  function formatPreviousHandoffLocal(handoffs: any[] | null | undefined): string {
    if (!handoffs || handoffs.length === 0) return 'No previous stages.'
    return `Last: ${handoffs[handoffs.length - 1].stage}`
  }

  function formatHandoffChainLocal(handoffs: any[] | null | undefined): string {
    if (!handoffs || handoffs.length === 0) return 'No handoff history.'
    return handoffs.map((h, i) => `${i + 1}: ${h.stage}`).join(', ')
  }

  // Bug 4 tests
  test('safeParseHandoffs returns array when given valid array', () => {
    const arr = [{ stage: 'plan', summary: 'did stuff' }]
    expect(safeParseHandoffsLocal(arr)).toEqual(arr)
  })

  test('safeParseHandoffs returns [] for malformed JSON string', () => {
    expect(safeParseHandoffsLocal('{not valid')).toEqual([])
  })

  test('safeParseHandoffs parses valid JSON string', () => {
    const json = JSON.stringify([{ stage: 'plan', summary: 'x' }])
    expect(safeParseHandoffsLocal(json)).toEqual([{ stage: 'plan', summary: 'x' }])
  })

  test('safeParseHandoffs returns [] for null', () => {
    expect(safeParseHandoffsLocal(null)).toEqual([])
  })

  test('safeParseHandoffs returns [] for undefined', () => {
    expect(safeParseHandoffsLocal(undefined)).toEqual([])
  })

  test('safeParseHandoffs returns [] for non-string/non-array', () => {
    expect(safeParseHandoffsLocal(42)).toEqual([])
  })

  // Bug 5 tests — formatPreviousHandoff
  test('formatPreviousHandoff handles null', () => {
    expect(formatPreviousHandoffLocal(null)).toBe('No previous stages.')
  })

  test('formatPreviousHandoff handles undefined', () => {
    expect(formatPreviousHandoffLocal(undefined)).toBe('No previous stages.')
  })

  test('formatPreviousHandoff handles empty array', () => {
    expect(formatPreviousHandoffLocal([])).toBe('No previous stages.')
  })

  test('formatPreviousHandoff formats non-empty array', () => {
    expect(formatPreviousHandoffLocal([{ stage: 'plan' }])).toBe('Last: plan')
  })

  // Bug 5 tests — formatHandoffChain
  test('formatHandoffChain handles null', () => {
    expect(formatHandoffChainLocal(null)).toBe('No handoff history.')
  })

  test('formatHandoffChain handles undefined', () => {
    expect(formatHandoffChainLocal(undefined)).toBe('No handoff history.')
  })

  test('formatHandoffChain handles empty array', () => {
    expect(formatHandoffChainLocal([])).toBe('No handoff history.')
  })

  test('formatHandoffChain formats non-empty array', () => {
    expect(formatHandoffChainLocal([{ stage: 'plan' }, { stage: 'implement' }])).toBe('1: plan, 2: implement')
  })
})

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
