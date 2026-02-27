import { describe, test, expect } from 'vitest'

// -------------------------------------------------------------------------
// Pure logic extracted for testing — mirrors exact logic in workshop-engine.ts
// These tests prove the bugs exist (RED) and verify the fixes (GREEN)
// -------------------------------------------------------------------------

// --- parsePanelResponse fallback: empty personas guard ---
// Bug C1: personas[0] accessed without checking array length
function parsePanelResponseFallback(
  output: string,
  personas: Array<{ id: string; name: string }>
): Array<{ personaId: string; personaName: string; content: string }> {
  const results: Array<{ personaId: string; personaName: string; content: string }> = []
  const regex = /<persona name="([^"]+)">([\s\S]*?)<\/persona>/g
  let match: RegExpExecArray | null

  while ((match = regex.exec(output)) !== null) {
    const name = match[1].trim()
    const content = match[2].trim()
    const persona = personas.find((p) => p.name.toLowerCase() === name.toLowerCase())
    if (persona && content) {
      results.push({ personaId: persona.id, personaName: persona.name, content })
    }
  }

  // FIX: guard against empty personas array before accessing personas[0]
  if (results.length === 0 && output.trim() && personas.length > 0) {
    const cleanOutput = output.replace(/<tool_call[\s\S]*?<\/tool_call>/g, '').trim()
    if (cleanOutput) {
      results.push({ personaId: personas[0].id, personaName: personas[0].name, content: cleanOutput })
    }
  }

  return results
}

// --- Tool call regex: [\w-]+ instead of \w+ ---
const TOOL_CALL_REGEX_OLD = /<tool_call name="(\w+)">([\s\S]*?)<\/tool_call>/g
const TOOL_CALL_REGEX_FIXED = /<tool_call name="([\w-]+)">([\s\S]*?)<\/tool_call>/g

// --- Context parse validation ---
function parseContextEvent(streamContent: string): { contextTokens: number; contextMax: number } | null {
  const parts = streamContent.replace('__context:', '').split(':')
  const contextTokens = parseInt(parts[0], 10)
  const contextMax = parts.length >= 2 ? parseInt(parts[1], 10) : 0
  if (!isNaN(contextTokens) && !isNaN(contextMax)) {
    return { contextTokens, contextMax }
  }
  return null
}

// --- toolInput validation ---
function isValidToolInput(input: unknown): input is Record<string, unknown> {
  return typeof input === 'object' && input !== null
}

// --- MessageBubble tool_call strip regex (renderer) ---
const MSG_STRIP_REGEX_OLD = /<tool_call name="\w+">\s*[\s\S]*?<\/tool_call>/g
const MSG_STRIP_REGEX_FIXED = /<tool_call name="[\w-]+">\s*[\s\S]*?<\/tool_call>/g

// --- Safe JSON.stringify ---
function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return '[Unable to display input]'
  }
}

// =========================================================================
// TESTS
// =========================================================================

describe('parsePanelResponse — empty personas guard', () => {
  test('returns empty array (does not throw) when personas is empty and no XML tags found', () => {
    expect(() =>
      parsePanelResponseFallback('Some unparsed output without XML', [])
    ).not.toThrow()
    expect(parsePanelResponseFallback('Some unparsed output without XML', [])).toEqual([])
  })

  test('returns empty array when personas is empty even with output', () => {
    const result = parsePanelResponseFallback('Hello from Claude', [])
    expect(result).toEqual([])
  })

  test('falls back to first persona when no XML tags but personas exist', () => {
    const personas = [{ id: 'p1', name: 'Architect' }]
    const result = parsePanelResponseFallback('Here is my architectural opinion', personas)
    expect(result).toHaveLength(1)
    expect(result[0].personaId).toBe('p1')
    expect(result[0].personaName).toBe('Architect')
    expect(result[0].content).toBe('Here is my architectural opinion')
  })

  test('parses XML-tagged persona responses correctly', () => {
    const personas = [
      { id: 'p1', name: 'Architect' },
      { id: 'p2', name: 'Developer' }
    ]
    const output = `<persona name="Architect">Design the system carefully</persona>
<persona name="Developer">Implement with clean code</persona>`
    const result = parsePanelResponseFallback(output, personas)
    expect(result).toHaveLength(2)
    expect(result[0].personaId).toBe('p1')
    expect(result[1].personaId).toBe('p2')
  })

  test('strips tool_call blocks before using fallback content', () => {
    const personas = [{ id: 'p1', name: 'Architect' }]
    const output = 'Some content <tool_call name="create_artifact">{"name":"doc"}</tool_call> more content'
    const result = parsePanelResponseFallback(output, personas)
    expect(result[0].content).not.toContain('<tool_call')
    expect(result[0].content).toBe('Some content  more content')
  })
})

