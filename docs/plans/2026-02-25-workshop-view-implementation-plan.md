# Workshop View Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a Workshop view to ClawFlow — a dedicated creative/collaborative space where users have back-and-forth conversations with Claude, produce versioned artifacts (docs, diagrams), and spawn pipeline tasks.

**Architecture:** New top-level view (three-panel layout: session list, conversation, artifact viewer) backed by a WorkshopEngine in the main process, new SQLite tables in the per-project DB, a workshopStore in the renderer, and a workshop-agent prompt template with custom tools (create_artifact, update_artifact, suggest_tasks, present_choices, render_diagram).

**Tech Stack:** Electron 40, React 19, Zustand 5, better-sqlite3, @anthropic-ai/claude-agent-sdk, TailwindCSS v4, Mermaid.js (new), react-markdown (new)

**Design Doc:** `docs/plans/2026-02-25-workshop-view-design.md`

---

## Phase 1: Foundation — Types, Database, Dependencies

### Task 1: Install new dependencies

**Files:**
- Modify: `package.json`

**Step 1: Install mermaid and react-markdown**

Run:
```bash
pnpm add mermaid react-markdown remark-gfm
```

**Step 2: Verify installation**

Run:
```bash
pnpm ls mermaid react-markdown remark-gfm
```
Expected: All three listed with version numbers.

**Step 3: Commit**

```bash
git add package.json pnpm-lock.yaml
git commit -m "deps: add mermaid, react-markdown, remark-gfm for Workshop view"
```

---

### Task 2: Add Workshop shared types

**Files:**
- Modify: `src/shared/types.ts`

**Step 1: Add Workshop types to shared/types.ts**

Add these types after the existing Task/Pipeline types:

```ts
// Workshop Types

export type WorkshopSessionStatus = 'active' | 'ended'

export type WorkshopMessageType =
  | 'text'
  | 'choice'
  | 'confirmation'
  | 'artifact_preview'
  | 'system_event'

export type WorkshopMessageRole = 'user' | 'assistant' | 'system'

export type WorkshopArtifactType =
  | 'design_doc'
  | 'diagram'
  | 'task_breakdown'
  | 'spec'
  | 'architecture'

export interface WorkshopSession {
  id: string
  projectId: string
  title: string
  summary: string | null
  status: WorkshopSessionStatus
  createdAt: string
  updatedAt: string
}

export interface WorkshopMessage {
  id: string
  sessionId: string
  role: WorkshopMessageRole
  content: string
  messageType: WorkshopMessageType
  metadata: Record<string, unknown> | null
  createdAt: string
}

export interface WorkshopArtifact {
  id: string
  projectId: string
  name: string
  type: WorkshopArtifactType
  filePath: string
  currentVersion: number
  createdAt: string
  updatedAt: string
}

export interface WorkshopTaskLink {
  id: string
  taskId: number
  sessionId: string | null
  artifactId: string | null
  createdAt: string
}

export interface WorkshopStreamEvent {
  type: 'text' | 'tool_call' | 'tool_result' | 'done' | 'error'
  content?: string
  toolName?: string
  toolInput?: Record<string, unknown>
  toolResult?: unknown
  sessionId?: string
  error?: string
}

export interface WorkshopToolCall {
  name: string
  input: Record<string, unknown>
}

export interface WorkshopSuggestedTask {
  title: string
  description: string
  tier: 'L1' | 'L2' | 'L3'
  linkedArtifactIds?: string[]
}
```

**Step 2: Add Workshop IPC channels to the IpcChannel union**

Find the `IpcChannel` type and add:

```ts
  | 'workshop:start-session'
  | 'workshop:end-session'
  | 'workshop:list-sessions'
  | 'workshop:get-session'
  | 'workshop:send-message'
  | 'workshop:list-messages'
  | 'workshop:list-artifacts'
  | 'workshop:get-artifact'
  | 'workshop:create-tasks'
  | 'workshop:stream'
  | 'workshop:tool-event'
```

**Step 3: Commit**

```bash
git add src/shared/types.ts
git commit -m "feat(workshop): add shared types and IPC channels"
```

---

### Task 3: Add Workshop database tables and CRUD

**Files:**
- Modify: `src/main/db.ts`

**Step 1: Add Workshop tables to initProjectDb()**

Inside the `initProjectDb()` function, after the existing `CREATE TABLE IF NOT EXISTS tasks` block, add:

