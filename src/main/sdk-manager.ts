import { query, type PermissionResult } from '@anthropic-ai/claude-agent-sdk'
import { randomUUID } from 'crypto'
import type { SdkRunnerParams, SdkResult } from './pipeline-engine'
import type { BrowserWindow } from 'electron'

interface PendingApproval {
  resolve: (result: PermissionResult) => void
}

const pendingApprovals = new Map<string, PendingApproval>()

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

export function createSdkRunner(win: BrowserWindow) {
  return async function runSdkSession(params: SdkRunnerParams): Promise<SdkResult> {
    const abortController = new AbortController()
    let sessionId = ''
    let output = ''
    let cost = 0
    let turns = 0

    const q = query({
      prompt: params.prompt,
      options: {
        cwd: params.cwd,
        model: params.model,
        maxTurns: params.maxTurns,
        abortController,
        tools: { type: 'preset', preset: 'claude_code' },
        permissionMode: params.autoMode ? 'bypassPermissions' : 'default',
        allowDangerouslySkipPermissions: params.autoMode,
        includePartialMessages: true,
        canUseTool: params.autoMode ? undefined : async (toolName, toolInput, options) => {
          // Auto-approve reads and searches
          const readOnlyTools = ['Read', 'Glob', 'Grep', 'WebSearch', 'WebFetch']
          if (readOnlyTools.includes(toolName)) {
            return { behavior: 'allow' } as PermissionResult
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
  }
}
