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
} from './db'
import { abortSession } from './sdk-manager'
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
} from '../shared/types'

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

  async sendMessage(sessionId: string, content: string): Promise<void> {
    if (!this.sdkRunner) throw new Error('SDK runner not set')

    createWorkshopMessage(this.dbPath, sessionId, 'user', content)

    const prompt = this.buildPrompt(sessionId, content)
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

    let lastEventType: string = 'text'
    let toolCallBuffer = ''
    let insideToolCall = false

    const emitText = (text: string) => {
      if (!text) return
      if (lastEventType === 'tool_use' && text.trim()) {
        this.emit('stream', { type: 'thinking' as any, sessionId })
      }
      lastEventType = 'text'
      accumulatedText += text
      debouncedSave()
      this.emit('stream', { type: 'text', content: text, sessionId } as WorkshopStreamEvent)
    }

    const processTextChunk = (chunk: string) => {
      let remaining = chunk

      while (remaining.length > 0) {
        if (insideToolCall) {
          const endIdx = remaining.indexOf('</tool_call>')
          if (endIdx !== -1) {
            // End of tool_call block found — discard buffered content
            toolCallBuffer = ''
            insideToolCall = false
            remaining = remaining.slice(endIdx + '</tool_call>'.length)
          } else {
            // Still inside — buffer everything
            toolCallBuffer += remaining
            remaining = ''
          }
        } else {
          const startIdx = remaining.indexOf('<tool_call')
          if (startIdx !== -1) {
            // Emit text before the tag
            if (startIdx > 0) emitText(remaining.slice(0, startIdx))
            insideToolCall = true
            toolCallBuffer = remaining.slice(startIdx)
            remaining = ''
          } else {
            // Check for partial match at end (e.g. "<tool_" waiting for more chars)
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
              insideToolCall = false // not confirmed yet, hold in buffer
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
        maxTurns: 10,
        cwd: this.projectPath,
        taskId: 0,
        autoMode: true,
        resumeSessionId,
        sessionKey: sessionId,
        onStream: (streamContent: string, streamType: string) => {
          if (streamType === 'context') {
            const parts = streamContent.replace('__context:', '').split(':')
            this.emit('context-update', { sessionId, contextTokens: parseInt(parts[0], 10), contextMax: parseInt(parts[1], 10) })
            return
          }
          if (streamType === 'tool_use') {
            lastEventType = 'tool_use'
            this.emit('stream', {
              type: 'tool_call',
              toolName: streamContent.replace('Tool: ', ''),
              sessionId,
            } as WorkshopStreamEvent)
          } else {
            // If we have a partial buffer from a potential tag start, prepend it
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

      await this.handleToolCalls(sessionId, result)

      // Strip tool_call XML blocks from the displayed message
      const cleanOutput = (result.output ?? '').replace(/<tool_call name="\w+">\s*[\s\S]*?<\/tool_call>/g, '').trim()
      createWorkshopMessage(this.dbPath, sessionId, 'assistant', cleanOutput)

      // Clear pending content now that full message is saved
      updateWorkshopSession(this.dbPath, sessionId, { pendingContent: null })

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

    try {
      const result = await this.sdkRunner({
        prompt,
        model: getWorkshopModel(),
        maxTurns: 10,
        cwd: this.projectPath,
        taskId: 0,
        autoMode: true,
        resumeSessionId,
        sessionKey: sessionId,
        onStream: (event: any) => {
          if (typeof event === 'string' || event?.type === 'context') {
            return // filter out context events
          }
          if (event.type === 'tool_use') {
            this.emit('stream', { type: 'tool_call', toolName: event.name, sessionId })
          } else {
            this.emit('stream', { type: 'text', content: event.text || '', sessionId })
          }
        },
        onApprovalRequest: async () => ({ behavior: 'allow' as const })
      })

      if (result.sessionId) this.sessionIds.set(sessionId, result.sessionId)
      this.trackTokens(sessionId, result.usage)

      await this.handleToolCalls(sessionId, result)

      const personaMessages = this.parsePanelResponse(result.output, session.panelPersonas)

      for (const pm of personaMessages) {
        createWorkshopMessage(
          this.dbPath, sessionId, 'assistant', pm.content,
          'text', null, pm.personaId, pm.personaName, 1
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

    if (results.length === 0 && output.trim()) {
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

  private async handleToolCalls(sessionId: string, result: any): Promise<void> {
    const output = result.output ?? ''

    const toolCallRegex = /<tool_call name="(\w+)">([\s\S]*?)<\/tool_call>/g
    let match

    while ((match = toolCallRegex.exec(output)) !== null) {
      const toolName = match[1]
      let toolInput: any
      try {
        toolInput = JSON.parse(match[2].trim())
      } catch {
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
          await this.suggestTasks(sessionId, toolInput.tasks)
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
      }
    }
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

  async suggestTasks(sessionId: string, tasks: WorkshopSuggestedTask[]): Promise<void> {
    if (this.autoMode) {
      // Create all tasks first to get real IDs
      const createdTasks: { id: number; index: number }[] = []
      for (let i = 0; i < tasks.length; i++) {
        const created = await this.createPipelineTask(sessionId, tasks[i])
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
      this.emit('tasks:suggested', { sessionId, tasks })
    }
  }

  async createPipelineTask(sessionId: string, task: WorkshopSuggestedTask & { autoMode?: boolean }): Promise<Task> {
    const created = createTask(this.dbPath, {
      title: task.title,
      description: task.description,
      tier: task.tier,
      priority: task.priority ?? 'medium',
      autoMode: task.autoMode,
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
    } catch {
      return null
    }
  }
}
