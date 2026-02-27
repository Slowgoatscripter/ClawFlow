import { describe, test, expect } from 'vitest'

// ---------------------------------------------------------------------------
// Pure-logic extractions for testing intelligence layer bug fixes.
// Each describe block defines helpers inline to avoid Electron imports.
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
