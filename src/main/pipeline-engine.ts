import { EventEmitter } from 'events'
import fs from 'fs'
import path from 'path'
import type { PipelineStage, Task, TaskStatus, Handoff, StageConfig, TaskArtifacts } from '../shared/types'
import { STAGE_CONFIGS, TIER_STAGES, STAGE_TO_STATUS } from '../shared/constants'
import { getNextStage, getFirstStage, canTransition, isCircuitBreakerTripped } from '../shared/pipeline-rules'
import { getTask, updateTask, appendAgentLog, appendHandoff, getGlobalSetting, getProjectSetting, areDependenciesMet, getTaskDependencies, getTaskDependents, setTaskArtifacts, listTasks } from './db'
import { SETTING_KEYS } from '../shared/settings'
import { constructPrompt, constructContinuationPrompt, parseHandoff } from './template-engine'
import { checkContextBudget } from './context-budget'
import { GitEngine } from './git-engine'
import { abortSession } from './sdk-manager'

// --- Exported SDK Types ---

export interface SdkRunnerParams {
  prompt: string
  model: string
  maxTurns: number
  cwd: string
  taskId: number
  autoMode: boolean
  resumeSessionId?: string
  sessionKey?: string
  stage?: string
  dbPath?: string
  onStream: (content: string, type: string) => void
  onApprovalRequest: (requestId: string, toolName: string, toolInput: Record<string, unknown>) => void
}

export interface SdkResult {
  output: string
  cost: number
  turns: number
  sessionId: string
  contextTokens: number
  contextMax: number
}

export type SdkRunner = (params: SdkRunnerParams) => Promise<SdkResult>

// --- Settings-Aware Stage Config ---

function getEffectiveStageConfig(stage: PipelineStage, dbPath: string): StageConfig {
  const base = STAGE_CONFIGS[stage]

  const projectModel = getProjectSetting(dbPath, SETTING_KEYS.STAGE_MODEL_PREFIX + stage)
  const globalModel = getGlobalSetting(SETTING_KEYS.STAGE_MODEL_PREFIX + stage)
  const globalDefault = getGlobalSetting(SETTING_KEYS.GLOBAL_MODEL)

  const projectTurns = getProjectSetting(dbPath, SETTING_KEYS.STAGE_MAX_TURNS_PREFIX + stage)
  const globalTurns = getGlobalSetting(SETTING_KEYS.STAGE_MAX_TURNS_PREFIX + stage)

  const projectTimeout = getProjectSetting(dbPath, SETTING_KEYS.STAGE_TIMEOUT_PREFIX + stage)
  const globalTimeout = getGlobalSetting(SETTING_KEYS.STAGE_TIMEOUT_PREFIX + stage)

  const projectAutoApprove = getProjectSetting(dbPath, SETTING_KEYS.STAGE_AUTO_APPROVE_PREFIX + stage)
  const globalAutoApprove = getGlobalSetting(SETTING_KEYS.STAGE_AUTO_APPROVE_PREFIX + stage)

  return {
    ...base,
    model: projectModel ?? globalModel ?? globalDefault ?? base.model,
    maxTurns: Number(projectTurns ?? globalTurns ?? base.maxTurns),
    timeoutMs: Number(projectTimeout ?? globalTimeout ?? base.timeoutMs),
    autoApproveThreshold: projectAutoApprove != null
      ? (projectAutoApprove === 'null' ? null : Number(projectAutoApprove))
      : globalAutoApprove != null
        ? (globalAutoApprove === 'null' ? null : Number(globalAutoApprove))
        : base.autoApproveThreshold,
  }
}

// --- Pipeline Engine ---

export class PipelineEngine extends EventEmitter {
  private dbPath: string
  private projectPath: string
  private sdkRunner: SdkRunner | null = null
  private gitEngine: GitEngine | null = null
  private taskWorktrees = new Map<number, string>() // taskId -> worktree cwd
  // Track active session IDs per task for resume support
  private sessionIds = new Map<number, string>()
  // Track context window usage per task for budget decisions
  private contextUsage = new Map<number, { tokens: number; max: number }>()

  constructor(dbPath: string, projectPath: string) {
    super()
    this.dbPath = dbPath
    this.projectPath = projectPath
  }

  setSdkRunner(runner: SdkRunner): void {
    this.sdkRunner = runner
  }

