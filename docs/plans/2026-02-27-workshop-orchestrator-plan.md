# Workshop Orchestrator Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Transform the workshop into a persistent orchestrator that plans features, breaks them into grouped tasks with work orders, dispatches parallel sub-agents for implementation, and monitors their progress.

**Architecture:** Workshop sessions gain a new Execute phase where they spawn and coordinate parallel sub-agents through the pipeline engine. Task groups link related tasks with shared context and work orders. The pipeline engine gains group-level operations (launch, pause, resume). Sub-agents receive precise work orders instead of running their own brainstorm/plan stages.

**Tech Stack:** Electron, TypeScript, better-sqlite3, @anthropic-ai/claude-agent-sdk, EventEmitter IPC

---

## Task 1: Add TaskGroup and WorkOrder Types

**Files:**
- Modify: `src/shared/types.ts`

**Step 1: Add WorkOrder interface**

Add after the `CreateTaskInput` interface (after line ~138):

```typescript
export interface FileTarget {
  path: string
  action: 'create' | 'modify'
  description: string
}

export interface WorkOrder {
  objective: string
  files: FileTarget[]
  patterns: string[]
  integration: string[]
  constraints: string[]
  tests: string[]
}
```

**Step 2: Add TaskGroup interface**

Add after the new WorkOrder interface:

```typescript
export type TaskGroupStatus = 'planning' | 'queued' | 'running' | 'paused' | 'completed' | 'failed'

export interface TaskGroup {
  id: number
  title: string
  sessionId: number
  status: TaskGroupStatus
  designArtifactId: number | null
  sharedContext: string
  createdAt: string
  updatedAt: string
}

export interface CreateTaskGroupInput {
  title: string
  sessionId: number
  designArtifactId?: number
  sharedContext: string
}
```

**Step 3: Extend Task interface**

Add three fields to the Task interface (after `artifacts` field, line ~127):

```typescript
  groupId: number | null
  workOrder: WorkOrder | null
  assignedSkill: string | null
```

**Step 4: Extend CreateTaskInput**

Add optional fields to CreateTaskInput:

```typescript
  groupId?: number
  workOrder?: WorkOrder
  assignedSkill?: string
```

**Step 5: Extend WorkshopSuggestedTask**

Find the `WorkshopSuggestedTask` interface and add work order and skill fields:

```typescript
export interface WorkshopSuggestedTask {
  title: string
  description: string
  tier?: Tier
  priority?: Priority
  dependsOn?: number[]
  workOrder?: WorkOrder
  assignedSkill?: string
}
```

**Step 6: Commit**

```
git add src/shared/types.ts
git commit -m "feat: add TaskGroup, WorkOrder types and extend Task interface"
```

---

## Task 2: Add Database Schema for Task Groups

**Files:**
- Modify: `src/main/db.ts`

**Step 1: Add task_groups table creation**

In the `initProjectDb()` function, after the `task_dependencies` CREATE TABLE (after line ~226), add:

```typescript
    db.exec(`
      CREATE TABLE IF NOT EXISTS task_groups (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        session_id INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'planning',
        design_artifact_id INTEGER,
        shared_context TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (session_id) REFERENCES workshop_sessions(id) ON DELETE CASCADE
      )
    `)
```

**Step 2: Add migration for new task columns**

In the migration section (around line ~647), add migration for the three new Task columns:

```typescript
    // Migration: add group support to tasks
    const hasGroupId = columns.some((c: any) => c.name === 'group_id')
    if (!hasGroupId) {
      db.exec(`ALTER TABLE tasks ADD COLUMN group_id INTEGER REFERENCES task_groups(id)`)
      db.exec(`ALTER TABLE tasks ADD COLUMN work_order TEXT`)
      db.exec(`ALTER TABLE tasks ADD COLUMN assigned_skill TEXT`)
    }
```

**Step 3: Add CRUD functions for task_groups**

Add after the existing task CRUD functions:

```typescript
export function createTaskGroup(dbPath: string, input: CreateTaskGroupInput): TaskGroup {
  const db = getProjectDb(dbPath)
  const result = db.prepare(`
    INSERT INTO task_groups (title, session_id, status, design_artifact_id, shared_context)
    VALUES (?, ?, 'planning', ?, ?)
  `).run(input.title, input.sessionId, input.designArtifactId ?? null, input.sharedContext)

  return getTaskGroup(dbPath, Number(result.lastInsertRowid))!
}

export function getTaskGroup(dbPath: string, groupId: number): TaskGroup | null {
  const db = getProjectDb(dbPath)
  const row = db.prepare('SELECT * FROM task_groups WHERE id = ?').get(groupId) as any
  if (!row) return null
  return {
    id: row.id,
    title: row.title,
    sessionId: row.session_id,
    status: row.status,
    designArtifactId: row.design_artifact_id,
    sharedContext: row.shared_context,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

export function updateTaskGroup(dbPath: string, groupId: number, updates: Partial<Record<string, any>>): TaskGroup | null {
  const db = getProjectDb(dbPath)
  const snakeUpdates: Record<string, any> = {}
  for (const [key, value] of Object.entries(updates)) {
    const snakeKey = key.replace(/[A-Z]/g, (m) => '_' + m.toLowerCase())
    snakeUpdates[snakeKey] = value
  }
  snakeUpdates['updated_at'] = new Date().toISOString()

  const setClauses = Object.keys(snakeUpdates).map((k) => `${k} = ?`).join(', ')
  const values = Object.values(snakeUpdates)

  db.prepare(`UPDATE task_groups SET ${setClauses} WHERE id = ?`).run(...values, groupId)
  return getTaskGroup(dbPath, groupId)
}

export function listTaskGroups(dbPath: string): TaskGroup[] {
  const db = getProjectDb(dbPath)
  const rows = db.prepare('SELECT * FROM task_groups ORDER BY id').all() as any[]
  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    sessionId: row.session_id,
    status: row.status,
    designArtifactId: row.design_artifact_id,
    sharedContext: row.shared_context,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }))
}

export function getTasksByGroup(dbPath: string, groupId: number): Task[] {
  const db = getProjectDb(dbPath)
  const rows = db.prepare('SELECT * FROM tasks WHERE group_id = ? ORDER BY id').all(groupId) as any[]
  return rows.map(rowToTask)
}

export function deleteTaskGroup(dbPath: string, groupId: number): void {
  const db = getProjectDb(dbPath)
  // Unlink tasks from group (don't delete them)
  db.prepare('UPDATE tasks SET group_id = NULL WHERE group_id = ?').run(groupId)
  db.prepare('DELETE FROM task_groups WHERE id = ?').run(groupId)
}
```

