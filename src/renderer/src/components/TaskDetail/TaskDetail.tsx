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
  const streaming = usePipelineStore((s) => s.streaming)
  const streamEvents = usePipelineStore((s) => s.streamEvents)
  const streamEndRef = useRef<HTMLDivElement>(null)

  const task = tasks.find((t) => t.id === selectedTaskId)

  // Setup pipeline listeners on mount
  useEffect(() => {
    const cleanup = usePipelineStore.getState().setupListeners()
    return cleanup
  }, [])

  // Auto-scroll stream output
  useEffect(() => {
    streamEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [streamEvents])

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
      <div className="h-screen bg-bg flex items-center justify-center">
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
  const isActive = !isBacklog && !isDone && task.status !== 'blocked'
  const showLiveOutput = streaming || streamEvents.length > 0

  return (
    <div className="h-screen bg-bg overflow-y-auto">
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

        {/* Description */}
        {task.description && (
          <p className="text-sm text-text-secondary">{task.description}</p>
        )}

        {/* Action buttons */}
        <div className="flex items-center gap-3">
          {isBacklog && (
            <button
              onClick={handleStartPipeline}
              className="px-4 py-2 bg-accent-green text-bg rounded-lg text-sm font-medium hover:opacity-90 transition-opacity"
            >
              Start Pipeline
            </button>
          )}
          {isActive && (
            <button
              onClick={handleStep}
              className="px-4 py-2 bg-accent-teal text-bg rounded-lg text-sm font-medium hover:opacity-90 transition-opacity"
            >
              Step
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

        {/* Live Output */}
        {showLiveOutput && (
          <div>
            <h2 className="text-sm font-semibold text-text-muted uppercase tracking-wide mb-3">
              Live Output
              {streaming && (
                <span className="ml-2 inline-block w-2 h-2 rounded-full bg-accent-green animate-pulse" />
              )}
            </h2>
            <div className="bg-elevated rounded-lg p-4 font-mono text-sm max-h-[300px] overflow-y-auto">
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
              <div ref={streamEndRef} />
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