  setGitEngine(engine: GitEngine): void {
    this.gitEngine = engine
  }

  /**
   * Move a task from backlog to its first pipeline stage and run it.
   */
  async startTask(taskId: number): Promise<Task> {
    const task = this.getTaskOrThrow(taskId)

    if (task.status !== 'backlog') {
      throw new Error(`Task ${taskId} is not in backlog (current status: ${task.status})`)
    }

    // Check dependencies are met before starting
    if (!areDependenciesMet(this.dbPath, taskId)) {
      const depIds = getTaskDependencies(this.dbPath, taskId)
      const allTasks = listTasks(this.dbPath)
      const blockers = depIds
        .map(id => allTasks.find(t => t.id === id))
        .filter(t => t && t.status !== 'done')
        .map(t => t!.title)
      throw new Error(`Task blocked by incomplete dependencies: ${blockers.join(', ')}`)
    }

    const firstStage = getFirstStage(task.tier)
    const status = STAGE_TO_STATUS[firstStage] as TaskStatus

    const updated = updateTask(this.dbPath, taskId, {
      status,
      startedAt: new Date().toISOString(),
      currentAgent: firstStage
    })!

    appendAgentLog(this.dbPath, taskId, {
      timestamp: new Date().toISOString(),
      agent: 'pipeline-engine',
      model: 'system',
      action: 'start',
      details: `Task started. Moving to stage: ${firstStage}`
    })

    // Create git worktree for task isolation
    if (this.gitEngine) {
      try {
        const worktreePath = await this.gitEngine.createWorktree(taskId, task.title)
        this.taskWorktrees.set(taskId, worktreePath)
      } catch (err: any) {
        // Git not available or not a repo — continue without isolation
        console.warn(`Git worktree creation failed for task ${taskId}: ${err.message}`)
      }
    }

    await this.runStage(taskId, firstStage)
    return this.getTaskOrThrow(taskId)
  }

  /**
   * Run the current stage for a task (re-run or resume).
   */
  async stepTask(taskId: number): Promise<Task> {
    const task = this.getTaskOrThrow(taskId)

    if (task.status === 'backlog' || task.status === 'done') {
      throw new Error(`Task ${taskId} cannot be stepped (status: ${task.status})`)
    }

    const currentStage = task.currentAgent as PipelineStage
    if (!currentStage) {
      throw new Error(`Task ${taskId} has no current stage`)
    }

    // If task is blocked due to an error, restore it to the appropriate status for retry
    if (task.status === 'blocked') {
      const retryStatus = STAGE_TO_STATUS[currentStage] as TaskStatus
      updateTask(this.dbPath, taskId, { status: retryStatus })

      appendAgentLog(this.dbPath, taskId, {
        timestamp: new Date().toISOString(),
        agent: 'pipeline-engine',
        model: 'system',
        action: 'retry',
        details: `Retrying blocked stage: ${currentStage}`
      })
    }

    await this.runStage(taskId, currentStage)
    return this.getTaskOrThrow(taskId)
  }

  /**
   * Run all remaining stages in sequence.
   * Pauses at gate stages unless task is in autoMode.
   */
  async runFullPipeline(taskId: number): Promise<Task> {
    let task = this.getTaskOrThrow(taskId)

    // If in backlog, start it first
    if (task.status === 'backlog') {
      task = await this.startTask(taskId)
    } else {
      // Run the current stage
      await this.runStage(taskId, task.currentAgent as PipelineStage)
      task = this.getTaskOrThrow(taskId)
    }

    // Keep advancing through stages
    while (task.status !== 'done' && task.status !== 'blocked') {
      const currentStage = task.currentAgent as PipelineStage
      if (!currentStage || currentStage === 'done') break

      const stageConfig = getEffectiveStageConfig(currentStage, this.dbPath)

      // If stage pauses and task is not in autoMode, stop here
      if (stageConfig.pauses && !task.autoMode) {
        break
      }

      const nextStage = getNextStage(task.tier, currentStage)
      if (!nextStage) break

      // Advance to next stage
      const transition = canTransition(task, nextStage)
      if (!transition.allowed) {
        updateTask(this.dbPath, taskId, { status: 'blocked' as TaskStatus })
        this.emit('circuit-breaker', { taskId, reason: transition.reason })
        break
      }

      const nextStatus = STAGE_TO_STATUS[nextStage] as TaskStatus
      updateTask(this.dbPath, taskId, {
        status: nextStatus,
        currentAgent: nextStage
      })

      await this.runStage(taskId, nextStage)
      task = this.getTaskOrThrow(taskId)
    }

    return this.getTaskOrThrow(taskId)
  }

