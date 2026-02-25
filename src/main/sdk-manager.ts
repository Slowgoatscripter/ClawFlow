import { query, type PermissionResult } from '@anthropic-ai/claude-agent-sdk'
import { randomUUID } from 'crypto'
import path from 'path'
import fs from 'fs'
import type { SdkRunnerParams, SdkResult } from './pipeline-engine'
import type { BrowserWindow } from 'electron'

interface PendingApproval {
  resolve: (result: PermissionResult) => void
}

const pendingApprovals = new Map<string, PendingApproval>()
const activeControllers = new Map<string, AbortController>()

export function abortSession(sessionKey: string): boolean {
  const controller = activeControllers.get(sessionKey)
  if (!controller) return false
  controller.abort()
  activeControllers.delete(sessionKey)
  return true
}

export function resolveApproval(requestId: string, approved: boolean, message?: string): void {
  const pending = pendingApprovals.get(requestId)
  if (!pending) return
  pendingApprovals.delete(requestId)

  if (approved) {
    pending.resolve({ behavior: 'allow' })
  } else {
    pending.resolve({ behavior: 'deny', message: message ?? 'User denied tool use' })
  }
}

// --- Retry Logic ---

const MAX_RETRIES = 3
const BASE_DELAY_MS = 1000
const DEFAULT_RATE_LIMIT_WAIT_MS = 30000

const RETRYABLE_NETWORK_CODES = new Set(['ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'ECONNREFUSED', 'EAI_AGAIN'])
const NON_RETRYABLE_STATUS_CODES = new Set([400, 401, 403, 404, 422])

function isRetryableError(error: unknown): boolean {
  if (error instanceof Error) {
    const code = (error as any).code
    if (code && RETRYABLE_NETWORK_CODES.has(code)) return true
    const status = (error as any).status ?? (error as any).statusCode
    if (status === 429) return true
    if (status && NON_RETRYABLE_STATUS_CODES.has(status)) return false
    if (status && status >= 500) return true
  }
  return false
}

function getRetryDelay(error: unknown, attempt: number): number {
  const status = (error as any)?.status ?? (error as any)?.statusCode
  if (status === 429) {
    const retryAfter = (error as any)?.headers?.['retry-after']
    if (retryAfter) {
      const parsed = parseInt(retryAfter, 10)
      if (!isNaN(parsed)) return parsed * 1000
    }
    return DEFAULT_RATE_LIMIT_WAIT_MS
  }
  return BASE_DELAY_MS * Math.pow(2, attempt)
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export function createSdkRunner(win: BrowserWindow) {
  return async function runSdkSession(params: SdkRunnerParams): Promise<SdkResult> {
    let lastError: unknown

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      if (attempt > 0) {
        const delay = getRetryDelay(lastError, attempt - 1)
        console.log(`[sdk-manager] Retry ${attempt}/${MAX_RETRIES} after ${delay}ms...`)
        await sleep(delay)
      }

      try {
        return await runSdkSessionOnce(win, params)
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
  }
}

async function runSdkSessionOnce(win: BrowserWindow, params: SdkRunnerParams): Promise<SdkResult> {
    const abortController = new AbortController()
    if (params.sessionKey) {
      activeControllers.set(params.sessionKey, abortController)
    }
    let sessionId = ''
    let output = ''
    let cost = 0
    let turns = 0

    try {
    const q = query({
      prompt: params.prompt,
      options: {
        cwd: params.cwd,
        model: params.model,
        maxTurns: params.maxTurns,
        abortController,
        tools: { type: 'preset', preset: 'claude_code' },
        permissionMode: 'bypassPermissions',
        allowDangerouslySkipPermissions: true,
        includePartialMessages: true,
        ...(params.resumeSessionId ? { resume: params.resumeSessionId } : {}),
        canUseTool: params.autoMode ? undefined : async (toolName, toolInput, options) => {
          // Auto-approve reads and searches
          const readOnlyTools = ['Read', 'Glob', 'Grep', 'WebSearch', 'WebFetch']
          if (readOnlyTools.includes(toolName)) {
            return { behavior: 'allow' } as PermissionResult
          }

          // Auto-approve Write/Edit for files within the project directory
          if ((toolName === 'Write' || toolName === 'Edit') && typeof (toolInput as any)?.file_path === 'string') {
            const filePath = path.resolve((toolInput as any).file_path)
            const projectDir = path.resolve(params.cwd)
            if (filePath.startsWith(projectDir)) {
              // Ensure parent directories exist so Write doesn't fail
              const parentDir = path.dirname(filePath)
              if (!fs.existsSync(parentDir)) {
                fs.mkdirSync(parentDir, { recursive: true })
              }
              return { behavior: 'allow' } as PermissionResult
            }
          }

          // Auto-approve Bash mkdir within project directory
          if (toolName === 'Bash' && typeof (toolInput as any)?.command === 'string') {
            const cmd = (toolInput as any).command.trim()
            if (cmd.startsWith('mkdir ')) {
              return { behavior: 'allow' } as PermissionResult
            }
          }

          const requestId = randomUUID()
          params.onApprovalRequest(requestId, toolName, toolInput)
          win.webContents.send('pipeline:approval-request', {
            requestId,
            taskId: params.taskId,
            toolUseId: options.toolUseID,
            toolName,
            toolInput
          })

          return new Promise<PermissionResult>((resolve) => {
            pendingApprovals.set(requestId, { resolve })
          })
        }
      }
    })

    for await (const message of q) {
      if (message.type === 'system' && (message as any).subtype === 'init') {
        sessionId = (message as any).session_id
      }

      if (message.type === 'assistant') {
        const assistantMsg = message as any
        if (assistantMsg.message?.content) {
          for (const block of assistantMsg.message.content) {
            if (block.type === 'text') {
              output += block.text
              params.onStream(block.text, 'text')
              win.webContents.send('pipeline:stream', {
                taskId: params.taskId,
                agent: params.model,
                type: 'text',
                content: block.text,
                timestamp: new Date().toISOString()
              })
            } else if (block.type === 'tool_use') {
              params.onStream(`Tool: ${block.name}`, 'tool_use')
              win.webContents.send('pipeline:stream', {
                taskId: params.taskId,
                agent: params.model,
                type: 'tool_use',
                content: `${block.name}: ${JSON.stringify(block.input).slice(0, 200)}`,
                timestamp: new Date().toISOString()
              })
            }
          }
        }
      }

      if (message.type === 'result') {
        const result = message as any
        cost = result.total_cost_usd ?? 0
        turns = result.num_turns ?? 0
        if (result.subtype === 'success') {
          output = result.result || output
        }
      }
    }

    return { output, cost, turns, sessionId }
    } finally {
      if (params.sessionKey) {
        activeControllers.delete(params.sessionKey)
      }
    }
}
