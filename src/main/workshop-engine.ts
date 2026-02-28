import { EventEmitter } from 'events'
import fs from 'fs'
import path from 'path'
import {
  createWorkshopSession,
  getWorkshopSession,
  listWorkshopSessions,
  updateWorkshopSession,
  deleteWorkshopSession,
  createWorkshopMessage,
  listWorkshopMessages,
  createWorkshopArtifact,
  updateWorkshopArtifact,
  listWorkshopArtifacts,
  getWorkshopArtifact,
  createWorkshopTaskLink,
  listTasks,
  createTask,
  addTaskDependencies,
  getGlobalSetting,
  createTaskGroup,
  getTaskGroup,
  updateTaskGroup,
  getTasksByGroup,
  getTask,
  updateTask,
  deleteTaskGroup,
} from './db'
import { abortSession } from './sdk-manager'
import type { PipelineEngine } from './pipeline-engine'
import { SETTING_KEYS } from '../shared/settings'
import { constructWorkshopPrompt, loadSkillContent } from './template-engine'
import {
  createKnowledgeEntry, getKnowledgeEntry, getKnowledgeByKey,
  updateKnowledgeEntry, listKnowledge
} from './knowledge-engine'
import { loadSkillExtended, editSkill, viewSkill } from './skill-loader'
import type {
  Task,
  WorkshopSession,
  WorkshopSessionType,
  PanelPersona,
  WorkshopArtifact,
  WorkshopStreamEvent,
  WorkshopSuggestedTask,
  WorkshopArtifactType,
  CreateTaskGroupInput,
  MessageSegment,
  ToolCallData,
} from '../shared/types'
import crypto from 'crypto'

function getWorkshopModel(): string {
  return getGlobalSetting(SETTING_KEYS.WORKSHOP_MODEL) ?? 'claude-sonnet-4-6'
}

type SdkRunner = (params: any) => Promise<any>

export class WorkshopEngine extends EventEmitter {
  private dbPath: string
  private projectPath: string
  private projectId: string
  private projectName: string
  private sdkRunner: SdkRunner | null = null
  private sessionIds = new Map<string, string>() // workshopSessionId -> sdkSessionId
  private autoMode = false
  private tokenUsage = new Map<string, { input: number; output: number }>()
  private activeGroupId: number | null = null
  private pipelineEngine: PipelineEngine | null = null

  constructor(dbPath: string, projectPath: string, projectId: string, projectName: string) {
    super()
    this.dbPath = dbPath
    this.projectPath = projectPath
    this.projectId = projectId
    this.projectName = projectName
  }

  setSdkRunner(runner: SdkRunner): void {
    this.sdkRunner = runner
  }

  setAutoMode(auto: boolean): void {
    this.autoMode = auto
  }

  setPipelineEngine(engine: PipelineEngine): void {
    this.pipelineEngine = engine

    engine.on('group:task-stage-complete', (data) => {
      if (data.groupId === this.activeGroupId) {
        const sessionId = this.getSessionForGroup(data.groupId)
        if (sessionId) {
          this.emit('stream', {
            sessionId,
            content: `\n\n**[Task #${data.taskId}]** completed stage \`${data.stage}\`: ${data.summary}\n\n`,
            type: 'text'
          })
        }
      }
    })

    engine.on('group:paused', (data) => {
      if (data.groupId === this.activeGroupId) {
        const sessionId = this.getSessionForGroup(data.groupId)
        if (sessionId) {
          this.emit('stream', {
            sessionId,
            content: `\n\n**[Group Paused]** ${data.reason ?? 'A task encountered an issue.'} (${data.pausedCount} tasks paused)\n\n`,
            type: 'text'
          })
        }
      }
    })

    engine.on('group:completed', (data) => {
      if (data.groupId === this.activeGroupId) {
        const sessionId = this.getSessionForGroup(data.groupId)
        if (sessionId) {
          this.emit('stream', {
            sessionId,
            content: `\n\n**[Group Complete]** All tasks in the group have finished successfully.\n\n`,
            type: 'text'
          })
        }
      }
    })
  }

  private getSessionForGroup(groupId: number): string | null {
    const group = getTaskGroup(this.dbPath, groupId)
    return group ? String(group.sessionId) : null
  }

  private trackTokens(
    sessionId: string,
    usage: { input_tokens?: number; output_tokens?: number } | undefined
  ): void {
    if (!usage) return
    const current = this.tokenUsage.get(sessionId) || { input: 0, output: 0 }
    current.input += usage.input_tokens || 0
    current.output += usage.output_tokens || 0
    this.tokenUsage.set(sessionId, current)
    this.emit('stream', {
      type: 'token_update', sessionId, ...current
    } as any)
  }

  // Session Management

  startSession(
    title?: string,
    sessionType: WorkshopSessionType = 'solo',
    panelPersonas: PanelPersona[] | null = null
  ): WorkshopSession {
    const session = createWorkshopSession(
      this.dbPath, this.projectId, title, sessionType, panelPersonas
    )
    this.emit('session:started', session)
    return session
  }

