import { useEffect, useRef } from 'react'
import { useTaskStore } from '../../stores/taskStore'
import { useLayoutStore } from '../../stores/layoutStore'
import { useProjectStore } from '../../stores/projectStore'
import { usePipelineStore } from '../../stores/pipelineStore'
import { colors } from '../../theme'
import { TaskTimeline } from './TaskTimeline'
import { StageTabs } from './StageTabs'
import { HandoffChain } from './HandoffChain'
import { AgentLog } from './AgentLog'
import { TodoAccordion } from './TodoAccordion'
import { InterventionPanel } from '../InterventionPanel/InterventionPanel'

const tierClasses: Record<string, string> = {
  L1: 'bg-accent-green/20 text-accent-green',
  L2: 'bg-accent-teal/20 text-accent-teal',
  L3: 'bg-accent-mauve/20 text-accent-mauve'
}

const priorityClasses: Record<string, string> = {
  low: 'bg-text-muted/20 text-text-muted',
  medium: 'bg-accent-teal/20 text-accent-teal',
  high: 'bg-accent-peach/20 text-accent-peach',
  critical: 'bg-accent-red/20 text-accent-red'
}

const eventTypeColors: Record<string, string> = {
  text: 'bg-accent-teal/20 text-accent-teal',
  tool_use: 'bg-accent-mauve/20 text-accent-mauve',
  tool_result: 'bg-accent-green/20 text-accent-green',
  status: 'bg-accent-gold/20 text-accent-gold',
  error: 'bg-accent-red/20 text-accent-red',
  complete: 'bg-accent-green/20 text-accent-green'
}