```sql
CREATE TABLE IF NOT EXISTS workshop_sessions (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT 'New Session',
  summary TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS workshop_messages (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES workshop_sessions(id),
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  message_type TEXT NOT NULL DEFAULT 'text',
  metadata TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS workshop_artifacts (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  file_path TEXT NOT NULL,
  current_version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS workshop_task_links (
  id TEXT PRIMARY KEY,
  task_id INTEGER NOT NULL REFERENCES tasks(id),
  session_id TEXT REFERENCES workshop_sessions(id),
  artifact_id TEXT REFERENCES workshop_artifacts(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

**Step 2: Add row mappers**

```ts
function rowToWorkshopSession(row: any): WorkshopSession {
  return {
    id: row.id,
    projectId: row.project_id,
    title: row.title,
    summary: row.summary,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function rowToWorkshopMessage(row: any): WorkshopMessage {
  return {
    id: row.id,
    sessionId: row.session_id,
    role: row.role,
    content: row.content,
    messageType: row.message_type,
    metadata: safeJsonParse(row.metadata),
    createdAt: row.created_at,
  }
}

function rowToWorkshopArtifact(row: any): WorkshopArtifact {
  return {
    id: row.id,
    projectId: row.project_id,
    name: row.name,
    type: row.type,
    filePath: row.file_path,
    currentVersion: row.current_version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}
```

**Step 3: Add CRUD functions**

```ts
// Workshop Sessions

export function createWorkshopSession(dbPath: string, projectId: string, title?: string): WorkshopSession {
  const db = getProjectDb(dbPath)
  const id = crypto.randomUUID()
  db.prepare(
    `INSERT INTO workshop_sessions (id, project_id, title) VALUES (?, ?, ?)`
  ).run(id, projectId, title ?? 'New Session')
  return getWorkshopSession(dbPath, id)!
}

export function getWorkshopSession(dbPath: string, id: string): WorkshopSession | null {
  const db = getProjectDb(dbPath)
  const row = db.prepare(`SELECT * FROM workshop_sessions WHERE id = ?`).get(id)
  return row ? rowToWorkshopSession(row) : null
}

export function listWorkshopSessions(dbPath: string, projectId: string): WorkshopSession[] {
  const db = getProjectDb(dbPath)
  const rows = db.prepare(
    `SELECT * FROM workshop_sessions WHERE project_id = ? ORDER BY updated_at DESC`
  ).all(projectId)
  return rows.map(rowToWorkshopSession)
}

export function updateWorkshopSession(dbPath: string, id: string, updates: Partial<Pick<WorkshopSession, 'title' | 'summary' | 'status'>>): void {
  const db = getProjectDb(dbPath)
  const setClauses: string[] = []
  const values: any[] = []
  for (const [key, value] of Object.entries(updates)) {
    setClauses.push(`${camelToSnake(key)} = ?`)
    values.push(value)
  }
  setClauses.push(`updated_at = datetime('now')`)
  values.push(id)
  db.prepare(`UPDATE workshop_sessions SET ${setClauses.join(', ')} WHERE id = ?`).run(...values)
}

// Workshop Messages

export function createWorkshopMessage(
  dbPath: string,
  sessionId: string,
  role: WorkshopMessageRole,
  content: string,
  messageType: WorkshopMessageType = 'text',
  metadata?: Record<string, unknown>
): WorkshopMessage {
  const db = getProjectDb(dbPath)
  const id = crypto.randomUUID()
  db.prepare(
    `INSERT INTO workshop_messages (id, session_id, role, content, message_type, metadata) VALUES (?, ?, ?, ?, ?, ?)`
  ).run(id, sessionId, role, content, messageType, metadata ? JSON.stringify(metadata) : null)
  return rowToWorkshopMessage(
    db.prepare(`SELECT * FROM workshop_messages WHERE id = ?`).get(id)
  )
}

export function listWorkshopMessages(dbPath: string, sessionId: string): WorkshopMessage[] {
  const db = getProjectDb(dbPath)
  const rows = db.prepare(
    `SELECT * FROM workshop_messages WHERE session_id = ? ORDER BY created_at ASC`
  ).all(sessionId)
  return rows.map(rowToWorkshopMessage)
}

// Workshop Artifacts

export function createWorkshopArtifact(
  dbPath: string,
  projectId: string,
  name: string,
  type: WorkshopArtifactType,
  filePath: string
): WorkshopArtifact {
  const db = getProjectDb(dbPath)
  const id = crypto.randomUUID()
  db.prepare(
    `INSERT INTO workshop_artifacts (id, project_id, name, type, file_path) VALUES (?, ?, ?, ?, ?)`
  ).run(id, projectId, name, type, filePath)
  return rowToWorkshopArtifact(
    db.prepare(`SELECT * FROM workshop_artifacts WHERE id = ?`).get(id)
  )
}

export function listWorkshopArtifacts(dbPath: string, projectId: string): WorkshopArtifact[] {
  const db = getProjectDb(dbPath)
  const rows = db.prepare(
    `SELECT * FROM workshop_artifacts WHERE project_id = ? ORDER BY updated_at DESC`
  ).all(projectId)
  return rows.map(rowToWorkshopArtifact)
}

export function getWorkshopArtifact(dbPath: string, id: string): WorkshopArtifact | null {
  const db = getProjectDb(dbPath)
  const row = db.prepare(`SELECT * FROM workshop_artifacts WHERE id = ?`).get(id)
  return row ? rowToWorkshopArtifact(row) : null
}

export function updateWorkshopArtifact(dbPath: string, id: string, updates: Partial<Pick<WorkshopArtifact, 'name' | 'currentVersion'>>): void {
  const db = getProjectDb(dbPath)
  const setClauses: string[] = []
  const values: any[] = []
  for (const [key, value] of Object.entries(updates)) {
    setClauses.push(`${camelToSnake(key)} = ?`)
    values.push(value)
  }
  setClauses.push(`updated_at = datetime('now')`)
  values.push(id)
  db.prepare(`UPDATE workshop_artifacts SET ${setClauses.join(', ')} WHERE id = ?`).run(...values)
}

// Workshop Task Links

export function createWorkshopTaskLink(
  dbPath: string,
  taskId: number,
  sessionId?: string,
  artifactId?: string
): void {
  const db = getProjectDb(dbPath)
  const id = crypto.randomUUID()
  db.prepare(
    `INSERT INTO workshop_task_links (id, task_id, session_id, artifact_id) VALUES (?, ?, ?, ?)`
  ).run(id, taskId, sessionId ?? null, artifactId ?? null)
}

export function getWorkshopTaskLinks(dbPath: string, taskId: number): WorkshopTaskLink[] {
  const db = getProjectDb(dbPath)
  const rows = db.prepare(
    `SELECT * FROM workshop_task_links WHERE task_id = ?`
  ).all(taskId)
  return rows.map((row: any) => ({
    id: row.id,
    taskId: row.task_id,
    sessionId: row.session_id,
    artifactId: row.artifact_id,
    createdAt: row.created_at,
  }))
}
```

**Step 4: Commit**

```bash
git add src/main/db.ts
git commit -m "feat(workshop): add database tables and CRUD operations"
```

---

## Phase 2: Main Process — Workshop Engine, SDK, Templates

### Task 4: Create the workshop-agent prompt template

**Files:**
- Create: `src/templates/workshop-agent.md`

**Step 1: Write the template**

```markdown
# Workshop — Creative Collaboration Session

You are a creative collaborator in the ClawFlow Workshop. You're having a back-and-forth conversation with the user to explore ideas, refine concepts, and produce design artifacts for their project.

## Project: {{project_name}}

## Context

### Previous Session Summaries
{{session_summaries}}

### Current Artifacts
{{artifact_list}}

### Pipeline State
{{pipeline_state}}

## Your Tools

You have special Workshop tools to interact with the UI. To use them, output a structured block like this:

<tool_call name="tool_name">
{"param": "value"}
</tool_call>

### create_artifact
Create a new versioned document or diagram. Params:
- `name`: Human-readable artifact name
- `type`: One of: design_doc, diagram, task_breakdown, spec, architecture
- `content`: The full content (markdown for docs, mermaid syntax for diagrams)

### update_artifact
Update an existing artifact with new content. Params:
- `artifact_id`: The ID of the artifact to update
- `content`: The complete updated content
- `summary`: Brief description of what changed

### suggest_tasks
Suggest tasks to add to the development pipeline. Params:
- `tasks`: Array of objects with `title`, `description`, and `tier` (L1, L2, or L3)

### present_choices
Present structured options for the user to choose from. Params:
- `question`: The question being asked
- `options`: Array of objects with `label` and `description`

### render_diagram
Render a Mermaid diagram in the artifact panel. Params:
- `title`: Diagram title
- `mermaid`: Valid Mermaid.js syntax

## Guidelines

- Be conversational and collaborative. This is a thinking space, not a task runner.
- Ask one question at a time when exploring ideas.
- Use `present_choices` when offering structured options.
- Create artifacts when ideas crystallize into something concrete.
- Use `render_diagram` liberally — visual diagrams are highly valued.
- Suggest tasks when actionable work items emerge from the conversation.
- Keep artifacts cohesive — update existing ones rather than creating duplicates.
- Reference previous session context naturally, don't dump it all at once.

## Current Conversation
```

**Step 2: Commit**

```bash
git add src/templates/workshop-agent.md
git commit -m "feat(workshop): add workshop-agent prompt template"
```

---

### Task 5: Add workshop prompt construction to template-engine

**Files:**
- Modify: `src/main/template-engine.ts`

**Step 1: Add constructWorkshopPrompt function**

```ts
export function constructWorkshopPrompt(params: {
  projectName: string
  sessionSummaries: string
  artifactList: string
  pipelineState: string
}): string {
  const templatePath = path.join(TEMPLATES_DIR, 'workshop-agent.md')
  let template = fs.readFileSync(templatePath, 'utf-8')

  const replacements: Record<string, string> = {
    '{{project_name}}': params.projectName,
    '{{session_summaries}}': params.sessionSummaries || 'No previous sessions.',
    '{{artifact_list}}': params.artifactList || 'No artifacts yet.',
    '{{pipeline_state}}': params.pipelineState || 'No active pipeline tasks.',
  }

  for (const [placeholder, value] of Object.entries(replacements)) {
    template = template.replaceAll(placeholder, value)
  }

  return template
}
```

**Step 2: Commit**

```bash
git add src/main/template-engine.ts
git commit -m "feat(workshop): add workshop prompt construction"
```

---

### Task 6: Create WorkshopEngine

**Files:**
- Create: `src/main/workshop-engine.ts`

**Step 1: Write the WorkshopEngine class**

This follows the PipelineEngine pattern (EventEmitter, SdkRunner, DB operations) but manages conversational sessions instead of pipeline stages.

```ts
import { EventEmitter } from 'events'
import * as crypto from 'crypto'
import * as fs from 'fs'
import * as path from 'path'
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
  WorkshopMessage,
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
        // Generate session summary
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

    // Save user message to DB
    createWorkshopMessage(this.dbPath, sessionId, 'user', content)

    // Build context for the prompt
    const prompt = this.buildPrompt(sessionId, content)

    // Get SDK session ID for resume (if continuing conversation)
    const resumeSessionId = this.sessionIds.get(sessionId)

    try {
      this.emit('stream', { type: 'text', content: '', sessionId } as WorkshopStreamEvent)

      const result = await this.sdkRunner({
        prompt,
        model: 'claude-sonnet-4-20250514',
        maxTurns: 10,
        cwd: this.projectPath,
        taskId: 0, // Workshop doesn't use task IDs
        autoMode: true, // Workshop manages its own tool approval
        resumeSessionId,
        onStream: (streamContent: string, type: string) => {
          this.emit('stream', { type: 'text', content: streamContent, sessionId } as WorkshopStreamEvent)
        },
        onApprovalRequest: () => {
          // Workshop tools are always auto-approved
          return { behavior: 'allow' as const }
        },
      })

      // Store SDK session ID for future resume
      if (result.sessionId) {
        this.sessionIds.set(sessionId, result.sessionId)
      }

      // Parse and handle tool calls from the output
      await this.handleToolCalls(sessionId, result)

      // Save assistant message to DB
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
    // Gather context
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

    // Get conversation history for this session
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

    // Look for tool call patterns in Claude's structured output
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
          this.createArtifact(
            toolInput.name,
            toolInput.type,
            toolInput.content,
            sessionId
          )
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
          this.createArtifact(
            toolInput.title,
            'diagram',
            toolInput.mermaid,
            sessionId
          )
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

  // Artifact Operations (called by tool handlers)

  createArtifact(
    name: string,
    type: WorkshopArtifactType,
    content: string,
    sessionId: string
  ): WorkshopArtifact {
    // Determine file path based on type
    const ext = type === 'diagram' ? '.mermaid' : '.md'
    const fileName = name.toLowerCase().replace(/[^a-z0-9]+/g, '-') + ext
    const filePath = `docs/workshop/${fileName}`
    const fullPath = path.join(this.projectPath, filePath)

    // Ensure directory exists
    fs.mkdirSync(path.dirname(fullPath), { recursive: true })

    // Write file
    fs.writeFileSync(fullPath, content, 'utf-8')

    // Save to DB
    const artifact = createWorkshopArtifact(this.dbPath, this.projectId, name, type, filePath)

    // Emit event for renderer
    this.emit('artifact:created', artifact)

    // Add system message
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

  async suggestTasks(
    sessionId: string,
    tasks: WorkshopSuggestedTask[]
  ): Promise<void> {
    if (this.autoMode) {
      // Auto mode: create tasks directly
      for (const task of tasks) {
        await this.createPipelineTask(sessionId, task)
      }
    } else {
      // Gated mode: emit event for renderer to show confirmation UI
      this.emit('tasks:suggested', { sessionId, tasks })
    }
  }

  async createPipelineTask(
    sessionId: string,
    task: WorkshopSuggestedTask
  ): Promise<void> {
    const created = createTask(this.dbPath, {
      title: task.title,
      description: task.description,
      tier: task.tier,
      priority: 'medium',
      status: 'backlog',
    })

    // Link task to workshop session and artifacts
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
```

**Step 2: Commit**

```bash
git add src/main/workshop-engine.ts
git commit -m "feat(workshop): add WorkshopEngine for session and artifact management"
```

---

### Task 7: Register Workshop IPC handlers

**Files:**
- Modify: `src/main/index.ts` (for handlers needing mainWindow)
- Modify: `src/preload/index.ts`
- Modify: `src/renderer/src/global.d.ts`

**Step 1: Add Workshop IPC handlers in index.ts**

After the pipeline IPC registration section, add a `registerWorkshopIpc()` function and call it:

```ts
import { WorkshopEngine } from './workshop-engine'

let currentWorkshopEngine: WorkshopEngine | null = null

function registerWorkshopIpc() {
  ipcMain.handle('workshop:start-session', (_e, dbPath, projectPath, projectId, projectName, title?) => {
    if (!currentWorkshopEngine || currentWorkshopEngine['dbPath'] !== dbPath) {
      currentWorkshopEngine = new WorkshopEngine(dbPath, projectPath, projectId, projectName)
      const sdkRunner = createSdkRunner(mainWindow!)
      currentWorkshopEngine.setSdkRunner(sdkRunner)

      // Forward events to renderer
      currentWorkshopEngine.on('stream', (event) => {
        mainWindow?.webContents.send('workshop:stream', event)
      })
      currentWorkshopEngine.on('artifact:created', (artifact) => {
        mainWindow?.webContents.send('workshop:tool-event', { type: 'artifact_created', artifact })
      })
      currentWorkshopEngine.on('artifact:updated', (data) => {
        mainWindow?.webContents.send('workshop:tool-event', { type: 'artifact_updated', ...data })
      })
      currentWorkshopEngine.on('tasks:suggested', (data) => {
        mainWindow?.webContents.send('workshop:tool-event', { type: 'tasks_suggested', ...data })
      })
      currentWorkshopEngine.on('task:created', (data) => {
        mainWindow?.webContents.send('workshop:tool-event', { type: 'task_created', ...data })
      })
    }
    return currentWorkshopEngine.startSession(title)
  })

  ipcMain.handle('workshop:end-session', async (_e, sessionId) => {
    await currentWorkshopEngine?.endSession(sessionId)
  })

  ipcMain.handle('workshop:list-sessions', (_e, dbPath, projectPath, projectId, projectName) => {
    if (!currentWorkshopEngine) {
      currentWorkshopEngine = new WorkshopEngine(dbPath, projectPath, projectId, projectName)
    }
    return currentWorkshopEngine.listSessions()
  })

  ipcMain.handle('workshop:get-session', (_e, sessionId) => {
    return currentWorkshopEngine?.getSession(sessionId) ?? null
  })

  ipcMain.handle('workshop:send-message', async (_e, sessionId, content) => {
    await currentWorkshopEngine?.sendMessage(sessionId, content)
  })

  ipcMain.handle('workshop:list-messages', (_e, dbPath, sessionId) => {
    const { listWorkshopMessages } = require('./db')
    return listWorkshopMessages(dbPath, sessionId)
  })

  ipcMain.handle('workshop:list-artifacts', (_e) => {
    return currentWorkshopEngine?.listArtifacts() ?? []
  })

  ipcMain.handle('workshop:get-artifact', (_e, artifactId) => {
    const content = currentWorkshopEngine?.getArtifactContent(artifactId) ?? null
    const artifacts = currentWorkshopEngine?.listArtifacts() ?? []
    const artifact = artifacts.find(a => a.id === artifactId) ?? null
    return { artifact, content }
  })

  ipcMain.handle('workshop:create-tasks', async (_e, sessionId, tasks) => {
    if (!currentWorkshopEngine) return
    for (const task of tasks) {
      await currentWorkshopEngine.createPipelineTask(sessionId, task)
    }
  })
}
```

Call `registerWorkshopIpc()` in the app ready handler alongside the existing IPC registration.

**Step 2: Add Workshop API to preload/index.ts**

Add a `workshop` namespace to the contextBridge `api` object:

```ts
workshop: {
  startSession: (dbPath: string, projectPath: string, projectId: string, projectName: string, title?: string) =>
    ipcRenderer.invoke('workshop:start-session', dbPath, projectPath, projectId, projectName, title),
  endSession: (sessionId: string) =>
    ipcRenderer.invoke('workshop:end-session', sessionId),
  listSessions: (dbPath: string, projectPath: string, projectId: string, projectName: string) =>
    ipcRenderer.invoke('workshop:list-sessions', dbPath, projectPath, projectId, projectName),
  getSession: (sessionId: string) =>
    ipcRenderer.invoke('workshop:get-session', sessionId),
  sendMessage: (sessionId: string, content: string) =>
    ipcRenderer.invoke('workshop:send-message', sessionId, content),
  listMessages: (dbPath: string, sessionId: string) =>
    ipcRenderer.invoke('workshop:list-messages', dbPath, sessionId),
  listArtifacts: () =>
    ipcRenderer.invoke('workshop:list-artifacts'),
  getArtifact: (artifactId: string) =>
    ipcRenderer.invoke('workshop:get-artifact', artifactId),
  createTasks: (sessionId: string, tasks: any[]) =>
    ipcRenderer.invoke('workshop:create-tasks', sessionId, tasks),
  onStream: (callback: (event: any) => void) => {
    const handler = (_e: any, data: any) => callback(data)
    ipcRenderer.on('workshop:stream', handler)
    return () => ipcRenderer.removeListener('workshop:stream', handler)
  },
  onToolEvent: (callback: (event: any) => void) => {
    const handler = (_e: any, data: any) => callback(data)
    ipcRenderer.on('workshop:tool-event', handler)
    return () => ipcRenderer.removeListener('workshop:tool-event', handler)
  },
},
```

**Step 3: Add types to global.d.ts**

Add the `workshop` namespace to the `WindowApi` interface matching the preload bridge.

**Step 4: Commit**

```bash
git add src/main/index.ts src/preload/index.ts src/renderer/src/global.d.ts
git commit -m "feat(workshop): register IPC handlers and preload bridge"
```

---

## Phase 3: Frontend — Store, View Shell, Navigation

### Task 8: Create workshopStore

**Files:**
- Create: `src/renderer/src/stores/workshopStore.ts`

**Step 1: Write the store**

Follow the exact Zustand pattern from taskStore/pipelineStore: `create<WorkshopState>((set, get) => ({...}))` with state fields, action methods that call `window.api.workshop.*`, and a `setupListeners()` method that subscribes to `workshop:stream` and `workshop:tool-event` push events and returns a cleanup function.

Key state: `sessions`, `currentSessionId`, `currentSession`, `messages`, `artifacts`, `selectedArtifactId`, `artifactContent`, `streamingContent`, `isStreaming`, `pendingSuggestions`, `autoMode`.

Key actions: `loadSessions`, `startSession`, `endSession`, `selectSession`, `sendMessage`, `loadArtifacts`, `selectArtifact`, `approveSuggestions`, `dismissSuggestions`, `toggleAutoMode`, `setupListeners`.

The `setupListeners` method subscribes to `workshop:stream` events to accumulate streaming text, and on `done` event creates the full assistant message. It subscribes to `workshop:tool-event` to refresh artifacts and handle task suggestions.

**Step 2: Commit**

```bash
git add src/renderer/src/stores/workshopStore.ts
git commit -m "feat(workshop): add workshopStore with session, message, and artifact state"
```

---

### Task 9: Add Workshop view routing and navigation

**Files:**
- Modify: `src/renderer/src/stores/layoutStore.ts`
- Modify: `src/renderer/src/App.tsx`
- Modify: `src/renderer/src/components/Dashboard/TopBar.tsx`

**Step 1: Add 'workshop' to View type in layoutStore.ts**

Change: `type View = 'projects' | 'dashboard' | 'task-detail'`
To: `type View = 'projects' | 'dashboard' | 'task-detail' | 'workshop'`

**Step 2: Add Workshop route to App.tsx**

Import Workshop component and add: `{view === 'workshop' && <Workshop />}`

**Step 3: Add Workshop button to Dashboard TopBar**

Add a navigation button styled with `bg-accent-teal/10 text-accent-teal` that calls `useLayoutStore.getState().setView('workshop')`.

**Step 4: Commit**

```bash
git add src/renderer/src/stores/layoutStore.ts src/renderer/src/App.tsx src/renderer/src/components/Dashboard/TopBar.tsx
git commit -m "feat(workshop): add view routing and navigation"
```

---

## Phase 4: Frontend — Workshop UI Components

### Task 10: Create Workshop shell component

**Files:**
- Create: `src/renderer/src/components/Workshop/Workshop.tsx`

**Step 1: Write the Workshop root component**

Three-panel layout: SessionList (left), ConversationPanel (center), ArtifactPanel (right). Top bar with back-to-dashboard button, "Workshop" title, project name, and auto mode toggle. Uses `useEffect` to call `setupListeners()` and `loadSessions()`/`loadArtifacts()` on mount. Renders `TaskSuggestionModal` when `pendingSuggestions` is not null. Root div: `h-full bg-bg flex flex-col`.

**Step 2: Commit**

```bash
git add src/renderer/src/components/Workshop/Workshop.tsx
git commit -m "feat(workshop): add Workshop shell component with three-panel layout"
```

---

### Task 11: Create SessionList component

**Files:**
- Create: `src/renderer/src/components/Workshop/SessionList.tsx`

**Step 1: Write the SessionList**

Left sidebar (w-64, border-r). "New Session" button at top. Scrollable list of SessionItem buttons below. Each shows title, date, status badge ("ended"), and summary snippet. Active session highlighted with `bg-accent-teal/10` and left border accent. Empty state message when no sessions.

**Step 2: Commit**

```bash
git add src/renderer/src/components/Workshop/SessionList.tsx
git commit -m "feat(workshop): add SessionList component"
```

---

### Task 12: Create ConversationPanel and MessageBubble

**Files:**
- Create: `src/renderer/src/components/Workshop/ConversationPanel.tsx`
- Create: `src/renderer/src/components/Workshop/MessageBubble.tsx`

**Step 1: Write ConversationPanel**

Center panel (flex-1). Messages area with auto-scroll to bottom. Shows all messages, streaming indicator while Claude responds (pulsing dot + "Claude is thinking..."), and accumulated streaming content as a live-updating assistant bubble. Input area at bottom: textarea (Enter to send, Shift+Enter for newline) + Send button. Disabled while streaming. Empty state when no session selected: "Select a session or start a new one".

**Step 2: Write MessageBubble**

Renders differently by role:
- **user**: right-aligned, `bg-accent-teal/15`, plain text
- **assistant**: left-aligned, `bg-surface border border-border`, rendered with `react-markdown` + `remark-gfm`
- **system**: centered, small pill-shaped badge with muted text

**Step 3: Commit**

```bash
git add src/renderer/src/components/Workshop/ConversationPanel.tsx src/renderer/src/components/Workshop/MessageBubble.tsx
git commit -m "feat(workshop): add ConversationPanel and MessageBubble components"
```

---

### Task 13: Create ArtifactPanel with Mermaid rendering

**Files:**
- Create: `src/renderer/src/components/Workshop/ArtifactPanel.tsx`
- Create: `src/renderer/src/components/Workshop/MermaidDiagram.tsx`

**Step 1: Write MermaidDiagram component**

Initialize mermaid with dark theme (matching ClawFlow's color scheme). Uses `useEffect` to call `mermaid.render()` when content changes. Shows error state with red border if rendering fails, including the raw mermaid source for debugging.

**Step 2: Write ArtifactPanel**

Right panel (w-96, border-l). Tab bar across top for each artifact (name + version badge). Content area renders the selected artifact: MermaidDiagram for diagram types, ReactMarkdown for docs/specs. Empty state: "Artifacts will appear here as Claude creates documents and diagrams".

**Step 3: Commit**

```bash
git add src/renderer/src/components/Workshop/ArtifactPanel.tsx src/renderer/src/components/Workshop/MermaidDiagram.tsx
git commit -m "feat(workshop): add ArtifactPanel with Mermaid diagram rendering"
```

---

### Task 14: Create TaskSuggestionModal

**Files:**
- Create: `src/renderer/src/components/Workshop/TaskSuggestionModal.tsx`

**Step 1: Write the component**

Modal overlay (fixed inset-0, backdrop). Card with header ("Create Pipeline Tasks"), scrollable list of editable task cards (title input, description textarea, tier dropdown L1/L2/L3, remove button), and footer with Dismiss + "Create N Tasks" buttons. Uses local state initialized from `pendingSuggestions` so users can edit before approving.

**Step 2: Commit**

```bash
git add src/renderer/src/components/Workshop/TaskSuggestionModal.tsx
git commit -m "feat(workshop): add TaskSuggestionModal for pipeline task creation"
```

---

## Phase 5: Integration & Polish

### Task 15: Build and verify

**Step 1: Run TypeScript type check**

Run: `npx tsc --noEmit`
Expected: No errors.

**Step 2: Run build**

Run: `pnpm run build`
Expected: Build succeeds.

**Step 3: Fix any type errors or import issues**

Address each error individually, following the patterns established in the codebase.

**Step 4: Commit any fixes**

```bash
git add -A
git commit -m "fix(workshop): resolve build errors"
```

---

### Task 16: Manual smoke test

**Step 1: Start the app**

Run: `pnpm run dev`

**Step 2: Verify Workshop navigation**

- From Dashboard, click the Workshop button in TopBar
- Verify the three-panel layout renders
- Verify the "back to Dashboard" button works

**Step 3: Test session lifecycle**

- Click "New Session" — session appears in sidebar
- Type a message and send — message appears in conversation
- Verify streaming indicator shows while Claude responds
- Verify Claude's response renders with markdown

**Step 4: Test artifact creation**

- Ask Claude to create a diagram or design doc
- Verify it appears in the artifact panel tabs
- Verify Mermaid diagrams render visually

**Step 5: Test task suggestion flow**

- Ask Claude to suggest pipeline tasks
- Verify the TaskSuggestionModal appears
- Approve tasks — verify they appear in the pipeline kanban

**Step 6: Test session resume**

- End a session — verify it shows "ended" in sidebar
- Start a new session — verify it loads without previous session's full history
- Resume an active session — verify messages are still there

**Step 7: Report any issues found and fix them**

---

## Task Dependency Order

```
Task 1 (deps) --> Task 2 (types) --> Task 3 (DB)
                                        |
Task 4 (template) --> Task 5 (template-engine) --> Task 6 (WorkshopEngine) --> Task 7 (IPC)
                                                                                  |
Task 8 (store) --> Task 9 (routing) --> Task 10 (shell) --> Task 11-14 (UI components)
                                                                  |
                                                        Task 15 (build) --> Task 16 (smoke test)
```

Tasks 1-3 are sequential (foundation). Tasks 4-5 can run in parallel with 1-3. Task 6 depends on 3 and 5. Task 7 depends on 6. Tasks 8-9 depend on 2 and 7. Tasks 10-14 depend on 8-9. Tasks 11-14 can be parallelized. Task 15-16 are sequential (verification).

---

## Notes for Implementation

- **Theme colors:** Use `bg-bg`, `bg-surface`, `text-text`, `text-text-muted`, `border-border`, `bg-accent-teal` — established custom properties in `theme.ts` and `index.css`.
- **Import paths:** Renderer components import shared types via `../../../../shared/types` (relative from component directory).
- **IPC pattern:** Request/response uses `ipcRenderer.invoke` / `ipcMain.handle`. Push events use `ipcRenderer.on` / `webContents.send` with cleanup functions.
- **No React Router:** Navigation is via `useLayoutStore.getState().setView('workshop')`.
- **SDK model:** Workshop conversations use `claude-sonnet-4-20250514` (speed + quality balance for chat), `claude-haiku-4-5-20251001` for summary generation.
- **No shell commands in engine:** File operations use Node.js `fs` module directly, not child processes.