  async endSession(sessionId: string): Promise<void> {
    if (this.sdkRunner) {
      try {
        const messages = listWorkshopMessages(this.dbPath, sessionId)
        const conversation = messages
          .filter((m) => m.role !== 'system')
          .map((m) => `${m.role}: ${m.content}`)
          .join('\n\n')

        const summaryPrompt = `Summarize this workshop conversation in 2-3 sentences. Focus on key decisions made, artifacts created, and tasks identified:\n\n${conversation}`

        const result = await this.sdkRunner({
          prompt: summaryPrompt,
          model: 'claude-haiku-4-5-20251001',
          maxTurns: 1,
          cwd: this.projectPath,
          taskId: 0,
          autoMode: true,
          onStream: () => {},
          onApprovalRequest: () => ({ behavior: 'allow' as const }),
        })

        if (result.output) {
          updateWorkshopSession(this.dbPath, sessionId, {
            summary: result.output,
            status: 'ended',
          })
        } else {
          updateWorkshopSession(this.dbPath, sessionId, { status: 'ended' })
        }
      } catch {
        updateWorkshopSession(this.dbPath, sessionId, { status: 'ended' })
      }
    } else {
      updateWorkshopSession(this.dbPath, sessionId, { status: 'ended' })
    }

    this.sessionIds.delete(sessionId)
    this.emit('session:ended', { sessionId })
  }

  stopSession(sessionId: string): void {
    abortSession(sessionId)
    this.emit('stream', { type: 'done', sessionId } as WorkshopStreamEvent)
  }

  deleteSession(sessionId: string): void {
    abortSession(sessionId)
    this.sessionIds.delete(sessionId)
    deleteWorkshopSession(this.dbPath, sessionId)
    this.emit('session:deleted', { sessionId })
  }

  listSessions(): WorkshopSession[] {
    return listWorkshopSessions(this.dbPath, this.projectId)
  }

  getSession(sessionId: string): WorkshopSession | null {
    return getWorkshopSession(this.dbPath, sessionId)
  }

  renameSession(sessionId: string, title: string): WorkshopSession | null {
    const updated = updateWorkshopSession(this.dbPath, sessionId, { title })
    if (updated) {
      this.emit('session:renamed', { sessionId, title })
    }
    return updated
  }

  // Messaging