  /**
   * Approve the current stage and advance to the next one.
   */
  async approveStage(taskId: number): Promise<Task> {
    const task = this.getTaskOrThrow(taskId)
    const currentStage = task.currentAgent as PipelineStage

    if (!currentStage) {
      throw new Error(`Task ${taskId} has no current stage to approve`)
    }

    appendAgentLog(this.dbPath, taskId, {
      timestamp: new Date().toISOString(),
      agent: 'pipeline-engine',
      model: 'system',
      action: 'approve',
      details: `Stage ${currentStage} approved by user`
    })

    const nextStage = getNextStage(task.tier, currentStage)

    if (!nextStage) {
      // Pipeline complete — extract artifacts before marking done
      await this.extractArtifacts(taskId)
      updateTask(this.dbPath, taskId, {
        status: 'done' as TaskStatus,
        currentAgent: 'done',
        completedAt: new Date().toISOString()
      })
      return this.getTaskOrThrow(taskId)
    }

    const transition = canTransition(task, nextStage)
    if (!transition.allowed) {
      updateTask(this.dbPath, taskId, { status: 'blocked' as TaskStatus })
      this.emit('circuit-breaker', { taskId, reason: transition.reason })
      return this.getTaskOrThrow(taskId)
    }

    const nextStatus = STAGE_TO_STATUS[nextStage] as TaskStatus
    updateTask(this.dbPath, taskId, {
      status: nextStatus,
      currentAgent: nextStage
    })

    await this.runStage(taskId, nextStage)
    return this.getTaskOrThrow(taskId)
  }

  /**
   * Reject the current stage, increment rejection counter, and re-run with feedback.
   */
  async rejectStage(taskId: number, feedback: string): Promise<Task> {
    const task = this.getTaskOrThrow(taskId)
    const currentStage = task.currentAgent as PipelineStage

    if (!currentStage) {
      throw new Error(`Task ${taskId} has no current stage to reject`)
    }

    // Increment the appropriate rejection counter
    const updates: Record<string, any> = {}
    if (currentStage === 'plan' || currentStage === 'brainstorm' || currentStage === 'design_review') {
      updates.planReviewCount = task.planReviewCount + 1
    } else if (currentStage === 'implement' || currentStage === 'code_review' || currentStage === 'verify') {
      updates.implReviewCount = task.implReviewCount + 1
    }

    updateTask(this.dbPath, taskId, updates)

    appendAgentLog(this.dbPath, taskId, {
      timestamp: new Date().toISOString(),
      agent: 'pipeline-engine',
      model: 'system',
      action: 'reject',
      details: `Stage ${currentStage} rejected. Feedback: ${feedback}`
    })

    // Re-fetch task to check circuit breaker with updated counts
    const updatedTask = this.getTaskOrThrow(taskId)

    if (isCircuitBreakerTripped(updatedTask)) {
      updateTask(this.dbPath, taskId, { status: 'blocked' as TaskStatus })
      this.emit('circuit-breaker', {
        taskId,
        reason: `Circuit breaker tripped after repeated rejections at stage ${currentStage}`
      })
      return this.getTaskOrThrow(taskId)
    }

    // Clear session state — rejection means we start fresh
    updateTask(this.dbPath, taskId, { activeSessionId: null })
    this.sessionIds.delete(taskId)
    this.contextUsage.delete(taskId)

    // Re-run the stage with feedback
    await this.runStage(taskId, currentStage, feedback)
    return this.getTaskOrThrow(taskId)
  }

