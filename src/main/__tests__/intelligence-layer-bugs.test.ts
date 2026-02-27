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
