import { EventEmitter } from 'events'
import fs from 'fs'
import path from 'path'
import {
  createWorkshopSession,
  getWorkshopSession,
  listWorkshopSessions,
  updateWorkshopSession,
  createWorkshopMessage,
  listWorkshopMessages,
  createWorkshopArtifact,
  updateWorkshopArtifact,
  listWorkshopArtifacts,
  getWorkshopArtifact,
  createWorkshopTaskLink,
  listTasks,
  createTask,
} from './db'
import { constructWorkshopPrompt } from './template-engine'
import type {
  WorkshopSession,
  WorkshopArtifact,
  WorkshopStreamEvent,
  WorkshopSuggestedTask,
  WorkshopArtifactType,
} from '../shared/types'

type SdkRunner = (params: any) => Promise<any>

export class WorkshopEngine extends EventEmitter {
  private dbPath: string
  private projectPath: string
  private projectId: string
  private projectName: string
  private sdkRunner: SdkRunner | null = null
  private sessionIds = new Map<string, string>() // workshopSessionId -> sdkSessionId
  private autoMode = false

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

  // Session Management

  startSession(title?: string): WorkshopSession {
    const session = createWorkshopSession(this.dbPath, this.projectId, title)
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

  listSessions(): WorkshopSession[] {
    return listWorkshopSessions(this.dbPath, this.projectId)
  }

  getSession(sessionId: string): WorkshopSession | null {
    return getWorkshopSession(this.dbPath, sessionId)
  }

  // Messaging

  async sendMessage(sessionId: string, content: string): Promise<void> {
    if (!this.sdkRunner) throw new Error('SDK runner not set')

    createWorkshopMessage(this.dbPath, sessionId, 'user', content)

    const prompt = this.buildPrompt(sessionId, content)
    const resumeSessionId = this.sessionIds.get(sessionId)

    try {
      this.emit('stream', { type: 'text', content: '', sessionId } as WorkshopStreamEvent)

      const result = await this.sdkRunner({
        prompt,
        model: 'claude-sonnet-4-20250514',
        maxTurns: 10,
        cwd: this.projectPath,
        taskId: 0,
        autoMode: true,
        resumeSessionId,
        onStream: (streamContent: string, _type: string) => {
          this.emit('stream', {
            type: 'text',
            content: streamContent,
            sessionId,
          } as WorkshopStreamEvent)
        },
        onApprovalRequest: () => {
          return { behavior: 'allow' as const }
        },
      })

      if (result.sessionId) {
        this.sessionIds.set(sessionId, result.sessionId)
      }

      await this.handleToolCalls(sessionId, result)

      createWorkshopMessage(this.dbPath, sessionId, 'assistant', result.output ?? '')

      this.emit('stream', { type: 'done', sessionId } as WorkshopStreamEvent)
    } catch (error: any) {
      this.emit('stream', {
        type: 'error',
        error: error.message,
        sessionId,
      } as WorkshopStreamEvent)
    }
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
      for (const task of tasks) {
        await this.createPipelineTask(sessionId, task)
      }
    } else {
      this.emit('tasks:suggested', { sessionId, tasks })
    }
  }

  async createPipelineTask(sessionId: string, task: WorkshopSuggestedTask): Promise<void> {
    const created = createTask(this.dbPath, {
      title: task.title,
      description: task.description,
      tier: task.tier,
      priority: 'medium',
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