  /**
   * Resume the current stage's session with the user's answer to open questions.
   * Uses SDK session resume to continue where the agent left off.
   */
  async respondToQuestions(taskId: number, response: string): Promise<Task> {
    const task = this.getTaskOrThrow(taskId)
    const currentStage = task.currentAgent as PipelineStage

    if (!currentStage) {
      throw new Error(`Task ${taskId} has no current stage`)
    }

    const sessionId = this.sessionIds.get(taskId)

    appendAgentLog(this.dbPath, taskId, {
      timestamp: new Date().toISOString(),
      agent: 'pipeline-engine',
      model: 'system',
      action: 'respond',
      details: `User response to questions at stage ${currentStage}`
    })

    if (sessionId) {
      // Resume the existing session with the user's answer
      await this.runStage(taskId, currentStage, undefined, sessionId, response)
    } else {
      // No session to resume — re-run stage with the answer as feedback
      await this.runStage(taskId, currentStage, response)
    }

    return this.getTaskOrThrow(taskId)
  }

  /**
   * Pause a running task — aborts the SDK session and saves state for resume.
   */
  async pauseTask(taskId: number, reason: 'manual' | 'usage_limit' = 'manual'): Promise<Task> {
    const task = this.getTaskOrThrow(taskId)

    const activeStatuses = ['brainstorming', 'design_review', 'planning', 'implementing', 'code_review', 'verifying']
    if (!activeStatuses.includes(task.status)) {
      throw new Error(`Task ${taskId} cannot be paused (status: ${task.status})`)
    }

    const sessionKey = `${taskId}-${task.currentAgent}`
    abortSession(sessionKey)

    appendAgentLog(this.dbPath, taskId, {
      timestamp: new Date().toISOString(),
      agent: 'pipeline-engine',
      model: 'system',
      action: 'pause',
      details: `Task paused (${reason}). Was in status: ${task.status}, stage: ${task.currentAgent}`
    })

    updateTask(this.dbPath, taskId, {
      pausedFromStatus: task.status,
      pauseReason: reason,
      status: 'paused' as TaskStatus
    })

    this.emit('stage:paused', { taskId, reason })
    return this.getTaskOrThrow(taskId)
  }

  /**
   * Resume a paused task — restores status and re-runs the stage with session resume.
   */
  async resumeTask(taskId: number): Promise<Task> {
    const task = this.getTaskOrThrow(taskId)

    if (task.status !== 'paused') {
      throw new Error(`Task ${taskId} is not paused (status: ${task.status})`)
    }

    const resumeStatus = task.pausedFromStatus ?? 'implementing'
    const currentStage = task.currentAgent as PipelineStage

    appendAgentLog(this.dbPath, taskId, {
      timestamp: new Date().toISOString(),
      agent: 'pipeline-engine',
      model: 'system',
      action: 'resume',
      details: `Task resumed. Restoring status: ${resumeStatus}, stage: ${currentStage}`
    })

    updateTask(this.dbPath, taskId, {
      status: resumeStatus as TaskStatus,
      pausedFromStatus: null,
      pauseReason: null
    })

    const sessionId = this.sessionIds.get(taskId)
    await this.runStage(taskId, currentStage, undefined, sessionId ?? undefined, 'Please continue where you left off.')
    return this.getTaskOrThrow(taskId)
  }

  /**
   * Pause all currently running tasks.
   */
  async pauseAllTasks(reason: 'manual' | 'usage_limit' = 'usage_limit'): Promise<number> {
    const { listTasks } = await import('./db')
    const tasks = listTasks(this.dbPath)
    const activeStatuses = ['brainstorming', 'design_review', 'planning', 'implementing', 'code_review', 'verifying']
    const running = tasks.filter(t => activeStatuses.includes(t.status))

    let pausedCount = 0
    for (const task of running) {
      try {
        await this.pauseTask(task.id, reason)
        pausedCount++
      } catch {
        // Task may have finished between list and pause
      }
    }
    return pausedCount
  }