**Step 4: Update rowToTask to handle new columns**

In the `rowToTask` function (line ~702), add parsing for the three new fields:

```typescript
    groupId: row.group_id ?? null,
    workOrder: row.work_order ? JSON.parse(row.work_order) : null,
    assignedSkill: row.assigned_skill ?? null,
```

**Step 5: Update createTask to handle new fields**

In the `createTask` function, add the new columns to the INSERT statement and handle WorkOrder JSON serialization. Add `group_id`, `work_order`, `assigned_skill` to the INSERT columns and `input.groupId ?? null`, `input.workOrder ? JSON.stringify(input.workOrder) : null`, `input.assignedSkill ?? null` to the VALUES.

**Step 6: Commit**

```
git add src/main/db.ts
git commit -m "feat: add task_groups table and extend tasks with group support"
```

---

## Task 3: Add Grouped Task Stage Sequence to Constants

**Files:**
- Modify: `src/shared/constants.ts`

**Step 1: Add GROUPED_STAGES constant**

After the `TIER_STAGES` definition (line ~7), add:

```typescript
export const GROUPED_STAGES: PipelineStage[] = ['implement', 'code_review', 'verify', 'done']
```

**Step 2: Add helper to get stages for a task**

```typescript
export function getTaskStages(tier: Tier, isGrouped: boolean): PipelineStage[] {
  return isGrouped ? GROUPED_STAGES : TIER_STAGES[tier]
}
```

**Step 3: Commit**

```
git add src/shared/constants.ts
git commit -m "feat: add GROUPED_STAGES constant for workshop-orchestrated tasks"
```

---

## Task 4: Add Grouped Implementation Template

**Files:**
- Create: `src/templates/grouped-implement-agent.md`

**Step 1: Create the grouped implementation template**

```markdown
# Grouped Implementation Agent

> **Builder** `opus` . {{timestamp}}

You are implementing a specific task within a larger feature coordinated by a workshop orchestrator.

## Your Task

**Title:** {{title}}
**Description:** {{description}}

## Work Order

{{work_order}}

## Group Context

This task is part of a larger feature. Here is the shared design and plan:

{{shared_context}}

## Sibling Tasks

These tasks are being implemented in parallel. Respect file ownership boundaries:

{{sibling_tasks}}

## Previous Stage Context

{{previous_handoff}}

## Available Tools

### Knowledge

Check the Domain Knowledge Index above before writing code -- existing lessons may inform your implementation.

**fetch_knowledge** -- Read full details of a domain knowledge entry.
<tool_call name="fetch_knowledge">
{"key_or_id": "api-date-format"}
</tool_call>

**save_knowledge** -- Save a discovery as a candidate knowledge entry (reviewed by user later).
<tool_call name="save_knowledge">
{"key": "short-identifier", "summary": "One-line description", "content": "Full details", "category": "api_quirk", "tags": ["relevant"]}
</tool_call>

### Escalation

If your work order doesn't match reality (files missing, patterns changed, conflicts):

**signal_workshop** -- Alert the workshop orchestrator.
<tool_call name="signal_workshop">
{"type": "question", "content": "The validator module referenced in my work order doesn't exist yet. Should I create it or wait?"}
</tool_call>

Types: `question` | `conflict` | `blocker` | `update`

## Rules

- Follow your work order precisely. Touch ONLY the files assigned to you.
- Do NOT modify files owned by sibling tasks.
- Follow the assigned skill methodology (see Skill Instructions below).
- If the work order is ambiguous, use signal_workshop to ask -- do not improvise.
- Commit after each logical unit of work.
```

**Step 2: Commit**

```
git add src/templates/grouped-implement-agent.md
git commit -m "feat: add grouped implementation agent template with work order support"
```

---

## Task 5: Extend Template Engine for Grouped Tasks

**Files:**
- Modify: `src/main/template-engine.ts`

**Step 1: Add work order formatting function**