  async sendMessage(sessionId: string, content: string, options?: { isSystemContinuation?: boolean }): Promise<void> {
    if (!this.sdkRunner) throw new Error('SDK runner not set')

    if (!options?.isSystemContinuation) {
      createWorkshopMessage(this.dbPath, sessionId, 'user', content)
    }

    const prompt = options?.isSystemContinuation
      ? this.buildPrompt(sessionId, '') + '\n\n[System: The requested skill has been loaded into the conversation above. Continue responding to the user\'s original request using the loaded skill. Do not announce or re-describe the skill — just use it to guide your response.]'
      : this.buildPrompt(sessionId, content)
    const resumeSessionId = this.sessionIds.get(sessionId)

    let accumulatedText = ''
    let pendingSaveTimer: ReturnType<typeof setTimeout> | null = null

    const savePendingContent = () => {
      if (accumulatedText) {
        updateWorkshopSession(this.dbPath, sessionId, { pendingContent: accumulatedText })
      }
    }

    const debouncedSave = () => {
      if (pendingSaveTimer) clearTimeout(pendingSaveTimer)
      pendingSaveTimer = setTimeout(savePendingContent, 2000)
    }

    let toolCallBuffer = ''
    let insideToolCall = false
    const segments: MessageSegment[] = []
    const toolCalls: ToolCallData[] = []

    const emitText = (text: string) => {
      if (!text) return
      accumulatedText += text
      debouncedSave()
      // Append to existing text segment or create new one
      const last = segments[segments.length - 1]
      if (last && last.type === 'text') {
        (last as any).content += text
      } else {
        segments.push({ type: 'text', content: text })
      }
      this.emit('stream', { type: 'text', content: text, sessionId } as WorkshopStreamEvent)
    }

    const processTextChunk = (chunk: string) => {
      let remaining = chunk

      while (remaining.length > 0) {
        if (insideToolCall) {
          const endIdx = remaining.indexOf('</tool_call>')
          if (endIdx !== -1) {
            toolCallBuffer = ''
            insideToolCall = false
            remaining = remaining.slice(endIdx + '</tool_call>'.length)
          } else {
            toolCallBuffer += remaining
            remaining = ''
          }
        } else {
          const startIdx = remaining.indexOf('<tool_call')
          if (startIdx !== -1) {
            if (startIdx > 0) emitText(remaining.slice(0, startIdx))
            insideToolCall = true
            toolCallBuffer = remaining.slice(startIdx)
            remaining = ''
          } else {
            const partialTag = '<tool_call'
            let partialLen = 0
            for (let i = Math.max(0, remaining.length - partialTag.length); i < remaining.length; i++) {
              const tail = remaining.slice(i)
              if (partialTag.startsWith(tail)) {
                partialLen = tail.length
                break
              }
            }
            if (partialLen > 0) {
              emitText(remaining.slice(0, remaining.length - partialLen))
              toolCallBuffer = remaining.slice(remaining.length - partialLen)
              insideToolCall = false
            } else {
              emitText(remaining)
            }
            remaining = ''
          }
        }
      }
    }

    try {
      this.emit('stream', { type: 'text', content: '', sessionId } as WorkshopStreamEvent)

      const result = await this.sdkRunner({
        prompt,
        model: getWorkshopModel(),
        maxTurns: 30,
        cwd: this.projectPath,
        taskId: 0,
        autoMode: true,
        resumeSessionId,
        sessionKey: sessionId,
        onStream: (streamContent: string, streamType: string, extra?: Record<string, unknown>) => {
          if (streamType === 'context') {
            const parts = streamContent.replace('__context:', '').split(':')
            const contextTokens = parseInt(parts[0], 10)
            const contextMax = parts.length >= 2 ? parseInt(parts[1], 10) : 0
            if (!isNaN(contextTokens) && !isNaN(contextMax)) {
              this.emit('context-update', { sessionId, contextTokens, contextMax })
            }
            return
          }
          if (streamType === 'tool_use' && extra) {
            const toolData: ToolCallData = {
              id: crypto.randomUUID(),
              toolName: extra.toolName as string,
              toolInput: extra.toolInput as Record<string, unknown>,
              timestamp: new Date().toISOString()
            }
            toolCalls.push(toolData)
            segments.push({ type: 'tool_call', tool: toolData })
            this.emit('stream', {
              type: 'tool_call',
              toolName: extra.toolName as string,
              toolInput: extra.toolInput as Record<string, unknown>,
              sessionId,
            } as WorkshopStreamEvent)
          } else if (streamType === 'thinking') {
            const last = segments[segments.length - 1]
            if (last && last.type === 'thinking' && streamContent) {
              (last as any).content = ((last as any).content || '') + streamContent
            } else {
              segments.push({ type: 'thinking', content: streamContent })
            }
            this.emit('stream', { type: 'thinking', content: streamContent, sessionId } as WorkshopStreamEvent)
          } else if (streamType === 'text') {
            if (toolCallBuffer && !insideToolCall) {
              const combined = toolCallBuffer + streamContent
              toolCallBuffer = ''
              processTextChunk(combined)
            } else {
              processTextChunk(streamContent)
            }
          }
        },
        onApprovalRequest: () => {
          return { behavior: 'allow' as const }
        },
      })

      // Clear debounce timer
      if (pendingSaveTimer) clearTimeout(pendingSaveTimer)

      if (result.sessionId) {
        this.sessionIds.set(sessionId, result.sessionId)
      }

      this.trackTokens(sessionId, result.usage)

      const skillLoaded = await this.handleToolCalls(sessionId, result)

      // Strip tool_call XML blocks from the displayed message
      const cleanOutput = (result.output ?? '').replace(/<tool_call name="[\w-]+">\s*[\s\S]*?<\/tool_call>/g, '').trim()
      const metadata = segments.length > 0 || toolCalls.length > 0
        ? { segments, toolCalls }
        : null
      createWorkshopMessage(this.dbPath, sessionId, 'assistant', cleanOutput, 'text', metadata)

      // Clear pending content now that full message is saved
      updateWorkshopSession(this.dbPath, sessionId, { pendingContent: null })

      // If a skill was loaded, auto-continue so the agent doesn't stall
      // waiting for the user to send another message
      if (skillLoaded && !options?.isSystemContinuation) {
        await this.sendMessage(sessionId, '', { isSystemContinuation: true })
        return
      }

      this.emit('stream', { type: 'done', sessionId } as WorkshopStreamEvent)

      // Auto-name the session after first assistant response
      const session = getWorkshopSession(this.dbPath, sessionId)
      if (session && session.title === 'New Session' && this.sdkRunner) {
        const messages = listWorkshopMessages(this.dbPath, sessionId)
        const firstUserMsg = messages.find(m => m.role === 'user')
        if (firstUserMsg) {
          try {
            const nameResult = await this.sdkRunner({
              prompt: `Generate a concise 3-5 word title for this conversation. Only output the title, nothing else:\n\n${firstUserMsg.content.slice(0, 500)}`,
              model: 'claude-haiku-4-5-20251001',
              maxTurns: 1,
              cwd: this.projectPath,
              taskId: 0,
              autoMode: true,
              onStream: () => {},
              onApprovalRequest: () => ({ behavior: 'allow' as const }),
            })
            if (nameResult.output) {
              const title = nameResult.output.trim().replace(/^["']|["']$/g, '')
              this.renameSession(sessionId, title)
            }
          } catch {
            // Auto-naming failure is non-critical, silently ignore
          }
        }
      }
    } catch (error: any) {
      // Clear debounce timer
      if (pendingSaveTimer) clearTimeout(pendingSaveTimer)

      // Save whatever we accumulated as a partial message if there's content
      if (accumulatedText.trim()) {
        createWorkshopMessage(this.dbPath, sessionId, 'assistant', accumulatedText.trim())
      }
      updateWorkshopSession(this.dbPath, sessionId, { pendingContent: null })

      this.emit('stream', {
        type: 'error',
        error: error.message,
        sessionId,
      } as WorkshopStreamEvent)
    }
  }

  async sendPanelMessage(sessionId: string, content: string): Promise<void> {
    if (!this.sdkRunner) throw new Error('SDK runner not set')

    const session = getWorkshopSession(this.dbPath, sessionId)
    if (!session || session.sessionType !== 'panel' || !session.panelPersonas) {
      throw new Error('Not a panel session')
    }

    createWorkshopMessage(this.dbPath, sessionId, 'user', content)

    const prompt = this.buildPanelPrompt(sessionId, content, session.panelPersonas)
    const resumeSessionId = this.sessionIds.get(sessionId)

    this.emit('stream', { type: 'text', content: '', sessionId })

    const panelSegments: MessageSegment[] = []
    const panelToolCalls: ToolCallData[] = []

    try {
      const result = await this.sdkRunner({
        prompt,
        model: getWorkshopModel(),
        maxTurns: 30,
        cwd: this.projectPath,
        taskId: 0,
        autoMode: true,
        resumeSessionId,
        sessionKey: sessionId,
        onStream: (content: string, type: string, extra?: Record<string, unknown>) => {
          if (type === 'context') {
            return // filter out context events
          }
          if (type === 'tool_use' && extra) {
            const toolData: ToolCallData = {
              id: crypto.randomUUID(),
              toolName: extra.toolName as string,
              toolInput: extra.toolInput as Record<string, unknown>,
              timestamp: new Date().toISOString()
            }
            panelToolCalls.push(toolData)
            panelSegments.push({ type: 'tool_call', tool: toolData })
            this.emit('stream', {
              type: 'tool_call',
              toolName: extra.toolName as string,
              toolInput: extra.toolInput as Record<string, unknown>,
              sessionId
            })
          } else if (type === 'thinking') {
            const last = panelSegments[panelSegments.length - 1]
            if (last && last.type === 'thinking' && content) {
              (last as any).content = ((last as any).content || '') + content
            } else {
              panelSegments.push({ type: 'thinking', content })
            }
            this.emit('stream', { type: 'thinking', content, sessionId })
          } else if (type === 'text' && content) {
            const last = panelSegments[panelSegments.length - 1]
            if (last && last.type === 'text') {
              (last as any).content += content
            } else {
              panelSegments.push({ type: 'text', content })
            }
            this.emit('stream', { type: 'text', content, sessionId })
          }
        },
        onApprovalRequest: async () => ({ behavior: 'allow' as const })
      })

      if (result.sessionId) this.sessionIds.set(sessionId, result.sessionId)
      this.trackTokens(sessionId, result.usage)

      await this.handleToolCalls(sessionId, result)

      const personaMessages = this.parsePanelResponse(result.output, session.panelPersonas)
      const panelMeta = panelSegments.length > 0 || panelToolCalls.length > 0
        ? { segments: panelSegments, toolCalls: panelToolCalls }
        : null

      for (const pm of personaMessages) {
        createWorkshopMessage(
          this.dbPath, sessionId, 'assistant', pm.content,
          'text', panelMeta, pm.personaId, pm.personaName, 1
        )
        this.emit('stream', {
          type: 'panel_message',
          content: pm.content,
          personaId: pm.personaId,
          personaName: pm.personaName,
          sessionId
        } as any)
      }

      this.emit('stream', { type: 'done', sessionId })
    } catch (err: any) {
      this.emit('stream', { type: 'error', error: err.message, sessionId })
    }
  }

  async triggerDiscuss(sessionId: string): Promise<void> {
    if (!this.sdkRunner) throw new Error('SDK runner not set')

    const session = getWorkshopSession(this.dbPath, sessionId)
    if (!session || session.sessionType !== 'panel' || !session.panelPersonas) {
      throw new Error('Not a panel session')
    }

    const messages = listWorkshopMessages(this.dbPath, sessionId)
    const maxRound = messages.reduce((max, m) => Math.max(max, m.roundNumber || 0), 0)
    const nextRound = maxRound + 1

    if (nextRound > 3) {
      this.emit('stream', { type: 'error', error: 'Maximum discussion rounds (2) reached', sessionId })
      return
    }

    this.emit('stream', { type: 'text', content: '', sessionId })

    const history = messages.map((m) => {
      const prefix = m.personaName ? `[${m.personaName}]` : m.role === 'user' ? '[User]' : ''
      return `${prefix} ${m.content}`
    }).join('\n\n')

    const promises = session.panelPersonas.map(async (persona) => {
      const prompt = [
        `You are ${persona.name} in a panel discussion.`,
        '',
        persona.systemPrompt,
        '',
        'Here is the discussion so far:',
        '',
        history,
        '',
        'Respond to the other panelists\' points. Be specific, reference what',
        'they said, agree or disagree with reasoning. Keep your response',
        'focused and concise (2-4 paragraphs max).',
        'Do NOT use any tool calls — this is a pure discussion response.'
      ].join('\n')

      try {
        const result = await this.sdkRunner!({
          prompt,
          model: getWorkshopModel(),
          maxTurns: 1,
          cwd: this.projectPath,
          taskId: 0,
          autoMode: true,
          sessionKey: `${sessionId}-discuss-${persona.id}-${nextRound}`,
          onStream: () => {},
          onApprovalRequest: async () => ({ behavior: 'allow' as const })
        })

        this.trackTokens(sessionId, result.usage)
        return { personaId: persona.id, personaName: persona.name, content: result.output || '' }
      } catch (err: any) {
        return { personaId: persona.id, personaName: persona.name, content: `[Error: ${err.message}]` }
      }
    })

    const responses = await Promise.all(promises)

    for (const resp of responses) {
      createWorkshopMessage(
        this.dbPath, sessionId, 'assistant', resp.content,
        'text', null, resp.personaId, resp.personaName, nextRound
      )
      this.emit('stream', {
        type: 'panel_message', content: resp.content,
        personaId: resp.personaId, personaName: resp.personaName, sessionId
      } as any)
    }

    this.emit('stream', { type: 'done', sessionId })
  }

  // Prompt Building

  private buildPrompt(sessionId: string, userMessage: string): string {
    const sessions = this.listSessions()
    const sessionSummaries = sessions
      .filter((s) => s.id !== sessionId && s.summary)
      .map((s) => `**${s.title}** (${s.createdAt}): ${s.summary}`)
      .join('\n\n')

    const artifacts = listWorkshopArtifacts(this.dbPath, this.projectId)
    const artifactList = artifacts
      .map((a) => `- **${a.name}** (${a.type}, v${a.currentVersion}): \`${a.filePath}\``)
      .join('\n')

    const tasks = listTasks(this.dbPath)
    const pipelineState = tasks
      .filter((t: any) => t.status !== 'done')
      .map((t: any) => `- [${t.status}] ${t.title}`)
      .join('\n')

    const messages = listWorkshopMessages(this.dbPath, sessionId)
    const conversationHistory = messages
      .map((m) => `**${m.role}:** ${m.content}`)
      .join('\n\n')

    const systemPrompt = constructWorkshopPrompt({
      projectName: this.projectName,
      sessionSummaries,
      artifactList,
      pipelineState,
    })

    return `${systemPrompt}\n\n${conversationHistory}\n\n**user:** ${userMessage}`
  }

  private buildPanelPrompt(sessionId: string, userMessage: string, personas: PanelPersona[]): string {
    const personaInstructions = personas.map((p) => `- **${p.name}**: ${p.systemPrompt}`).join('\n')
    const conversationHistory = this.getConversationHistory(sessionId)

    return [
      'You are moderating a panel discussion with these participants:',
      '', personaInstructions, '',
      'Respond as EACH persona in turn. Wrap each response in XML tags:',
      '', '<persona name="PersonaName">', 'Their response here...', '</persona>', '',
      'Each persona should:',
      '- Respond from their unique perspective',
      '- Be specific and actionable, not generic',
      '- Keep responses to 2-4 paragraphs each',
      '- Engage authentically based on their role',
      '',
      'You have access to workshop tools (create_artifact, suggest_tasks,',
      'render_diagram, present_choices). Use them when appropriate —',
      'attribute tool use to the persona who would naturally trigger it.',
      '', conversationHistory, '', `**User:** ${userMessage}`
    ].join('\n')
  }

  private parsePanelResponse(output: string, personas: PanelPersona[]): Array<{ personaId: string; personaName: string; content: string }> {
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

    if (results.length === 0 && output.trim() && personas.length > 0) {
      const cleanOutput = output.replace(/<tool_call[\s\S]*?<\/tool_call>/g, '').trim()
      if (cleanOutput) {
        results.push({ personaId: personas[0].id, personaName: personas[0].name, content: cleanOutput })
      }
    }
    return results
  }

  private getConversationHistory(sessionId: string): string {
    const messages = listWorkshopMessages(this.dbPath, sessionId)
    if (messages.length === 0) return ''
    const lines = messages.map((m) => {
      if (m.role === 'user') return `**User:** ${m.content}`
      if (m.personaName) return `**${m.personaName}:** ${m.content}`
      return `**Assistant:** ${m.content}`
    })
    return `Previous conversation:\n\n${lines.join('\n\n')}`
  }

  // Tool Call Handling

  private async handleToolCalls(sessionId: string, result: any): Promise<boolean> {
    let skillLoaded = false
    const output = result.output ?? ''

    const toolCallRegex = /<tool_call name="([\w-]+)">([\s\S]*?)<\/tool_call>/g
    let match

    // Log whether output contains tool calls for debugging
    const toolCallMatches = [...output.matchAll(/<tool_call name="([\w-]+)">/g)]
    if (toolCallMatches.length > 0) {
      console.log(`[Workshop] Found ${toolCallMatches.length} tool call(s): ${toolCallMatches.map(m => m[1]).join(', ')}`)
    } else if (output.length > 0) {
      console.log(`[Workshop] No tool calls found in output (${output.length} chars)`)
    }

    while ((match = toolCallRegex.exec(output)) !== null) {
      const toolName = match[1]
      let toolInput: any
      try {
        toolInput = JSON.parse(match[2].trim())
      } catch (parseErr: any) {
        console.warn(`[Workshop] Failed to parse tool call "${toolName}" JSON — skipping:`, parseErr.message)
        continue
      }

      // Validate toolInput is a proper object before dispatching
      if (typeof toolInput !== 'object' || toolInput === null) {
        console.warn(`[Workshop] Tool call "${toolName}" has non-object input — skipping`)
        continue
      }

      switch (toolName) {
        case 'create_artifact':
          this.createArtifact(toolInput.name, toolInput.type, toolInput.content, sessionId)
          break
        case 'update_artifact':
          this.updateArtifactContent(
            toolInput.artifact_id,
            toolInput.content,
            toolInput.summary ?? 'Updated',
            sessionId
          )
          break
        case 'suggest_tasks':
          await this.suggestTasks(sessionId, toolInput.tasks, toolInput.groupTitle)
          break
        case 'render_diagram':
          this.createArtifact(toolInput.title, 'diagram', toolInput.mermaid, sessionId)
          break
        case 'present_choices':
          this.emit('stream', {
            type: 'tool_call',
            toolName: 'present_choices',
            toolInput,
            sessionId,
          } as WorkshopStreamEvent)
          break
        case 'load_skill': {
          const skillName = toolInput.skill_name
          const skillContent = loadSkillContent(skillName)
          const message = skillContent
            ? `## Skill Loaded: ${skillName}\n\nFollow these instructions:\n\n${skillContent}`
            : `Skill not found: ${skillName}`
          createWorkshopMessage(
            this.dbPath,
            sessionId,
            'system',
            message,
            'system_event',
            { skillName }
          )
          if (skillContent) skillLoaded = true
          break
        }
        case 'save_knowledge': {
          const entry = createKnowledgeEntry(this.dbPath, {
            key: toolInput.key,
            summary: toolInput.summary,
            content: toolInput.content,
            category: toolInput.category,
            tags: toolInput.tags ?? [],
            source: 'workshop',
            status: 'active',
          })
          createWorkshopMessage(
            this.dbPath,
            sessionId,
            'system',
            `Knowledge saved: [${entry.key}] ${entry.summary}`,
            'system_event',
            { knowledgeId: entry.id }
          )
          this.emit('stream', {
            type: 'tool_call',
            toolName: 'save_knowledge',
            toolInput: { id: entry.id, key: entry.key },
            sessionId,
          } as WorkshopStreamEvent)
          break
        }
        case 'update_knowledge': {
          const updated = updateKnowledgeEntry(this.dbPath, toolInput.id, {
            content: toolInput.content,
            summary: toolInput.summary,
            tags: toolInput.tags,
          })
          const label = updated ? `[${updated.key}] ${updated.summary}` : toolInput.id
          createWorkshopMessage(
            this.dbPath,
            sessionId,
            'system',
            `Knowledge updated: ${label}`,
            'system_event',
            { knowledgeId: toolInput.id }
          )
          break
        }
        case 'list_knowledge': {
          const entries = listKnowledge(this.dbPath, {
            category: toolInput.category,
          })
          const lines = entries.length > 0
            ? entries.map((e) => `- **[${e.key}]** (${e.category}) ${e.summary}`)
            : ['No knowledge entries found.']
          const header = toolInput.category
            ? `## Knowledge: ${toolInput.category}`
            : '## Knowledge Entries'
          createWorkshopMessage(
            this.dbPath,
            sessionId,
            'system',
            `${header}\n\n${lines.join('\n')}`,
            'system_event',
            {}
          )
          break
        }
        case 'fetch_knowledge': {
          const keyOrId = toolInput.key_or_id
          const entry = getKnowledgeByKey(this.dbPath, keyOrId) ?? getKnowledgeEntry(this.dbPath, keyOrId)
          const message = entry
            ? `## Knowledge: ${entry.key}\n\n**Summary:** ${entry.summary}\n**Category:** ${entry.category}\n**Tags:** ${entry.tags.join(', ') || 'none'}\n\n${entry.content}`
            : `Knowledge not found: ${keyOrId}`
          createWorkshopMessage(
            this.dbPath,
            sessionId,
            'system',
            message,
            'system_event',
            entry ? { knowledgeId: entry.id } : {}
          )
          break
        }
        case 'fetch_skill_detail': {
          const skillName = toolInput.skill_name
          const content = loadSkillExtended(skillName)
          const message = content
            ? `## Skill Extended: ${skillName}\n\n${content}`
            : `Extended content not found for skill: ${skillName}`
          createWorkshopMessage(
            this.dbPath,
            sessionId,
            'system',
            message,
            'system_event',
            { skillName }
          )
          break
        }
        case 'edit_skill': {
          const { skill_name: editSkillName, tier, content: skillContent } = toolInput
          editSkill(editSkillName, tier, skillContent)
          createWorkshopMessage(
            this.dbPath,
            sessionId,
            'system',
            `Skill updated: ${editSkillName} (${tier})`,
            'system_event',
            { skillName: editSkillName, tier }
          )
          break
        }
        case 'view_skill': {
          const { skill_name: viewSkillName, tier: viewTier } = toolInput
          const skillData = viewSkill(viewSkillName, viewTier)
          const sections: string[] = [`## Skill: ${viewSkillName}`]
          if (skillData.core !== undefined) {
            sections.push(`### Core\n\n${skillData.core ?? '(empty)'}`)
          }
          if (skillData.extended !== undefined) {
            sections.push(`### Extended\n\n${skillData.extended ?? '(empty)'}`)
          }
          if (sections.length === 1) {
            sections.push('No content found.')
          }
          createWorkshopMessage(
            this.dbPath,
            sessionId,
            'system',
            sections.join('\n\n'),
            'system_event',
            { skillName: viewSkillName }
          )
          break
        }
        case 'create_task_group':
          await this.handleCreateTaskGroup(sessionId, toolInput)
          break
        case 'launch_group':
          await this.handleLaunchGroup(sessionId, toolInput)
          break
        case 'get_group_status':
          await this.handleGetGroupStatus(sessionId, toolInput)
          break
        case 'pause_group':
          await this.handlePauseGroup(sessionId)
          break
        case 'resume_group':
          await this.handleResumeGroup(sessionId)
          break
        case 'delete_group':
          await this.handleDeleteGroup(sessionId, toolInput)
          break
        case 'message_agent':
          await this.handleMessageAgent(sessionId, toolInput)
          break
        case 'update_work_order':
          await this.handleUpdateWorkOrder(sessionId, toolInput)
          break
        case 'peek_agent':
          this.emit('stream', { sessionId, content: `[Peeking at task ${toolInput.taskId}...]`, type: 'tool_call' })
          break
      }
    }
    return skillLoaded
  }

  // Group Orchestration Handlers

  private async handleCreateTaskGroup(sessionId: string, input: any): Promise<void> {
    console.log('[Workshop] handleCreateTaskGroup: creating group', input.title, 'sessionId =', sessionId)
    const group = createTaskGroup(this.dbPath, {
      title: input.title,
      sessionId,
      designArtifactId: input.designArtifactId,
      sharedContext: input.sharedContext ?? ''
    })
    console.log('[Workshop] handleCreateTaskGroup: created group #', group.id)
    this.activeGroupId = group.id
    this.emit('stream', { sessionId, content: `[Created task group #${group.id}: "${group.title}"]`, type: 'tool_call' })
    this.emit('group:created', { sessionId, group })
  }

  private async handleLaunchGroup(sessionId: string, input: any): Promise<void> {
    if (!this.pipelineEngine) {
      this.emit('stream', { sessionId, content: '[Error: Pipeline engine not connected]', type: 'tool_call' })
      return
    }
    const groupId = input.groupId ?? this.activeGroupId
    if (!groupId) {
      this.emit('stream', { sessionId, content: '[Error: No active group to launch]', type: 'tool_call' })
      return
    }
    updateTaskGroup(this.dbPath, groupId, { status: 'queued' })
    this.emit('stream', { sessionId, content: `[Launching group #${groupId}...]`, type: 'tool_call' })
    this.pipelineEngine.launchGroup(groupId).catch((err) => {
      this.emit('stream', { sessionId, content: `[Group launch error: ${err.message}]`, type: 'tool_call' })
    })
  }

  private async handleGetGroupStatus(sessionId: string, input: any): Promise<void> {
    if (!this.pipelineEngine) return
    const groupId = input.groupId ?? this.activeGroupId
    if (!groupId) return
    const status = this.pipelineEngine.getGroupStatus(groupId)
    const summary = status.tasks.map(t => `- Task #${t.id} "${t.title}": ${t.status} (stage: ${t.stage ?? 'none'})`).join('\n')
    this.emit('stream', { sessionId, content: `[Group #${groupId} Status: ${status.group.status}]\n${summary}`, type: 'tool_call' })
  }

  private async handlePauseGroup(sessionId: string): Promise<void> {
    if (!this.pipelineEngine || !this.activeGroupId) return
    const count = await this.pipelineEngine.pauseGroup(this.activeGroupId)
    this.emit('stream', { sessionId, content: `[Paused group: ${count} tasks paused]`, type: 'tool_call' })
  }

  private async handleResumeGroup(sessionId: string): Promise<void> {
    if (!this.pipelineEngine || !this.activeGroupId) return
    const count = await this.pipelineEngine.resumeGroup(this.activeGroupId)
    this.emit('stream', { sessionId, content: `[Resumed group: ${count} tasks resumed]`, type: 'tool_call' })
  }

  private async handleDeleteGroup(sessionId: string, input: any): Promise<void> {
    const groupId = input.groupId ?? this.activeGroupId
    if (!groupId) {
      this.emit('stream', { sessionId, content: '[Error: No group specified to delete]', type: 'tool_call' })
      return
    }
    // Stop running tasks in the group first
    if (this.pipelineEngine) {
      const group = getTaskGroup(this.dbPath, groupId)
      if (group && group.status === 'running') {
        await this.pipelineEngine.pauseGroup(groupId)
      }
    }
    deleteTaskGroup(this.dbPath, groupId)
    if (this.activeGroupId === groupId) {
      this.activeGroupId = null
    }
    this.emit('stream', { sessionId, content: `[Deleted group #${groupId}. Tasks unlinked.]`, type: 'tool_call' })
    this.emit('group:deleted', { sessionId, groupId })
  }

  private async handleMessageAgent(sessionId: string, input: any): Promise<void> {
    this.emit('group:message-agent', { groupId: this.activeGroupId, taskId: input.taskId, content: input.content })
    this.emit('stream', { sessionId, content: `[Message sent to task #${input.taskId}]`, type: 'tool_call' })
  }

  private async handleUpdateWorkOrder(sessionId: string, input: any): Promise<void> {
    const task = getTask(this.dbPath, input.taskId)
    if (!task) {
      this.emit('stream', { sessionId, content: `[Error: Task #${input.taskId} not found]`, type: 'tool_call' })
      return
    }
    const currentWorkOrder = task.workOrder ?? { objective: '', files: [], patterns: [], integration: [], constraints: [], tests: [] }
    const updatedWorkOrder = { ...currentWorkOrder, ...input.changes }
    updateTask(this.dbPath, input.taskId, { workOrder: updatedWorkOrder })
    this.emit('stream', { sessionId, content: `[Updated work order for task #${input.taskId}]`, type: 'tool_call' })
  }

  // Artifact Operations

  createArtifact(
    name: string,
    type: WorkshopArtifactType,
    content: string,
    sessionId: string
  ): WorkshopArtifact {
    const ext = type === 'diagram' ? '.mermaid' : '.md'
    const fileName = name.toLowerCase().replace(/[^a-z0-9]+/g, '-') + ext
    const filePath = `docs/workshop/${fileName}`
    const fullPath = path.join(this.projectPath, filePath)

    fs.mkdirSync(path.dirname(fullPath), { recursive: true })
    fs.writeFileSync(fullPath, content, 'utf-8')

    const artifact = createWorkshopArtifact(this.dbPath, this.projectId, name, type, filePath)

    this.emit('artifact:created', artifact)

    createWorkshopMessage(
      this.dbPath,
      sessionId,
      'system',
      `Created artifact: ${name} (${type})`,
      'system_event',
      { artifactId: artifact.id }
    )

    return artifact
  }

  updateArtifactContent(
    artifactId: string,
    content: string,
    changeSummary: string,
    sessionId: string
  ): void {
    const artifact = getWorkshopArtifact(this.dbPath, artifactId)
    if (!artifact) throw new Error(`Artifact not found: ${artifactId}`)

    const fullPath = path.join(this.projectPath, artifact.filePath)
    fs.writeFileSync(fullPath, content, 'utf-8')

    updateWorkshopArtifact(this.dbPath, artifactId, {
      currentVersion: artifact.currentVersion + 1,
    })

    this.emit('artifact:updated', { artifactId, version: artifact.currentVersion + 1 })

    createWorkshopMessage(
      this.dbPath,
      sessionId,
      'system',
      `Updated artifact: ${artifact.name} v${artifact.currentVersion + 1} (${changeSummary})`,
      'system_event',
      { artifactId }
    )
  }

  // Task Creation

  async suggestTasks(sessionId: string, tasks: WorkshopSuggestedTask[], groupTitle?: string): Promise<void> {
    if (this.autoMode) {
      let groupId: number | undefined
      if (this.activeGroupId) {
        // Use existing group from prior create_task_group call
        groupId = this.activeGroupId
      } else if (groupTitle && tasks.length > 1) {
        const group = createTaskGroup(this.dbPath, {
          title: groupTitle,
          sessionId,
          sharedContext: ''
        })
        groupId = group.id
        this.activeGroupId = group.id
        this.emit('group:created', { sessionId, group })
      }

      // Create all tasks first to get real IDs
      const createdTasks: { id: number; index: number }[] = []
      for (let i = 0; i < tasks.length; i++) {
        const created = await this.createPipelineTask(sessionId, tasks[i], groupId)
        createdTasks.push({ id: created.id, index: i })
      }

      // Wire up dependencies using real IDs
      for (let i = 0; i < tasks.length; i++) {
        const depIndices = tasks[i].dependsOn ?? []
        if (depIndices.length > 0) {
          const depIds = depIndices
            .filter((idx) => idx >= 0 && idx < createdTasks.length)
            .map((idx) => createdTasks[idx].id)
          if (depIds.length > 0) {
            addTaskDependencies(this.dbPath, createdTasks[i].id, depIds)
          }
        }
      }
    } else {
      this.emit('tasks:suggested', { sessionId, tasks, groupTitle, groupId: this.activeGroupId ?? undefined })
    }
  }

  async createPipelineTask(sessionId: string, task: WorkshopSuggestedTask & { autoMode?: boolean }, groupId?: number): Promise<Task> {
    const created = createTask(this.dbPath, {
      title: task.title,
      description: task.description,
      tier: task.tier,
      priority: task.priority ?? 'medium',
      autoMode: task.autoMode,
      groupId: groupId ?? undefined,
      workOrder: task.workOrder ?? undefined,
      assignedSkill: task.assignedSkill ?? undefined,
    })

    createWorkshopTaskLink(this.dbPath, created.id, sessionId)
    if (task.linkedArtifactIds) {
      for (const artifactId of task.linkedArtifactIds) {
        createWorkshopTaskLink(this.dbPath, created.id, undefined, artifactId)
      }
    }

    createWorkshopMessage(
      this.dbPath,
      sessionId,
      'system',
      `Created pipeline task: "${task.title}" (${task.tier})`,
      'system_event',
      { taskId: created.id }
    )

    this.emit('task:created', { sessionId, task: created })
    return created
  }

  // Artifact Reading

  listArtifacts(): WorkshopArtifact[] {
    return listWorkshopArtifacts(this.dbPath, this.projectId)
  }

  getArtifactContent(artifactId: string): string | null {
    const artifact = getWorkshopArtifact(this.dbPath, artifactId)
    if (!artifact) return null
    const fullPath = path.join(this.projectPath, artifact.filePath)
    try {
      return fs.readFileSync(fullPath, 'utf-8')
    } catch (err: any) {
      console.error(`[Workshop] Failed to read artifact at ${fullPath}:`, err.message)
      return null
    }
  }
}