  /**
   * Approve a context handoff: generate a rich handoff document from the current session,
   * clear the session, and restart the next stage fresh with the handoff context.
   */
  async approveContextHandoff(taskId: number): Promise<void> {
    if (!this.sdkRunner) {
      throw new Error('SDK runner not set. Call setSdkRunner() before running stages.')
    }

    const task = this.getTaskOrThrow(taskId)
    const currentStage = task.currentAgent as PipelineStage
    const nextStage = getNextStage(task.tier, currentStage)

    // Load the rich handoff template
    const richHandoffTemplatePath = path.join(__dirname, '../../src/templates/_rich-handoff.md')
    let richHandoffPrompt: string
    try {
      richHandoffPrompt = fs.readFileSync(richHandoffTemplatePath, 'utf-8')
    } catch {
      richHandoffPrompt = 'Produce a detailed handoff document covering: completed stages, codebase knowledge, and working state.'
    }

    // Fill in the next_stage placeholder
    richHandoffPrompt = richHandoffPrompt.replace('{{next_stage}}', nextStage || 'unknown')

    const sessionId = task.activeSessionId || this.sessionIds.get(taskId)
    const sessionKey = `${taskId}-handoff`

    // Send rich handoff request into the existing session
    const result = await this.sdkRunner({
      prompt: richHandoffPrompt,
      model: 'claude-sonnet-4-6',
      maxTurns: 5,
      cwd: this.taskWorktrees.get(taskId) ?? this.projectPath,
      taskId,
      autoMode: true,
      resumeSessionId: sessionId || undefined,
      sessionKey,
      stage: 'handoff',
      dbPath: this.dbPath,
      onStream: (content: string, type: string) => {
        this.emit('stream', { taskId, stage: 'handoff', content, type })
      },
      onApprovalRequest: () => {
        // No approvals during handoff generation
      }
    })

    appendAgentLog(this.dbPath, taskId, {
      timestamp: new Date().toISOString(),
      agent: 'pipeline-engine',
      model: 'claude-sonnet-4-6',
      action: 'context_handoff',
      details: `Rich handoff generated. Cost: ${result.cost}. Next stage: ${nextStage}`
    })

    // Store the rich handoff and clear the session for a fresh start
    updateTask(this.dbPath, taskId, {
      richHandoff: result.output,
      activeSessionId: null,
    })
    this.sessionIds.delete(taskId)
    this.contextUsage.delete(taskId)

    // Continue pipeline with next stage (fresh session with rich handoff context injected)
    if (nextStage) {
      const nextStatus = STAGE_TO_STATUS[nextStage] as TaskStatus
      // Extract artifacts before marking done
      if (nextStage === 'done') {
        await this.extractArtifacts(taskId)
      }
      updateTask(this.dbPath, taskId, {
        status: nextStatus,
        currentAgent: nextStage,
        ...(nextStage === 'done' ? { completedAt: new Date().toISOString() } : {})
      })
      await this.runStage(taskId, nextStage)
    }
  }

  // --- Private Methods ---