export function TaskDetail() {
  const tasks = useTaskStore((s) => s.tasks)
  const selectedTaskId = useTaskStore((s) => s.selectedTaskId)
  const activeTaskId = usePipelineStore((s) => s.activeTaskId)
  const streaming = usePipelineStore((s) => s.streaming)
  const allStreamEvents = usePipelineStore((s) => s.streamEvents)
  const todosByTaskId = usePipelineStore((s) => s.todosByTaskId)
  const outputRef = useRef<HTMLDivElement>(null)

  const task = tasks.find((t) => t.id === selectedTaskId)

  // Filter stream events to only show output for this task
  const streamEvents = allStreamEvents.filter((e) => e.taskId === task?.id)
  const isStreamingThisTask = streaming && activeTaskId === task?.id

  // Auto-scroll live output within its own container (not the page)
  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight
    }
  }, [streamEvents.length])

  const handleBack = async () => {
    const project = useProjectStore.getState().currentProject
    if (project) {
      await useTaskStore.getState().loadTasks(project.dbPath)
    }
    useTaskStore.getState().selectTask(null)
    useLayoutStore.getState().setView('dashboard')
  }

  const handleStartPipeline = async () => {
    if (!task) return
    await usePipelineStore.getState().startPipeline(task.id)
    const project = useProjectStore.getState().currentProject
    if (project) {
      await useTaskStore.getState().loadTasks(project.dbPath)
    }
  }

  const handleStep = async () => {
    if (!task) return
    await usePipelineStore.getState().stepPipeline(task.id)
    const project = useProjectStore.getState().currentProject
    if (project) {
      await useTaskStore.getState().loadTasks(project.dbPath)
    }
  }

  const handleRestart = async () => {
    if (!task) return
    const project = useProjectStore.getState().currentProject
    if (!project) return
    await window.api.tasks.update(project.dbPath, task.id, {
      status: 'backlog',
      currentAgent: null,
      startedAt: null,
      completedAt: null,
      brainstormOutput: null,
      designReview: null,
      plan: null,
      planReviewCount: 0,
      implementationNotes: null,
      reviewComments: null,
      reviewScore: null,
      implReviewCount: 0,
      testResults: null,
      verifyResult: null,
      commitHash: null,
      todos: null,
      handoffs: [],
      agentLog: []
    })
    await useTaskStore.getState().loadTasks(project.dbPath)
    usePipelineStore.getState().clearStream()
  }

  const handleDelete = async () => {
    if (!task) return
    const project = useProjectStore.getState().currentProject
    if (project) {
      await useTaskStore.getState().deleteTask(project.dbPath, task.id)
    }
    useTaskStore.getState().selectTask(null)
    useLayoutStore.getState().setView('dashboard')
  }

  if (!task) {
    return (
      <div className="h-full bg-bg flex items-center justify-center">
        <div className="text-center">
          <p className="text-text-muted text-lg">Task not found</p>
          <button
            onClick={handleBack}
            className="mt-4 px-4 py-2 bg-accent-teal text-bg rounded-lg text-sm font-medium hover:opacity-90 transition-opacity"
          >
            Back to Dashboard
          </button>
        </div>
      </div>
    )
  }

  const isBacklog = task.status === 'backlog'
  const isDone = task.status === 'done'
  const isActive = !isBacklog && !isDone && task.status !== 'blocked' && task.status !== 'paused'
  const isPaused = task.status === 'paused'
  const showLiveOutput = isStreamingThisTask || streamEvents.length > 0

  // Dependency-blocked check
  const pendingDeps = (task.dependencyIds ?? [])
    .map((depId) => tasks.find((t) => t.id === depId))
    .filter((dep) => dep && dep.status !== 'done')
  const isDependencyBlocked = pendingDeps.length > 0

  // Check if the intervention panel is showing open questions
  const lastHandoff = task.handoffs.length > 0 ? task.handoffs[task.handoffs.length - 1] : null
  const hasOpenQuestions =
    lastHandoff?.openQuestions != null &&
    lastHandoff.openQuestions !== 'none' &&
    lastHandoff.openQuestions.trim() !== ''

  return (
    <div className="h-full bg-bg overflow-y-auto">
      <div className="max-w-7xl mx-auto px-6 py-6 space-y-6">
        {/* Header row */}
        <div className="flex items-center gap-4 flex-wrap">
          <button
            onClick={handleBack}
            className="flex items-center gap-1.5 text-text-secondary hover:text-text-primary transition-colors text-sm"
          >
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
              <path
                fillRule="evenodd"
                d="M9.707 16.707a1 1 0 01-1.414 0l-6-6a1 1 0 010-1.414l6-6a1 1 0 011.414 1.414L5.414 9H17a1 1 0 110 2H5.414l4.293 4.293a1 1 0 010 1.414z"
                clipRule="evenodd"
              />
            </svg>
            Back
          </button>

          <h1 className="text-2xl font-bold text-text-primary">{task.title}</h1>

          {/* Badges */}
          <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${tierClasses[task.tier] ?? ''}`}>
            {task.tier}
          </span>
          <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${priorityClasses[task.priority] ?? ''}`}>
            {task.priority}
          </span>
          <span
            className="text-xs font-semibold px-2 py-0.5 rounded-full"
            style={{
              backgroundColor: `${colors.status[task.status]}20`,
              color: colors.status[task.status]
            }}
          >
            {task.status.replace('_', ' ')}
          </span>
          {isPaused && task.pauseReason && (
            <span className="text-xs px-2 py-0.5 rounded" style={{ background: colors.elevated, color: colors.text.muted }}>
              {task.pauseReason === 'usage_limit' ? 'Usage Limit' : 'Manual Pause'}
            </span>
          )}
          {task.autoMode ? (
            <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-accent-gold/20 text-accent-gold">
              AUTO
            </span>
          ) : (
            <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-accent-teal/20 text-accent-teal">
              GATED
            </span>
          )}
        </div>

        {/* Dependency-blocked banner */}
        {isDependencyBlocked && (
          <div className="flex items-center gap-2 px-4 py-2.5 bg-accent-gold/10 border border-accent-gold/30 rounded-lg text-sm text-accent-gold">
            <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
              <path d="M7 11V7a5 5 0 0110 0v4" />
            </svg>
            <span>
              Blocked by incomplete dependencies: {pendingDeps.map((d) => d!.title).join(', ')}
            </span>
          </div>
        )}

        {/* Description */}
        {task.description && (
          <p className="text-sm text-text-secondary">{task.description}</p>
        )}

        {/* Action buttons */}
        <div className="flex items-center gap-3">
          {isBacklog && (
            <div className="relative group/start">
              <button
                onClick={handleStartPipeline}
                disabled={isDependencyBlocked}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-opacity ${
                  isDependencyBlocked
                    ? 'bg-text-muted/30 text-text-muted cursor-not-allowed'
                    : 'bg-accent-green text-bg hover:opacity-90'
                }`}
              >
                Start Pipeline
              </button>
              {isDependencyBlocked && (
                <div className="absolute bottom-full left-0 mb-2 px-3 py-2 bg-elevated border border-accent-gold/30 rounded-lg text-xs text-accent-gold whitespace-nowrap opacity-0 group-hover/start:opacity-100 transition-opacity pointer-events-none">
                  Waiting on: {pendingDeps.map((d) => d!.title).join(', ')}
                </div>
              )}
            </div>
          )}
          {isActive && !hasOpenQuestions && (
            <button
              onClick={handleStep}
              className="px-4 py-2 bg-accent-teal text-bg rounded-lg text-sm font-medium hover:opacity-90 transition-opacity"
            >
              Retry Stage
            </button>
          )}
          {isActive && (
            <button
              onClick={() => usePipelineStore.getState().pauseTask(task.id)}
              style={{ background: colors.accent.gold, color: colors.bg }}
              className="px-4 py-2 rounded-lg text-sm font-medium hover:opacity-90 transition-opacity"
            >
              Pause
            </button>
          )}
          {isPaused && (
            <button
              onClick={() => usePipelineStore.getState().resumeTask(task.id)}
              style={{ background: colors.accent.green, color: colors.bg }}
              className="px-4 py-2 rounded-lg text-sm font-medium hover:opacity-90 transition-opacity"
            >
              Resume
            </button>
          )}
          {!isBacklog && !isDone && (
            <button
              onClick={handleRestart}
              className="px-4 py-2 border border-accent-gold text-accent-gold rounded-lg text-sm font-medium hover:bg-accent-gold/10 transition-colors"
            >
              Restart
            </button>
          )}
          <button
            onClick={handleDelete}
            className="px-4 py-2 border border-accent-red text-accent-red rounded-lg text-sm font-medium hover:bg-accent-red/10 transition-colors"
          >
            Delete
          </button>
        </div>

        {/* Intervention Panel */}
        <InterventionPanel task={task} />

        {/* Todo Progress */}
        {(() => {
          const liveTodos = todosByTaskId[task.id]
          const persistedTodos = task.todos
          const merged = { ...(persistedTodos || {}), ...(liveTodos || {}) }
          return Object.keys(merged).length > 0 ? (
            <TodoAccordion todos={merged} currentStage={task.status === 'implementing' ? 'implement' : undefined} />
          ) : null
        })()}

        {/* Live Output */}
        {showLiveOutput && (
          <div>
            <h2 className="text-sm font-semibold text-text-muted uppercase tracking-wide mb-3">
              Live Output
              {isStreamingThisTask && (
                <span className="ml-2 inline-block w-2 h-2 rounded-full bg-accent-green animate-pulse" />
              )}
            </h2>
            <div ref={outputRef} className="bg-elevated rounded-lg p-4 font-mono text-sm max-h-[300px] overflow-y-auto">
              {streamEvents.map((event, i) => (
                <div key={i} className="flex items-start gap-2 py-1">
                  <span className="text-text-muted text-xs whitespace-nowrap shrink-0">
                    {new Date(event.timestamp).toLocaleTimeString()}
                  </span>
                  <span className={`text-xs font-semibold px-1.5 py-0.5 rounded shrink-0 ${eventTypeColors[event.type] ?? 'bg-text-muted/20 text-text-muted'}`}>
                    {event.type}
                  </span>
                  <span className="text-text-secondary break-all">{event.content}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Timeline */}
        <TaskTimeline task={task} />

        {/* Two-column layout: Stage tabs + Handoff chain */}
        <div className="flex gap-6">
          <div className="flex-2 min-w-0">
            <h2 className="text-sm font-semibold text-text-muted uppercase tracking-wide mb-3">
              Stage Outputs
            </h2>
            <StageTabs task={task} />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-sm font-semibold text-text-muted uppercase tracking-wide mb-3">
              Handoff Chain
            </h2>
            <HandoffChain handoffs={task.handoffs} />
          </div>
        </div>

        {/* Agent log */}
        <div>
          <h2 className="text-sm font-semibold text-text-muted uppercase tracking-wide mb-3">
            Agent Activity
          </h2>
          <AgentLog log={task.agentLog} />
        </div>
      </div>
    </div>
  )
}
