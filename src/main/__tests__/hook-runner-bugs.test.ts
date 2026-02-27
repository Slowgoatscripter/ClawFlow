import { describe, test, expect } from 'vitest'
import { runHook } from '../hook-runner'
import type { ValidationHook } from '../../shared/hook-types'

describe('FIX-8: Hook timeout vs failure distinction', () => {
  test('hook timeout includes "timed out after Xms" in output', async () => {
    // Use a command that will run longer than the 100ms timeout
    const hook: ValidationHook = {
      name: 'slow-hook',
      command: process.platform === 'win32' ? 'ping' : 'sleep',
      args: process.platform === 'win32' ? ['-n', '30', '127.0.0.1'] : ['30'],
      required: true,
      timeout: 100
    }

    const result = await runHook(hook, process.cwd())
    expect(result.success).toBe(false)
    expect(result.output).toContain('timed out after')
    expect(result.output).toContain('100ms')
  }, 5000)

  test('normal command failure does not include timeout message', async () => {
    const hook: ValidationHook = {
      name: 'bad-hook',
      command: process.platform === 'win32' ? 'cmd' : 'sh',
      args: process.platform === 'win32' ? ['/c', 'exit 1'] : ['-c', 'exit 1'],
      required: true,
      timeout: 30000
    }

    const result = await runHook(hook, process.cwd())
    expect(result.success).toBe(false)
    expect(result.output).not.toContain('timed out after')
  }, 5000)
})