  /**
   * Construct prompt, call SDK runner, parse handoff, store output, handle errors.
   */
  private async runStage(taskId: number, stage: PipelineStage, feedback?: string, resumeSessionId?: string, userResponse?: string): Promise<void> {
    if (!this.sdkRunner) {
      throw new Error('SDK runner not set. Call setSdkRunner() before running stages.')
    }

    const task = this.getTaskOrThrow(taskId)
    const stageConfig = getEffectiveStageConfig(stage, this.dbPath)

    this.emit('stage:start', { taskId, stage })

    appendAgentLog(this.dbPath, taskId, {
      timestamp: new Date().toISOString(),
      agent: stage,
      model: stageConfig.model,
      action: resumeSessionId ? 'stage:resume' : 'stage:start',
      details: resumeSessionId
        ? `Resuming session with user response`
        : feedback ? `Running with feedback: ${feedback}` : `Running stage: ${stage}`
    })

    // Determine if this is a continuation of an existing session across stages
    const existingSessionId = task.activeSessionId || this.sessionIds.get(taskId)
    const isFirstStage = stage === getFirstStage(task.tier)
    const isContinuation = !!(existingSessionId && !isFirstStage && !resumeSessionId && !feedback)

    let prompt: string

    if (resumeSessionId && userResponse) {
      // Resuming an existing session — just send the user's answer
      prompt = userResponse
    } else if (isContinuation) {
      // Continuing the same SDK session into the next stage
      prompt = constructContinuationPrompt(stage, task, this.projectPath)

      if (task.autoMode) {
        prompt += `\n\n---\n\n## Autonomous Mode\n\nYou are running autonomously without a human in the loop. When a skill or workflow asks for user input, make reasonable decisions based on the task description and context. Document all decisions you make in the handoff block. Do NOT pause or ask questions — keep moving forward.`
      }
    } else {
      // Build dependency context from completed prerequisite tasks
      let dependencyContext: string | undefined
      if (task.dependencyIds?.length > 0) {
        const depContextParts: string[] = []
        for (const depId of task.dependencyIds) {
          const depTask = getTask(this.dbPath, depId)
          if (depTask?.artifacts) {
            const a = depTask.artifacts
            const parts: string[] = [`**Task "${depTask.title}"** completed.`]
            if (a.filesCreated.length) parts.push(`Files created: ${a.filesCreated.map(f => '`' + f + '`').join(', ')}`)
            if (a.filesModified.length) parts.push(`Files modified: ${a.filesModified.map(f => '`' + f + '`').join(', ')}`)
            if (a.exportsAdded.length) parts.push(`Exports added: ${a.exportsAdded.join(', ')}`)
            if (a.typesAdded.length) parts.push(`Types added: ${a.typesAdded.join(', ')}`)
            if (a.summary) parts.push(`Summary: ${a.summary}`)
            depContextParts.push(parts.join('\n'))
          }
        }
        if (depContextParts.length) {
          dependencyContext = depContextParts.join('\n\n')
        }
      }

      prompt = constructPrompt(stage, task, this.projectPath, dependencyContext)

      // Auto mode: inject autonomous decision-making instructions
      if (task.autoMode) {
        prompt += `\n\n---\n\n## Autonomous Mode\n\nYou are running autonomously without a human in the loop. When a skill or workflow asks for user input, make reasonable decisions based on the task description and context. Document all decisions you make in the handoff block. Do NOT pause or ask questions — keep moving forward.`
      }

      // Append feedback if provided (rejection re-run)
      if (feedback) {
        prompt += `\n\n---\n\n## Reviewer Feedback (Address This)\n\n${feedback}`
      }
    }

    try {
      const sessionKey = `${taskId}-${stage}`

      const sdkPromise = this.sdkRunner({
        prompt,
        model: stageConfig.model,
        maxTurns: stageConfig.maxTurns,
        cwd: this.taskWorktrees.get(taskId) ?? this.projectPath,
        taskId,
        autoMode: task.autoMode,
        resumeSessionId: isContinuation ? existingSessionId! : resumeSessionId,
        sessionKey,
        stage,
        dbPath: this.dbPath,
        onStream: (content: string, type: string) => {
          if (type === 'context') {
            const parts = content.replace('__context:', '').split(':')
            this.emit('context-update', {
              taskId,
              stage,
              contextTokens: parseInt(parts[0], 10),
              contextMax: parseInt(parts[1], 10)
            })
          } else {
            this.emit('stream', { taskId, stage, content, type })
          }
        },
        onApprovalRequest: (requestId: string, toolName: string, toolInput: Record<string, unknown>) => {
          this.emit('approval-request', { taskId, stage, requestId, toolName, toolInput })
        }
      })

      let timeoutHandle: ReturnType<typeof setTimeout> | undefined
      const timeoutPromise = new Promise<never>((_resolve, reject) => {
        timeoutHandle = setTimeout(() => {
          abortSession(sessionKey)
          reject(new Error(`Stage '${stage}' timed out after ${stageConfig.timeoutMs}ms`))
        }, stageConfig.timeoutMs)
      })

      const result = await Promise.race([sdkPromise, timeoutPromise])
      clearTimeout(timeoutHandle)

      // Store session ID for potential resume and continuation
      if (result.sessionId) {
        this.sessionIds.set(taskId, result.sessionId)
        updateTask(this.dbPath, taskId, { activeSessionId: result.sessionId })
      }

      // Track context usage for budget decisions on stage transitions
      if (result.contextTokens !== undefined) {
        this.contextUsage.set(taskId, {
          tokens: result.contextTokens,
          max: result.contextMax || 200_000,
        })
      }

      // Parse handoff from output
      const handoff = parseHandoff(result.output)

      // Build the full handoff record
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

      // Store stage-specific output in the appropriate DB column
      await this.storeStageOutput(taskId, stage, result)

      appendAgentLog(this.dbPath, taskId, {
        timestamp: new Date().toISOString(),
        agent: stage,
        model: stageConfig.model,
        action: 'stage:complete',
        details: `Cost: ${result.cost}, Turns: ${result.turns}, Session: ${result.sessionId}`
      })

      // Determine what happens after stage completion
      if (handoffRecord.status === 'blocked') {
        updateTask(this.dbPath, taskId, { status: 'blocked' as TaskStatus })
        this.emit('stage:error', { taskId, stage, reason: 'Agent reported blocked status' })
        return
      }

      if (handoffRecord.status === 'needs_intervention' || handoffRecord.openQuestions) {
        this.emit('stage:pause', { taskId, stage, reason: 'Needs human intervention', openQuestions: handoffRecord.openQuestions })
        return
      }

      // Stage completed successfully
      this.emit('stage:complete', { taskId, stage })

      // If this stage pauses for review, notify the renderer
      if (stageConfig.pauses && !task.autoMode) {
        this.emit('stage:awaiting-review', { taskId, stage })
      }

      // Auto-advance if stage doesn't pause or task is autoMode
      if (!stageConfig.pauses || task.autoMode) {
        const nextStage = getNextStage(task.tier, stage)
        if (nextStage) {
          // Check context budget before continuing in the same session
          const contextState = this.contextUsage.get(taskId)
          if (contextState) {
            const budgetCheck = checkContextBudget(
              contextState.tokens,
              contextState.max,
              nextStage
            )

            if (!budgetCheck.canContinue) {
              // Emit event for renderer to show handoff approval UI
              this.emit('stage:context_handoff', {
                taskId,
                currentStage: stage,
                nextStage,
                usagePercent: budgetCheck.usagePercent,
                remainingTokens: budgetCheck.remainingContext,
                estimatedNeed: budgetCheck.estimatedNeed,
              })
              // Don't advance — wait for approveContextHandoff()
              return
            }
          }

          const transition = canTransition(this.getTaskOrThrow(taskId), nextStage)
          if (transition.allowed) {
            const nextStatus = STAGE_TO_STATUS[nextStage] as TaskStatus
            // Extract artifacts before marking done
            if (nextStage === 'done') {
              await this.extractArtifacts(taskId)
            }
            // Update status and currentAgent before running the next stage
            // so the UI reflects the correct column during execution
            updateTask(this.dbPath, taskId, {
              status: nextStatus,
              currentAgent: nextStage,
              ...(nextStage === 'done' ? { completedAt: new Date().toISOString() } : {})
            })
            await this.runStage(taskId, nextStage)
          }
        } else {
          // No next stage — pipeline complete — extract artifacts before marking done
          await this.extractArtifacts(taskId)
          updateTask(this.dbPath, taskId, {
            status: 'done' as TaskStatus,
            currentAgent: 'done',
            completedAt: new Date().toISOString()
          })
        }
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)

      appendAgentLog(this.dbPath, taskId, {
        timestamp: new Date().toISOString(),
        agent: stage,
        model: stageConfig.model,
        action: 'stage:error',
        details: `Error: ${errorMessage}`
      })

      // Set task to blocked so it can be retried via stepTask()
      updateTask(this.dbPath, taskId, { status: 'blocked' as TaskStatus })

      this.emit('stage:error', { taskId, stage, error: errorMessage })
    }
  }