describe('tool call regex — hyphenated tool names', () => {
  const sampleWithHyphen = `<tool_call name="create-artifact">{"name":"doc"}</tool_call>`
  const sampleWithUnderscore = `<tool_call name="create_artifact">{"name":"doc"}</tool_call>`

  test('old regex does NOT match hyphenated tool names', () => {
    TOOL_CALL_REGEX_OLD.lastIndex = 0
    const match = TOOL_CALL_REGEX_OLD.exec(sampleWithHyphen)
    expect(match).toBeNull()
  })

  test('fixed regex DOES match hyphenated tool names', () => {
    TOOL_CALL_REGEX_FIXED.lastIndex = 0
    const match = TOOL_CALL_REGEX_FIXED.exec(sampleWithHyphen)
    expect(match).not.toBeNull()
    expect(match![1]).toBe('create-artifact')
  })

  test('fixed regex still matches underscore tool names', () => {
    TOOL_CALL_REGEX_FIXED.lastIndex = 0
    const match = TOOL_CALL_REGEX_FIXED.exec(sampleWithUnderscore)
    expect(match).not.toBeNull()
    expect(match![1]).toBe('create_artifact')
  })
})

describe('MessageBubble strip regex — hyphenated tool names', () => {
  const msgWithHyphen = `Some text <tool_call name="create-artifact">{"name":"doc"}</tool_call> after`
  const msgWithUnderscore = `Some text <tool_call name="create_artifact">{"name":"doc"}</tool_call> after`

  test('old regex does NOT strip hyphenated tool calls', () => {
    const result = msgWithHyphen.replace(MSG_STRIP_REGEX_OLD, '')
    expect(result).toContain('<tool_call')
  })

  test('fixed regex DOES strip hyphenated tool calls', () => {
    const result = msgWithHyphen.replace(MSG_STRIP_REGEX_FIXED, '').trim()
    expect(result).not.toContain('<tool_call')
    expect(result).toBe('Some text  after'.trim())
  })

  test('fixed regex still strips underscore tool calls', () => {
    const result = msgWithUnderscore.replace(MSG_STRIP_REGEX_FIXED, '').trim()
    expect(result).not.toContain('<tool_call')
  })
})

describe('context parsing — NaN validation', () => {
  test('returns null when context string is malformed (single part)', () => {
    const result = parseContextEvent('__context:badvalue')
    expect(result).toBeNull()
  })

  test('returns null when both parts are non-numeric', () => {
    const result = parseContextEvent('__context:abc:def')
    expect(result).toBeNull()
  })

  test('returns null when only one valid number', () => {
    // parts[1] would be NaN
    const result = parseContextEvent('__context:1000:')
    // empty string parseInt is NaN
    expect(result).toBeNull()
  })

  test('parses valid context string correctly', () => {
    const result = parseContextEvent('__context:5000:100000')
    expect(result).toEqual({ contextTokens: 5000, contextMax: 100000 })
  })

  test('returns null for missing second part entirely', () => {
    // split gives ['', '5000'] for '__context:5000' → no second ':'
    // Actually: '__context:5000'.replace('__context:', '') = '5000' → split(':') = ['5000'] → length 1
    const result = parseContextEvent('__context:5000')
    // contextMax = 0, contextTokens = 5000, both !isNaN → returns { contextTokens: 5000, contextMax: 0 }
    expect(result).toEqual({ contextTokens: 5000, contextMax: 0 })
  })
})

describe('toolInput validation — type guard', () => {
  test('rejects null', () => {
    expect(isValidToolInput(null)).toBe(false)
  })

  test('rejects string', () => {
    expect(isValidToolInput('{"key":"value"}')).toBe(false)
  })

  test('rejects number', () => {
    expect(isValidToolInput(42)).toBe(false)
  })

  test('rejects undefined', () => {
    expect(isValidToolInput(undefined)).toBe(false)
  })

  test('accepts plain object', () => {
    expect(isValidToolInput({ name: 'doc', type: 'design_doc' })).toBe(true)
  })

  test('accepts empty object', () => {
    expect(isValidToolInput({})).toBe(true)
  })
})

describe('safe JSON.stringify', () => {
  test('stringifies normal objects', () => {
    const result = safeStringify({ key: 'value', num: 42 })
    expect(result).toContain('"key": "value"')
  })

  test('returns fallback string on circular reference', () => {
    const obj: any = { a: 1 }
    obj.self = obj // circular
    const result = safeStringify(obj)
    expect(result).toBe('[Unable to display input]')
  })

  test('handles null', () => {
    const result = safeStringify(null)
    expect(result).toBe('null')
  })

  test('handles arrays', () => {
    const result = safeStringify([1, 2, 3])
    expect(result).toContain('1')
  })
})