```typescript
function formatWorkOrder(workOrder: WorkOrder): string {
  const sections: string[] = []

  sections.push(`**Objective:** ${workOrder.objective}`)

  if (workOrder.files.length > 0) {
    sections.push('\n**Files:**')
    for (const f of workOrder.files) {
      sections.push(`- \`${f.path}\` (${f.action}): ${f.description}`)
    }
  }

  if (workOrder.patterns.length > 0) {
    sections.push('\n**Patterns to Follow:**')
    for (const p of workOrder.patterns) {
      sections.push(`- ${p}`)
    }
  }

  if (workOrder.integration.length > 0) {
    sections.push('\n**Integration Points:**')
    for (const i of workOrder.integration) {
      sections.push(`- ${i}`)
    }
  }

  if (workOrder.constraints.length > 0) {
    sections.push('\n**Constraints:**')
    for (const c of workOrder.constraints) {
      sections.push(`- ${c}`)
    }
  }

  if (workOrder.tests.length > 0) {
    sections.push('\n**Expected Tests:**')
    for (const t of workOrder.tests) {
      sections.push(`- ${t}`)
    }
  }

  return sections.join('\n')
}
```

**Step 2: Add sibling task formatting function**

```typescript
function formatSiblingTasks(tasks: Task[], currentTaskId: number): string {
  const siblings = tasks.filter(t => t.id !== currentTaskId)
  if (siblings.length === 0) return 'No sibling tasks.'

  return siblings.map(t => {
    const files = t.workOrder?.files.map(f => `\`${f.path}\``).join(', ') ?? 'unknown'
    return `- **${t.title}** (Task #${t.id}): Files: ${files}`
  }).join('\n')
}
```

**Step 3: Add constructGroupedPrompt function**

```typescript
export function constructGroupedPrompt(
  task: Task,
  groupSharedContext: string,
  siblingTasks: Task[],
  projectPath: string,
  dbPath?: string
): string {
  const templatePath = path.join(TEMPLATES_DIR, 'grouped-implement-agent.md')
  let template = fs.readFileSync(templatePath, 'utf-8')

  // Append handoff template
  const handoffPath = path.join(TEMPLATES_DIR, '_handoff.md')
  if (fs.existsSync(handoffPath)) {
    template += '\n\n' + fs.readFileSync(handoffPath, 'utf-8')
  }

  // Fill standard placeholders
  template = fillTemplate(template, task, projectPath)

  // Fill grouped-specific placeholders
  template = template.replaceAll('{{work_order}}', task.workOrder ? formatWorkOrder(task.workOrder) : 'No work order provided.')
  template = template.replaceAll('{{shared_context}}', groupSharedContext)
  template = template.replaceAll('{{sibling_tasks}}', formatSiblingTasks(siblingTasks, task.id))

  // Load and append assigned skill
  if (task.assignedSkill) {
    const skillContent = loadSkillContent(task.assignedSkill)
    if (skillContent) {
      template += `\n\n---\n\n## Skill Instructions: ${task.assignedSkill}\n\nFollow these instructions for this stage:\n\n${skillContent}`
    }
  } else {
    // Default to implement stage skill (test-driven-development)
    const config = STAGE_CONFIGS['implement']
    const skillCore = dbPath ? loadSkillCore('implement', dbPath) : ''
    const skillContent = skillCore || loadSkillContent(config.skill)
    if (skillContent) {
      template += `\n\n---\n\n## Skill Instructions: ${config.skill}\n\nFollow these instructions for this stage:\n\n${skillContent}`
    }
  }

  // Inject knowledge index
  if (dbPath) {
    const knowledgeIndex = buildKnowledgeIndex(dbPath)
    if (knowledgeIndex) {
      template = `\n\n---\n${knowledgeIndex}\n---\n\n` + template
    }
  }

  return template
}
```

**Step 4: Commit**

```
git add src/main/template-engine.ts
git commit -m "feat: add constructGroupedPrompt for work order-based implementation"
```

---

## Task 6: Add Group Operations to Pipeline Engine

**Files:**
- Modify: `src/main/pipeline-engine.ts`

**Step 1: Add imports**

Add to the imports at the top of the file:

```typescript
import { getTaskGroup, updateTaskGroup, getTasksByGroup } from './db'
import { GROUPED_STAGES } from '../shared/constants'
import { constructGroupedPrompt } from './template-engine'
import type { TaskGroup } from '../shared/types'
```

**Step 2: Add launchGroup method**

Add to the PipelineEngine class:

```typescript
async launchGroup(groupId: number): Promise<void> {
  const group = getTaskGroup(this.dbPath, groupId)
  if (!group) throw new Error(`Group ${groupId} not found`)
  if (group.status !== 'queued') throw new Error(`Group ${groupId} is not queued (status: ${group.status})`)

  const tasks = getTasksByGroup(this.dbPath, groupId)
  if (tasks.length === 0) throw new Error(`Group ${groupId} has no tasks`)

  // Validate no file ownership conflicts
  const fileOwnership = new Map<string, number>()
  for (const task of tasks) {
    if (!task.workOrder?.files) continue
    for (const file of task.workOrder.files) {
      const existing = fileOwnership.get(file.path)
      if (existing !== undefined) {
        throw new Error(`File conflict: "${file.path}" is assigned to both Task #${existing} and Task #${task.id}`)
      }
      fileOwnership.set(file.path, task.id)
    }
  }

  // Set group to running
  updateTaskGroup(this.dbPath, groupId, { status: 'running' })
  this.emit('group:launched', { groupId, taskCount: tasks.length })

  // Launch all tasks in parallel
  const launchPromises = tasks.map(async (task) => {
    try {
      // Create worktree
      if (this.gitEngine) {
        try {
          const worktreePath = await this.gitEngine.createWorktree(task.id, task.title)
          this.taskWorktrees.set(task.id, worktreePath)
        } catch (err: any) {
          console.warn(`Git worktree creation failed for task ${task.id}: ${err.message}`)
        }
      }

      // Set task to implementing
      updateTask(this.dbPath, task.id, {
        status: 'implementing' as TaskStatus,
        currentAgent: 'implement',
        startedAt: new Date().toISOString()
      })

      appendAgentLog(this.dbPath, task.id, {
        timestamp: new Date().toISOString(),
        agent: 'pipeline-engine',
        model: 'system',
        action: 'group-launch',
        details: `Task launched as part of group "${group.title}" (group #${groupId})`
      })

      // Build grouped prompt
      const prompt = constructGroupedPrompt(
        task,
        group.sharedContext,
        tasks,
        this.projectPath,
        this.dbPath
      )

      // Run the implement stage
      await this.runGroupedStage(task.id, 'implement', prompt)
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      this.emit('stage:error', { taskId: task.id, stage: 'implement', error: errorMessage })

      // Pause the entire group on any failure
      await this.pauseGroup(groupId, `Task #${task.id} failed: ${errorMessage}`)
    }
  })

  await Promise.allSettled(launchPromises)

  // Check if all tasks completed
  const updatedTasks = getTasksByGroup(this.dbPath, groupId)
  const allDone = updatedTasks.every(t => t.status === 'done')
  if (allDone) {
    updateTaskGroup(this.dbPath, groupId, { status: 'completed' })
    this.emit('group:completed', { groupId })
  }
}
```

**Step 3: Add runGroupedStage method**

This is a simplified version of runStage that uses the pre-built grouped prompt and follows GROUPED_STAGES:

```typescript
private async runGroupedStage(taskId: number, stage: PipelineStage, prompt: string): Promise<void> {
  const task = this.getTaskOrThrow(taskId)
  const stageConfig = getEffectiveStageConfig(stage, this.dbPath)

  this.emit('stage:start', { taskId, stage })

  appendAgentLog(this.dbPath, taskId, {
    timestamp: new Date().toISOString(),
    agent: stage,
    model: stageConfig.model,
    action: 'start',
    details: `Starting grouped stage: ${stage}`
  })

  try {
    const sessionKey = `${taskId}-${stage}`

    const sdkPromise = this.sdkRunner!({
      prompt,
      model: stageConfig.model,
      maxTurns: stageConfig.maxTurns,
      cwd: this.taskWorktrees.get(taskId) ?? this.projectPath,
      taskId,
      autoMode: true, // Grouped tasks run in auto mode
      sessionKey,
      stage,
      dbPath: this.dbPath,
      onStream: (content: string, type: string) => {
        if (type === 'context') {
          const parsed = JSON.parse(content)
          this.contextUsage.set(taskId, { tokens: parsed.contextTokens, max: parsed.contextMax })
          this.emit('context-update', { taskId, stage, ...parsed })
        } else {
          this.emit('stream', { taskId, stage, content, type })
        }
      },
      onApprovalRequest: (requestId: string, toolName: string, toolInput: Record<string, unknown>) => {
        this.emit('approval-request', { taskId, stage, requestId, toolName, toolInput })
      }
    })

    // Timeout enforcement
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined
    const timeoutPromise = new Promise<never>((_resolve, reject) => {
      timeoutHandle = setTimeout(() => {
        abortSession(sessionKey)
        reject(new Error(`Stage '${stage}' timed out after ${stageConfig.timeoutMs}ms`))
      }, stageConfig.timeoutMs)
    })

    let result: SdkResult
    try {
      result = await Promise.race([sdkPromise, timeoutPromise])
    } finally {
      clearTimeout(timeoutHandle)
    }

    // Store session
    if (result.sessionId) {
      this.sessionIds.set(taskId, result.sessionId)
      updateTask(this.dbPath, taskId, { activeSessionId: result.sessionId })
    }

    // Track context usage
    if (result.contextTokens !== undefined) {
      this.contextUsage.set(taskId, {
        tokens: result.contextTokens,
        max: result.contextMax || 200_000,
      })
    }

    // Parse handoff
    const handoff = parseHandoff(result.output)
    const handoffRecord: Handoff = {
      stage,
      agent: stage,
      model: stageConfig.model,
      timestamp: new Date().toISOString(),
      status: handoff?.status ?? 'completed',
      summary: handoff?.summary ?? '',
      keyDecisions: handoff?.keyDecisions ?? '',
      openQuestions: handoff?.openQuestions ?? '',
      filesModified: handoff?.filesModified ?? '',
      nextStageNeeds: handoff?.nextStageNeeds ?? '',
      warnings: handoff?.warnings ?? ''
    }

    appendHandoff(this.dbPath, taskId, handoffRecord)
    await this.storeStageOutput(taskId, stage, result)

    this.emit('stage:complete', { taskId, stage })

    // Forward event to workshop
    this.emit('group:task-stage-complete', {
      taskId,
      stage,
      groupId: task.groupId,
      summary: handoffRecord.summary
    })

    // Auto-advance through grouped stages
    const stageIndex = GROUPED_STAGES.indexOf(stage)
    if (stageIndex < GROUPED_STAGES.length - 1) {
      const nextStage = GROUPED_STAGES[stageIndex + 1]
      const nextStatus = STAGE_TO_STATUS[nextStage] as TaskStatus

      if (nextStage === 'done') {
        await this.extractArtifacts(taskId)
        updateTask(this.dbPath, taskId, {
          status: 'done' as TaskStatus,
          currentAgent: 'done',
          completedAt: new Date().toISOString()
        })
        return
      }

      updateTask(this.dbPath, taskId, {
        status: nextStatus,
        currentAgent: nextStage
      })

      // Build standard prompt for post-implement stages (code_review, verify)
      const nextPrompt = constructPrompt(nextStage, this.getTaskOrThrow(taskId), this.projectPath, undefined, this.dbPath)
      await this.runGroupedStage(taskId, nextStage, nextPrompt)
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    appendAgentLog(this.dbPath, taskId, {
      timestamp: new Date().toISOString(),
      agent: stage,
      model: stageConfig.model,
      action: 'error',
      details: errorMessage
    })

    const currentTask = getTask(this.dbPath, taskId)
    if (currentTask && currentTask.status !== 'paused') {
      updateTask(this.dbPath, taskId, { status: 'blocked' as TaskStatus })
    }

    throw error // Propagate to launchGroup for group-level handling
  }
}
```

**Step 4: Add pauseGroup method**

```typescript
async pauseGroup(groupId: number, reason?: string): Promise<number> {
  const group = getTaskGroup(this.dbPath, groupId)
  if (!group) throw new Error(`Group ${groupId} not found`)

  const tasks = getTasksByGroup(this.dbPath, groupId)
  const activeStatuses = ['brainstorming', 'design_review', 'planning', 'implementing', 'code_review', 'verifying']
  let pausedCount = 0

  for (const task of tasks) {
    if (activeStatuses.includes(task.status)) {
      try {
        await this.pauseTask(task.id, 'manual')
        pausedCount++
      } catch (err) {
        // Task may have already finished or been paused
        console.warn(`Could not pause task ${task.id}: ${(err as Error).message}`)
      }
    }
  }

  updateTaskGroup(this.dbPath, groupId, { status: 'paused' })
  this.emit('group:paused', { groupId, pausedCount, reason })
  return pausedCount
}
```

**Step 5: Add resumeGroup method**

```typescript
async resumeGroup(groupId: number): Promise<number> {
  const group = getTaskGroup(this.dbPath, groupId)
  if (!group) throw new Error(`Group ${groupId} not found`)
  if (group.status !== 'paused') throw new Error(`Group ${groupId} is not paused (status: ${group.status})`)

  const tasks = getTasksByGroup(this.dbPath, groupId)
  let resumedCount = 0

  updateTaskGroup(this.dbPath, groupId, { status: 'running' })

  for (const task of tasks) {
    if (task.status === 'paused') {
      try {
        await this.resumeTask(task.id)
        resumedCount++
      } catch (err) {
        console.warn(`Could not resume task ${task.id}: ${(err as Error).message}`)
      }
    }
  }

  this.emit('group:resumed', { groupId, resumedCount })
  return resumedCount
}
```

**Step 6: Add getGroupStatus method**

```typescript
getGroupStatus(groupId: number): { group: TaskGroup; tasks: Array<{ id: number; title: string; status: TaskStatus; stage: string | null }> } {
  const group = getTaskGroup(this.dbPath, groupId)
  if (!group) throw new Error(`Group ${groupId} not found`)

  const tasks = getTasksByGroup(this.dbPath, groupId)
  return {
    group,
    tasks: tasks.map(t => ({
      id: t.id,
      title: t.title,
      status: t.status,
      stage: t.currentAgent
    }))
  }
}
```

**Step 7: Commit**

```
git add src/main/pipeline-engine.ts
git commit -m "feat: add group operations to pipeline engine (launch, pause, resume, status)"
```

---

## Task 7: Add Workshop Orchestration Tools

**Files:**
- Modify: `src/main/workshop-engine.ts`

**Step 1: Add imports**

Add to the imports:

```typescript
import { createTaskGroup, getTaskGroup, updateTaskGroup, getTasksByGroup, listTaskGroups } from './db'
import type { TaskGroup, WorkOrder, CreateTaskGroupInput } from '../shared/types'
```

**Step 2: Add group tracking state**

Add to the WorkshopEngine class properties (after `tokenUsage`):

```typescript
  private activeGroupId: number | null = null
  private pipelineEngine: PipelineEngine | null = null
```

Add setter:

```typescript
  setPipelineEngine(engine: PipelineEngine): void {
    this.pipelineEngine = engine

    // Wire up pipeline events to workshop
    engine.on('group:task-stage-complete', (data) => {
      if (data.groupId === this.activeGroupId) {
        this.emit('stream', {
          sessionId: this.getSessionForGroup(data.groupId),
          content: `\n\n**[Task #${data.taskId}]** completed stage \`${data.stage}\`: ${data.summary}\n\n`,
          type: 'text'
        })
      }
    })

    engine.on('group:paused', (data) => {
      if (data.groupId === this.activeGroupId) {
        this.emit('stream', {
          sessionId: this.getSessionForGroup(data.groupId),
          content: `\n\n**[Group Paused]** ${data.reason ?? 'A task encountered an issue.'} (${data.pausedCount} tasks paused)\n\n`,
          type: 'text'
        })
      }
    })

    engine.on('group:completed', (data) => {
      if (data.groupId === this.activeGroupId) {
        this.emit('stream', {
          sessionId: this.getSessionForGroup(data.groupId),
          content: `\n\n**[Group Complete]** All tasks in the group have finished successfully.\n\n`,
          type: 'text'
        })
      }
    })
  }

  private getSessionForGroup(groupId: number): string | null {
    const group = getTaskGroup(this.dbPath, groupId)
    return group ? String(group.sessionId) : null
  }
```

**Step 3: Add orchestration tool handlers**

In the `handleToolCalls` method's switch statement (around line ~622), add new cases:

```typescript
      case 'launch_group': {
        await this.handleLaunchGroup(sessionId, toolInput)
        break
      }
      case 'get_group_status': {
        await this.handleGetGroupStatus(sessionId, toolInput)
        break
      }
      case 'peek_agent': {
        this.emit('stream', { sessionId, content: `[Peeking at task ${toolInput.taskId}...]`, type: 'tool_call' })
        break
      }
      case 'message_agent': {
        await this.handleMessageAgent(sessionId, toolInput)
        break
      }
      case 'pause_group': {
        await this.handlePauseGroup(sessionId)
        break
      }
      case 'resume_group': {
        await this.handleResumeGroup(sessionId)
        break
      }
      case 'update_work_order': {
        await this.handleUpdateWorkOrder(sessionId, toolInput)
        break
      }
      case 'create_task_group': {
        await this.handleCreateTaskGroup(sessionId, toolInput)
        break
      }
```

**Step 4: Implement the handler methods**

```typescript
  private async handleCreateTaskGroup(sessionId: string, input: any): Promise<void> {
    const group = createTaskGroup(this.dbPath, {
      title: input.title,
      sessionId: parseInt(sessionId),
      designArtifactId: input.designArtifactId,
      sharedContext: input.sharedContext ?? ''
    })
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

    // Set group to queued first
    updateTaskGroup(this.dbPath, groupId, { status: 'queued' })

    this.emit('stream', { sessionId, content: `[Launching group #${groupId}...]`, type: 'tool_call' })

    // Launch asynchronously -- don't block the workshop session
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

    this.emit('stream', {
      sessionId,
      content: `[Group #${groupId} Status: ${status.group.status}]\n${summary}`,
      type: 'tool_call'
    })
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

  private async handleMessageAgent(sessionId: string, input: any): Promise<void> {
    this.emit('group:message-agent', {
      groupId: this.activeGroupId,
      taskId: input.taskId,
      content: input.content
    })
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
```

**Step 5: Update suggestTasks to support grouped task creation**

Modify the existing `suggestTasks` method to optionally create a task group when `groupTitle` is provided and there are multiple tasks:

```typescript
async suggestTasks(sessionId: string, tasks: WorkshopSuggestedTask[], groupTitle?: string): Promise<void> {
  if (this.autoMode) {
    // Create group if title provided
    let groupId: number | undefined
    if (groupTitle && tasks.length > 1) {
      const group = createTaskGroup(this.dbPath, {
        title: groupTitle,
        sessionId: parseInt(sessionId),
        sharedContext: ''
      })
      groupId = group.id
      this.activeGroupId = group.id
      this.emit('group:created', { sessionId, group })
    }

    const createdTasks: { id: number; index: number }[] = []
    for (let i = 0; i < tasks.length; i++) {
      const created = await this.createPipelineTask(sessionId, tasks[i], groupId)
      createdTasks.push({ id: created.id, index: i })
    }

    // Wire up dependencies
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
    this.emit('tasks:suggested', { sessionId, tasks, groupTitle })
  }
}
```

**Step 6: Update createPipelineTask to accept groupId, workOrder, assignedSkill**

Modify the `createPipelineTask` method to pass through group fields:

```typescript
private async createPipelineTask(sessionId: string, suggested: WorkshopSuggestedTask, groupId?: number): Promise<Task> {
  const task = createTask(this.dbPath, {
    title: suggested.title,
    description: suggested.description,
    tier: suggested.tier ?? 'L2',
    priority: suggested.priority ?? 'medium',
    groupId: groupId ?? undefined,
    workOrder: suggested.workOrder ?? undefined,
    assignedSkill: suggested.assignedSkill ?? undefined
  })

  // Link task to workshop session
  linkTaskToSession(this.dbPath, task.id, parseInt(sessionId))

  this.emit('task:created', { sessionId, task })
  return task
}
```

**Step 7: Commit**

```
git add src/main/workshop-engine.ts
git commit -m "feat: add orchestration tools and group management to workshop engine"
```

---

## Task 8: Add IPC Handlers for Group Operations

**Files:**
- Modify: `src/main/index.ts`

**Step 1: Connect workshop engine to pipeline engine**

In the `pipeline:init` handler, after creating the pipeline engine and workshop engine, connect them:

```typescript
    // After currentEngine is created and workshop engine exists
    if (currentWorkshopEngine) {
      currentWorkshopEngine.setPipelineEngine(currentEngine)
    }
```

**Step 2: Add group IPC handlers**

In `registerPipelineIpc()`, add:

```typescript
  ipcMain.handle('pipeline:launchGroup', async (_e, groupId: number) => {
    if (!currentEngine) throw new Error('Pipeline not initialized')
    await currentEngine.launchGroup(groupId)
  })

  ipcMain.handle('pipeline:pauseGroup', async (_e, groupId: number) => {
    if (!currentEngine) throw new Error('Pipeline not initialized')
    return currentEngine.pauseGroup(groupId)
  })

  ipcMain.handle('pipeline:resumeGroup', async (_e, groupId: number) => {
    if (!currentEngine) throw new Error('Pipeline not initialized')
    return currentEngine.resumeGroup(groupId)
  })

  ipcMain.handle('pipeline:getGroupStatus', (_e, groupId: number) => {
    if (!currentEngine) throw new Error('Pipeline not initialized')
    return currentEngine.getGroupStatus(groupId)
  })
```

**Step 3: Bridge group events to renderer**

In the `pipeline:init` handler, add event forwarding for group events:

```typescript
    currentEngine.on('group:launched', (data) => mainWindow?.webContents.send('pipeline:status', { type: 'group-launched', ...data }))
    currentEngine.on('group:paused', (data) => mainWindow?.webContents.send('pipeline:status', { type: 'group-paused', ...data }))
    currentEngine.on('group:resumed', (data) => mainWindow?.webContents.send('pipeline:status', { type: 'group-resumed', ...data }))
    currentEngine.on('group:completed', (data) => mainWindow?.webContents.send('pipeline:status', { type: 'group-completed', ...data }))
    currentEngine.on('group:task-stage-complete', (data) => mainWindow?.webContents.send('pipeline:status', { type: 'group-task-stage-complete', ...data }))
```

**Step 4: Commit**

```
git add src/main/index.ts
git commit -m "feat: add IPC handlers for group operations and event bridging"
```

---

## Task 9: Add Preload API for Group Operations

**Files:**
- Modify: `src/preload/index.ts` (or wherever the preload API is defined)

**Step 1: Add group methods to the exposed API**

Add to the pipeline section of the preload bridge:

```typescript
    launchGroup: (groupId: number) => ipcRenderer.invoke('pipeline:launchGroup', groupId),
    pauseGroup: (groupId: number) => ipcRenderer.invoke('pipeline:pauseGroup', groupId),
    resumeGroup: (groupId: number) => ipcRenderer.invoke('pipeline:resumeGroup', groupId),
    getGroupStatus: (groupId: number) => ipcRenderer.invoke('pipeline:getGroupStatus', groupId),
```

**Step 2: Commit**

```
git add src/preload/index.ts
git commit -m "feat: expose group operations in preload API"
```

---

## Task 10: Update Workshop Agent System Prompt

**Files:**
- Modify: `src/templates/workshop-agent.md`

**Step 1: Add orchestration instructions to the workshop agent template**

Add a section that teaches the workshop agent about the ClawFlow environment and its orchestration capabilities:

```markdown
## Orchestration Tools

When you have designed a feature and broken it into tasks, you can create a task group and launch parallel sub-agents.

### Creating a Group

**create_task_group** -- Create a task group to coordinate related tasks.
<tool_call name="create_task_group">
{"title": "Feature name", "sharedContext": "The shared design and plan context all agents receive"}
</tool_call>

### Suggesting Grouped Tasks

When using suggest_tasks, include work orders and skill assignments:
<tool_call name="suggest_tasks">
{"groupTitle": "Feature name", "tasks": [
  {
    "title": "Task title",
    "description": "Detailed description",
    "tier": "L2",
    "priority": "medium",
    "workOrder": {
      "objective": "What this task accomplishes",
      "files": [{"path": "src/file.ts", "action": "modify", "description": "What to do"}],
      "patterns": ["Convention to follow"],
      "integration": ["How it connects to siblings"],
      "constraints": ["What to avoid"],
      "tests": ["Expected test coverage"]
    },
    "assignedSkill": "test-driven-development"
  }
]}
</tool_call>

### Launching and Monitoring

**launch_group** -- Start parallel implementation.
<tool_call name="launch_group">
{"groupId": 1}
</tool_call>

**get_group_status** -- Check progress.
<tool_call name="get_group_status">
{"groupId": 1}
</tool_call>

**pause_group** / **resume_group** -- Control execution.

**message_agent** -- Send instructions to a specific sub-agent.
<tool_call name="message_agent">
{"taskId": 5, "content": "Create the validator module yourself, don't wait for Task 3."}
</tool_call>

**update_work_order** -- Modify a task's instructions mid-flight.
<tool_call name="update_work_order">
{"taskId": 5, "changes": {"constraints": ["Create validators.ts yourself"]}}
</tool_call>

### Workflow

1. **Think Phase**: Brainstorm, design, create artifacts
2. **Plan Phase**: Break into tasks with work orders using suggest_tasks
3. **Ask User**: "Launch now or queue for later?"
4. **Execute Phase**: Launch group, monitor progress, handle escalations
5. **Complete Phase**: Summarize results when all tasks finish

### Progress Updates

Provide regular light updates when sub-agents complete stages. Escalate immediately on failures or questions from agents.
```

**Step 2: Commit**

```
git add src/templates/workshop-agent.md
git commit -m "feat: add orchestration instructions to workshop agent template"
```

---

## Task 11: Update startTask to Handle Grouped Tasks

**Files:**
- Modify: `src/main/pipeline-engine.ts`

**Step 1: Modify startTask to respect grouped task stage sequence**

In the `startTask` method, update the first stage determination to check for grouped tasks:

```typescript
  // Determine first stage based on whether task is grouped
  const isGrouped = task.groupId !== null
  const firstStage = isGrouped ? 'implement' : getFirstStage(task.tier)
```

This replaces the existing `const firstStage = getFirstStage(task.tier)` line. The rest of the method stays the same.

**Step 2: Commit**

```
git add src/main/pipeline-engine.ts
git commit -m "feat: update startTask to skip thinking stages for grouped tasks"
```

---

## Task 12: Integration Test -- Full Group Lifecycle

**Files:**
- Create: `src/main/__tests__/group-lifecycle.test.ts`

**Step 1: Write integration test for group creation and task linking**

```typescript
import { initProjectDb, createTask, createTaskGroup, getTaskGroup, getTasksByGroup, updateTaskGroup, deleteTaskGroup } from '../db'
import { tmpdir } from 'os'
import { join } from 'path'
import { mkdtempSync } from 'fs'

describe('Task Group Lifecycle', () => {
  let dbPath: string

  beforeEach(() => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'clawflow-test-'))
    dbPath = join(tmpDir, 'test.db')
    initProjectDb(dbPath)
  })

  test('creates a group and links tasks', () => {
    const group = createTaskGroup(dbPath, {
      title: 'Test Feature',
      sessionId: 1,
      sharedContext: 'Build a test feature with two components'
    })

    expect(group.id).toBeDefined()
    expect(group.status).toBe('planning')
    expect(group.title).toBe('Test Feature')

    const task1 = createTask(dbPath, {
      title: 'Task A',
      description: 'First part',
      tier: 'L2',
      priority: 'medium',
      groupId: group.id,
      workOrder: {
        objective: 'Build component A',
        files: [{ path: 'src/a.ts', action: 'create', description: 'Create A' }],
        patterns: [],
        integration: ['Task B imports from this'],
        constraints: [],
        tests: ['Unit test for A']
      },
      assignedSkill: 'test-driven-development'
    })

    const task2 = createTask(dbPath, {
      title: 'Task B',
      description: 'Second part',
      tier: 'L2',
      priority: 'medium',
      groupId: group.id
    })

    expect(task1.groupId).toBe(group.id)
    expect(task1.workOrder?.objective).toBe('Build component A')
    expect(task1.assignedSkill).toBe('test-driven-development')

    const groupTasks = getTasksByGroup(dbPath, group.id)
    expect(groupTasks).toHaveLength(2)
  })

  test('group status lifecycle', () => {
    const group = createTaskGroup(dbPath, {
      title: 'Lifecycle Test',
      sessionId: 1,
      sharedContext: ''
    })

    expect(group.status).toBe('planning')

    updateTaskGroup(dbPath, group.id, { status: 'queued' })
    expect(getTaskGroup(dbPath, group.id)!.status).toBe('queued')

    updateTaskGroup(dbPath, group.id, { status: 'running' })
    expect(getTaskGroup(dbPath, group.id)!.status).toBe('running')

    updateTaskGroup(dbPath, group.id, { status: 'paused' })
    expect(getTaskGroup(dbPath, group.id)!.status).toBe('paused')

    updateTaskGroup(dbPath, group.id, { status: 'completed' })
    expect(getTaskGroup(dbPath, group.id)!.status).toBe('completed')
  })

  test('deleting group unlinks tasks', () => {
    const group = createTaskGroup(dbPath, {
      title: 'Delete Test',
      sessionId: 1,
      sharedContext: ''
    })

    createTask(dbPath, {
      title: 'Linked Task',
      description: 'Should be unlinked',
      tier: 'L2',
      priority: 'medium',
      groupId: group.id
    })

    deleteTaskGroup(dbPath, group.id)

    expect(getTaskGroup(dbPath, group.id)).toBeNull()
    // Task should still exist but with no group
    const tasks = getTasksByGroup(dbPath, group.id)
    expect(tasks).toHaveLength(0)
  })
})
```

**Step 2: Run tests**

```
npx vitest run src/main/__tests__/group-lifecycle.test.ts
```

Expected: All tests pass.

**Step 3: Commit**

```
git add src/main/__tests__/group-lifecycle.test.ts
git commit -m "test: add integration tests for task group lifecycle"
```

---

## Task 13: Build and Verify

**Step 1: Run full build**

```
npm run build
```

Expected: No TypeScript errors.

**Step 2: Run all existing tests**

```
npm test
```

Expected: All existing tests still pass, no regressions.

**Step 3: Clear any stale caches**

```
rm -rf dist/ node_modules/.cache/
npm run build
```

**Step 4: Commit any remaining fixes**

```
git add -A
git commit -m "fix: resolve any build issues from workshop orchestrator feature"
```

---

## Execution Order and Dependencies

```
Task 1  (types)           --+
                             +---> Task 2 (db schema) ---> Task 6 (pipeline engine) ---> Task 8 (IPC) ---> Task 9 (preload)
Task 3  (constants)       --+                                                                                |
Task 4  (template file)   --+---> Task 5 (template engine) -----------------------------------------------+  |
                             |                                                                             v  |
                             +---> Task 7 (workshop engine) -------------------------------------------> Task 10 (workshop prompt)
                                                                                                           |
Task 11 (startTask update) <-------------------------------------------------------------------------------+
                                                                                                           |
Task 12 (integration tests) <------------------------------------------------------------------------------+
                                                                                                           |
Task 13 (build and verify) <-------------------------------------------------------------------------------+
```

**Parallelizable groups:**
- Tasks 1, 3, 4 can run in parallel (no dependencies between them)
- Tasks 2, 5 can run in parallel (after their deps complete)
- Tasks 6, 7 can run in parallel (after their deps complete)
- Tasks 8, 9, 10 sequential
- Tasks 11, 12, 13 sequential at the end