  /**
   * Map stage results to the appropriate DB columns.
   */
  private async storeStageOutput(taskId: number, stage: PipelineStage, result: SdkResult): Promise<void> {
    const stageConfig = getEffectiveStageConfig(stage, this.dbPath)

    // For stages that pause for review, validate output is non-empty
    if (stageConfig.pauses && (!result.output || result.output.trim() === '')) {
      appendAgentLog(this.dbPath, taskId, {
        timestamp: new Date().toISOString(),
        agent: stage,
        model: stageConfig.model,
        action: 'stage:warning',
        details: `Stage ${stage} produced empty output — skipping storage`
      })
      return
    }

    const updates: Record<string, any> = {}

    switch (stage) {
      case 'brainstorm':
        updates.brainstormOutput = result.output
        break
      case 'design_review':
        updates.designReview = { output: result.output, cost: result.cost, sessionId: result.sessionId }
        break
      case 'plan':
        updates.plan = { output: result.output, cost: result.cost, sessionId: result.sessionId }
        break
      case 'implement':
        updates.implementationNotes = { output: result.output, cost: result.cost, sessionId: result.sessionId }
        break
      case 'code_review':
        updates.reviewComments = { output: result.output, cost: result.cost, sessionId: result.sessionId }
        // Try to extract a numeric score from the output
        const scoreMatch = result.output.match(/(?:score|rating)\s*[:=]\s*(\d+(?:\.\d+)?)/i)
        if (scoreMatch) {
          updates.reviewScore = parseFloat(scoreMatch[1])
        }
        break
      case 'verify':
        updates.verifyResult = result.output
        // Try to extract test results
        const testMatch = result.output.match(/tests?\s+passed/i)
        updates.testResults = {
          passed: !!testMatch,
          lintErrors: 0,
          buildErrors: 0,
          testsPassed: 0,
          testsFailed: 0,
          details: result.output
        }
        break
      case 'done':
        // Extract commit hash if present
        const commitMatch = result.output.match(/commit\s+([a-f0-9]{7,40})/i)
        if (commitMatch) {
          updates.commitHash = commitMatch[1]
        }
        updates.completedAt = new Date().toISOString()
        break
    }

    if (Object.keys(updates).length > 0) {
      updateTask(this.dbPath, taskId, updates)
    }

    // Auto-commit stage work
    if (this.gitEngine) {
      try {
        await this.gitEngine.stageCommit(taskId, stage)
      } catch (err: any) {
        console.warn(`Git stage commit failed for task ${taskId}/${stage}: ${err.message}`)
      }
    }

    // Auto-merge and cleanup worktree on task completion
    if (stage === 'done' && this.gitEngine) {
      try {
        // Auto-merge completed task branch to base
        const mergeResult = await this.gitEngine.merge(taskId)
        if (!mergeResult.success) {
          this.emit('stream', {
            taskId,
            agent: 'pipeline',
            type: 'error' as const,
            content: `Auto-merge failed: ${mergeResult.message ?? 'merge conflict'}. Resolve manually before dependent tasks can start.`,
            timestamp: new Date().toISOString()
          })
          // Don't cleanup worktree on merge failure
          return
        }
      } catch (err) {
        this.emit('stream', {
          taskId,
          agent: 'pipeline',
          type: 'error' as const,
          content: `Auto-merge error: ${err instanceof Error ? err.message : String(err)}`,
          timestamp: new Date().toISOString()
        })
        return
      }

      // Check if any dependent tasks are now unblocked
      const dependents = getTaskDependents(this.dbPath, taskId)
      for (const depId of dependents) {
        if (areDependenciesMet(this.dbPath, depId)) {
          this.emit('task:unblocked', { taskId: depId })
        }
      }

      await this.gitEngine.cleanupWorktree(taskId)
      this.taskWorktrees.delete(taskId)
    }
  }

