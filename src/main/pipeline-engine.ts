import { EventEmitter } from 'events'
import type { PipelineStage, Task, TaskStatus, Handoff } from '../shared/types'
import { STAGE_CONFIGS, TIER_STAGES, STAGE_TO_STATUS } from '../shared/constants'
import { getNextStage, getFirstStage, canTransition, isCircuitBreakerTripped } from '../shared/pipeline-rules'
import { getTask, updateTask, appendAgentLog, appendHandoff } from './db'
import { constructPrompt, parseHandoff } from './template-engine'
import { GitEngine } from './git-engine'

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
  onStream: (content: string, type: string) => void
  onApprovalRequest: (requestId: string, toolName: string, toolInput: Record<string, unknown>) => void
}

export interface SdkResult {
  output: string
  cost: number
  turns: number
  sessionId: string
}

export type SdkRunner = (params: SdkRunnerParams) => Promise<SdkResult>

// --- Pipeline Engine ---

export class PipelineEngine extends EventEmitter {
  private dbPath: string
  private projectPath: string
  private sdkRunner: SdkRunner | null = null
  private gitEngine: GitEngine | null = null
  private taskWorktrees = new Map<number, string>() // taskId -> worktree cwd
  // Track active session IDs per task for resume support
  private sessionIds = new Map<number, string>()

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

      const stageConfig = STAGE_CONFIGS[currentStage]

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
      // Pipeline complete
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

  // --- Private Methods ---

  /**
   * Construct prompt, call SDK runner, parse handoff, store output, handle errors.
   */
  private async runStage(taskId: number, stage: PipelineStage, feedback?: string, resumeSessionId?: string, userResponse?: string): Promise<void> {
    if (!this.sdkRunner) {
      throw new Error('SDK runner not set. Call setSdkRunner() before running stages.')
    }

    const task = this.getTaskOrThrow(taskId)
    const stageConfig = STAGE_CONFIGS[stage]

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

    let prompt: string

    if (resumeSessionId && userResponse) {
      // Resuming an existing session — just send the user's answer
      prompt = userResponse
    } else {
      prompt = constructPrompt(stage, task, this.projectPath)

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
      const result = await this.sdkRunner({
        prompt,
        model: stageConfig.model,
        maxTurns: stageConfig.maxTurns,
        cwd: this.taskWorktrees.get(taskId) ?? this.projectPath,
        taskId,
        autoMode: task.autoMode,
        resumeSessionId,
        onStream: (content: string, type: string) => {
          this.emit('stream', { taskId, stage, content, type })
        },
        onApprovalRequest: (requestId: string, toolName: string, toolInput: Record<string, unknown>) => {
          this.emit('approval-request', { taskId, stage, requestId, toolName, toolInput })
        }
      })

      // Store session ID for potential resume
      if (result.sessionId) {
        this.sessionIds.set(taskId, result.sessionId)
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
          const transition = canTransition(this.getTaskOrThrow(taskId), nextStage)
          if (transition.allowed) {
            const nextStatus = STAGE_TO_STATUS[nextStage] as TaskStatus
            updateTask(this.dbPath, taskId, {
              status: nextStatus,
              currentAgent: nextStage
            })
            await this.runStage(taskId, nextStage)
          }
        } else {
          // No next stage — pipeline complete
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
    const stageConfig = STAGE_CONFIGS[stage]

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

    // Clean up worktree on task completion (keeps branch)
    if (stage === 'done' && this.gitEngine) {
      try {
        await this.gitEngine.cleanupWorktree(taskId)
        this.taskWorktrees.delete(taskId)
      } catch (err: any) {
        console.warn(`Git worktree cleanup failed for task ${taskId}: ${err.message}`)
      }
    }
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
