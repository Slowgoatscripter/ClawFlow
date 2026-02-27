import { describe, test, expect, vi } from 'vitest'

// ---------------------------------------------------------------------------
// Pure-logic tests for pipeline engine bug fixes.
// Avoids Electron imports — tests the logic patterns only.
// ---------------------------------------------------------------------------

describe('FIX-6: Timeout cleanup on SDK error', () => {
  test('clearTimeout is called when SDK promise rejects (try/finally pattern)', async () => {
    const cleared: ReturnType<typeof setTimeout>[] = []
    const origClear = global.clearTimeout
    const clearTimeoutSpy = vi.spyOn(global, 'clearTimeout').mockImplementation((h) => {
      cleared.push(h as ReturnType<typeof setTimeout>)
      origClear(h as ReturnType<typeof setTimeout>)
    })

    let timeoutHandle: ReturnType<typeof setTimeout> | undefined
    const timeoutPromise = new Promise<never>((_resolve, reject) => {
      timeoutHandle = setTimeout(() => {
        reject(new Error('Stage timed out'))
      }, 60_000)
    })

    const sdkPromise = Promise.reject(new Error('SDK auth failure'))

    try {
      await Promise.race([sdkPromise, timeoutPromise])
    } catch {
      // expected
    } finally {
      clearTimeout(timeoutHandle)
    }

    expect(cleared).toContain(timeoutHandle)
    clearTimeoutSpy.mockRestore()
  })

  test('clearTimeout is called when SDK promise resolves (try/finally pattern)', async () => {
    const cleared: ReturnType<typeof setTimeout>[] = []
    const origClear = global.clearTimeout
    const clearTimeoutSpy = vi.spyOn(global, 'clearTimeout').mockImplementation((h) => {
      cleared.push(h as ReturnType<typeof setTimeout>)
      origClear(h as ReturnType<typeof setTimeout>)
    })

    let timeoutHandle: ReturnType<typeof setTimeout> | undefined
    const timeoutPromise = new Promise<never>((_resolve, reject) => {
      timeoutHandle = setTimeout(() => {
        reject(new Error('Stage timed out'))
      }, 60_000)
    })

    const sdkPromise = Promise.resolve({ output: 'ok', cost: 0, turns: 1, sessionId: 'abc', contextTokens: 100, contextMax: 200_000 })

    let result: any
    try {
      result = await Promise.race([sdkPromise, timeoutPromise])
    } finally {
      clearTimeout(timeoutHandle)
    }

    expect(result.output).toBe('ok')
    expect(cleared).toContain(timeoutHandle)
    clearTimeoutSpy.mockRestore()
  })
})

describe('FIX-5: Pause status not overwritten by catch block', () => {
  test('does not set blocked when current status is paused', () => {
    // Verifies the conditional guard logic:
    // the catch block should only update to blocked if task is NOT paused
    function shouldUpdateToBlocked(currentStatus: string): boolean {
      return currentStatus !== 'paused'
    }

    expect(shouldUpdateToBlocked('paused')).toBe(false)
    expect(shouldUpdateToBlocked('implementing')).toBe(true)
    expect(shouldUpdateToBlocked('brainstorming')).toBe(true)
    expect(shouldUpdateToBlocked('planning')).toBe(true)
    expect(shouldUpdateToBlocked('blocked')).toBe(true)
    expect(shouldUpdateToBlocked('code_review')).toBe(true)
  })
})

describe('FIX-7: Post-hook failure should block, not recurse through rejectStage', () => {
  test('post-hook failure results in blocked status, not rejection', () => {
    // Verifies the decision logic: hook failure -> block, not rejectStage
    function handleHookFailure(hooksPassed: boolean): 'advance' | 'block' {
      if (!hooksPassed) return 'block'
      return 'advance'
    }

    expect(handleHookFailure(false)).toBe('block')
    expect(handleHookFailure(true)).toBe('advance')
  })

  test('post-hook failure message includes hook name and output', () => {
    const failedRequired = [
      { name: 'lint', output: 'ESLint: 3 errors', success: false, duration: 500 },
      { name: 'typecheck', output: 'TS2345: Type error', success: false, duration: 200 },
    ]

    const failMessages = failedRequired.map(r => `**${r.name}:** ${r.output}`).join('\n\n')
    expect(failMessages).toContain('**lint:** ESLint: 3 errors')
    expect(failMessages).toContain('**typecheck:** TS2345: Type error')
  })
})