  /**
   * Extract artifact metadata from a completed task's agent log.
   */
  private async extractArtifacts(taskId: number): Promise<void> {
    const task = getTask(this.dbPath, taskId)
    if (!task) return

    const artifacts: TaskArtifacts = {
      filesCreated: [],
      filesModified: [],
      exportsAdded: [],
      typesAdded: [],
      summary: ''
    }

    // Extract file paths from agent log details
    // Log entries with action containing 'write' or 'edit' may reference files
    for (const entry of task.agentLog) {
      if (entry.action === 'tool_use' || entry.action === 'stage:complete') {
        // Parse file paths from details - look for common patterns
        const writeMatch = entry.details.match(/(?:write|create|Write)\s+(?:to\s+)?["']?([^\s"',]+)/)
        if (writeMatch) {
          artifacts.filesCreated.push(writeMatch[1])
        }
        const editMatch = entry.details.match(/(?:edit|Edit|modify|Modify)\s+(?:to\s+)?["']?([^\s"',]+)/)
        if (editMatch) {
          artifacts.filesModified.push(editMatch[1])
        }
      }
    }

    // Deduplicate: if a file was both created and modified, keep only in created
    const createdSet = new Set(artifacts.filesCreated)
    artifacts.filesModified = Array.from(new Set(artifacts.filesModified)).filter(f => !createdSet.has(f))
    artifacts.filesCreated = Array.from(createdSet)

    // Build summary from implementation notes
    if (task.implementationNotes) {
      const notes = typeof task.implementationNotes === 'string'
        ? task.implementationNotes
        : JSON.stringify(task.implementationNotes)
      artifacts.summary = notes.slice(0, 500)
    }

    setTaskArtifacts(this.dbPath, taskId, artifacts)
  }

  /**
   * Fetch a task or throw if not found.
   */
  private getTaskOrThrow(taskId: number): Task {
    const task = getTask(this.dbPath, taskId)
    if (!task) {
      throw new Error(`Task ${taskId} not found`)
    }
    return task
  }
}
