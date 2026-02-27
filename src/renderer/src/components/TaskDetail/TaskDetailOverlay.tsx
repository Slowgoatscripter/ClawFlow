import { useEffect, useRef, useState } from 'react'
import { X, Pause, Play, RotateCcw, Archive } from 'lucide-react'
import { useTaskStore } from '../../stores/taskStore'
import { useLayoutStore } from '../../stores/layoutStore'
import { usePipelineStore } from '../../stores/pipelineStore'
import { useProjectStore } from '../../stores/projectStore'
import { colors } from '../../theme'
import { StageTabs } from './StageTabs'
import { AgentLog } from './AgentLog'
import { ContextWindowBar } from '../WorkshopPanel/ContextWindowBar'
import { TIER_STAGES } from '../../../../shared/constants'
import type { PipelineStage } from '../../../../shared/types'

const statusColors: Record<string, string> = {
  backlog: 'bg-text-muted/20 text-text-muted',
  brainstorming: 'bg-accent-violet/20 text-accent-violet',
  design_review: 'bg-accent-amber/20 text-accent-amber',
  planning: 'bg-accent-cyan/20 text-accent-cyan',
  implementing: 'bg-accent-peach/20 text-accent-peach',
  code_review: 'bg-accent-amber/20 text-accent-amber',
  verifying: 'bg-accent-green/20 text-accent-green',
  done: 'bg-accent-green/20 text-accent-green',
  blocked: 'bg-accent-magenta/20 text-accent-magenta',
  paused: 'bg-text-muted/20 text-text-muted',
}

export function TaskDetailOverlay() {
  const taskDetailOverlayId = useLayoutStore((s) => s.taskDetailOverlayId)
  const closeTaskDetail = useLayoutStore((s) => s.closeTaskDetail)
  const tasks = useTaskStore((s) => s.tasks)
  const contextByTaskId = usePipelineStore((s) => s.contextByTaskId)
  const [visible, setVisible] = useState(false)
  const [restartMenuOpen, setRestartMenuOpen] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)

  const task = tasks.find((t) => t.id === taskDetailOverlayId)
  const context = taskDetailOverlayId != null ? contextByTaskId[taskDetailOverlayId] : undefined

  // Animate in on mount
  useEffect(() => {
    if (taskDetailOverlayId !== null) {
      // Trigger enter animation on next frame
      requestAnimationFrame(() => setVisible(true))
    } else {
      setVisible(false)
    }
  }, [taskDetailOverlayId])

  const handleClose = () => {
    setVisible(false)
    // Wait for exit animation before actually closing
    setTimeout(() => closeTaskDetail(), 200)
  }

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      handleClose()
    }
  }

  const handlePause = async () => {
    if (!task) return
    await usePipelineStore.getState().pauseTask(task.id)
    const project = useProjectStore.getState().currentProject
    if (project) await useTaskStore.getState().loadTasks(project.dbPath)
  }

  const handleResume = async () => {
    if (!task) return
    await usePipelineStore.getState().resumeTask(task.id)
    const project = useProjectStore.getState().currentProject
    if (project) await useTaskStore.getState().loadTasks(project.dbPath)
  }

  const getCompletedStages = (): PipelineStage[] => {
    if (!task) return []
    const stages = TIER_STAGES[task.tier]
    return stages.filter((stage) => {
      if (stage === 'done') return false
      switch (stage) {
        case 'brainstorm': return !!task.brainstormOutput
        case 'design_review': return !!task.designReview
        case 'plan': return !!task.plan
        case 'implement': return !!task.implementationNotes
        case 'code_review': return !!task.reviewComments
        case 'verify': return !!task.verifyResult
        default: return false
      }
    }) as PipelineStage[]
  }

  const handleRestartToStage = async (targetStage: PipelineStage) => {
    if (!task) return
    setRestartMenuOpen(false)
    try {
      await window.api.pipeline.restartToStage(task.id, targetStage)
      const project = useProjectStore.getState().currentProject
      if (project) await useTaskStore.getState().loadTasks(project.dbPath)
      usePipelineStore.getState().clearStream()
    } catch (err) {
      console.error('Failed to restart to stage:', err)
    }
  }

  const handleFullRestart = async () => {
    if (!task) return
    setRestartMenuOpen(false)
    const stages = TIER_STAGES[task.tier]
    const firstStage = stages[0] as PipelineStage
    try {
      await window.api.pipeline.restartToStage(task.id, firstStage)
      const project = useProjectStore.getState().currentProject
      if (project) await useTaskStore.getState().loadTasks(project.dbPath)
      usePipelineStore.getState().clearStream()
    } catch (err) {
      console.error('Failed to restart task:', err)
    }
  }

  const handleArchive = async () => {
    if (!task) return
    const project = useProjectStore.getState().currentProject
    if (!project) return
    await useTaskStore.getState().archiveTask(project.dbPath, task.id)
    handleClose()
  }

  if (taskDetailOverlayId === null) return null

  const isActive = task && !['backlog', 'done', 'blocked', 'paused'].includes(task.status)
  const isPaused = task?.status === 'paused'

  return (
    <div
      className={`fixed inset-0 z-40 transition-colors duration-200 ${
        visible ? 'bg-black/40' : 'bg-transparent'
      }`}
      onClick={handleBackdropClick}
    >
      {/* Slide-over panel */}
      <div
        ref={panelRef}
        className={`fixed top-0 right-0 h-full w-[480px] max-w-[90vw] bg-[var(--color-surface)] border-l border-[var(--color-border)] shadow-2xl overflow-y-auto transition-transform duration-200 ease-out ${
          visible ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        {task ? (
          <div className="flex flex-col h-full">
            {/* Header */}
            <div className="flex items-start gap-3 px-5 pt-5 pb-4 border-b border-[var(--color-border)] flex-shrink-0">
              <div className="flex-1 min-w-0">
                <h2 className="text-lg font-bold text-[var(--color-text-primary)] leading-tight">
                  {task.title}
                </h2>
              </div>
              <button
                onClick={handleClose}
                className="w-7 h-7 flex items-center justify-center rounded text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-elevated)] transition-all flex-shrink-0"
                title="Close"
              >
                <X size={16} />
              </button>
            </div>

            {/* Scrollable body */}
            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
              {/* Status bar */}
              <div className="flex items-center gap-2 flex-wrap">
                <span
                  className={`text-xs font-semibold px-2 py-0.5 rounded-full ${statusColors[task.status] ?? 'bg-text-muted/20 text-text-muted'}`}
                >
                  {task.status.replace('_', ' ')}
                </span>
                {task.currentAgent && (
                  <span className="text-xs text-[var(--color-text-secondary)] bg-[var(--color-elevated)] px-2 py-0.5 rounded-full">
                    {task.currentAgent}
                  </span>
                )}
                {isPaused && task.pauseReason && (
                  <span className="text-xs px-2 py-0.5 rounded bg-[var(--color-elevated)] text-[var(--color-text-muted)]">
                    {task.pauseReason === 'usage_limit' ? 'Usage Limit' : task.pauseReason === 'merge_conflict' ? 'Merge Conflict' : 'Manual'}
                  </span>
                )}
              </div>

              {/* Context window bar */}
              {context && (
                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-medium text-[var(--color-text-muted)] uppercase tracking-wide">
                      Context Window
                    </span>
                    <span className="text-[10px] text-[var(--color-text-muted)] tabular-nums">
                      {Math.round(context.tokens / 1000)}k / {Math.round(context.max / 1000)}k
                    </span>
                  </div>
                  <ContextWindowBar used={context.tokens} max={context.max} />
                </div>
              )}

              {/* Description */}
              {task.description && (
                <div className="space-y-1.5">
                  <h3 className="text-[10px] font-semibold text-[var(--color-text-muted)] uppercase tracking-wide">
                    Description
                  </h3>
                  <p className="text-sm text-[var(--color-text-secondary)] leading-relaxed">
                    {task.description}
                  </p>
                </div>
              )}

              {/* Work order section */}
              {task.groupId && task.workOrder && (
                <div className="space-y-2">
                  <h3 className="text-[10px] font-semibold text-[var(--color-text-muted)] uppercase tracking-wide">
                    Work Order
                  </h3>
                  <div className="bg-[var(--color-elevated)] rounded-lg p-3 space-y-2 text-sm">
                    {task.workOrder.objective && (
                      <div>
                        <span className="text-[var(--color-text-muted)] text-xs">Objective:</span>
                        <p className="text-[var(--color-text-primary)] mt-0.5">{task.workOrder.objective}</p>
                      </div>
                    )}
                    {task.workOrder.files && task.workOrder.files.length > 0 && (
                      <div>
                        <span className="text-[var(--color-text-muted)] text-xs">Files:</span>
                        <div className="mt-1 space-y-0.5">
                          {task.workOrder.files.map((f, i) => (
                            <div key={i} className="flex items-center gap-2 text-xs font-mono">
                              <span
                                className={`px-1 py-0.5 rounded text-[9px] font-semibold ${
                                  f.action === 'create'
                                    ? 'bg-accent-green/20 text-accent-green'
                                    : 'bg-accent-cyan/20 text-accent-cyan'
                                }`}
                              >
                                {f.action}
                              </span>
                              <span className="text-[var(--color-text-secondary)] truncate">{f.path}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    {task.workOrder.patterns && task.workOrder.patterns.length > 0 && (
                      <div>
                        <span className="text-[var(--color-text-muted)] text-xs">Patterns:</span>
                        <div className="flex flex-wrap gap-1 mt-1">
                          {task.workOrder.patterns.map((p, i) => (
                            <span key={i} className="text-[10px] px-1.5 py-0.5 rounded bg-accent-violet/15 text-accent-violet">
                              {p}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Action buttons */}
              <div className="flex items-center gap-2">
                {isActive && (
                  <button
                    onClick={handlePause}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-accent-amber/15 text-accent-amber hover:bg-accent-amber/25 transition-colors"
                  >
                    <Pause size={12} />
                    Pause
                  </button>
                )}
                {isPaused && (
                  <button
                    onClick={handleResume}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-accent-green/15 text-accent-green hover:bg-accent-green/25 transition-colors"
                  >
                    <Play size={12} />
                    Resume
                  </button>
                )}
                <button
                  onClick={handleArchive}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-[var(--color-elevated)] text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] hover:bg-[var(--color-border)] transition-colors"
                >
                  <Archive size={12} />
                  Archive
                </button>
                {task.status !== 'backlog' && task.status !== 'done' && (
                  <div className="relative">
                    <button
                      onClick={() => setRestartMenuOpen(!restartMenuOpen)}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-accent-amber/40 text-accent-amber hover:bg-accent-amber/10 transition-colors"
                    >
                      <RotateCcw size={12} />
                      Restart
                    </button>
                    {restartMenuOpen && (
                      <>
                        <div className="fixed inset-0 z-10" onClick={() => setRestartMenuOpen(false)} />
                        <div className="absolute top-full left-0 mt-1 z-20 bg-[var(--color-elevated)] border border-[var(--color-border)] rounded-lg shadow-lg py-1 min-w-[200px]">
                          <button
                            onClick={handleFullRestart}
                            className="w-full text-left px-3 py-1.5 text-xs text-accent-amber hover:bg-accent-amber/10 transition-colors"
                          >
                            Full Restart
                          </button>
                          {getCompletedStages().length > 0 && (
                            <div className="border-t border-[var(--color-border)] my-1" />
                          )}
                          {getCompletedStages().map((stage) => (
                            <button
                              key={stage}
                              onClick={() => handleRestartToStage(stage)}
                              className="w-full text-left px-3 py-1.5 text-xs text-[var(--color-text-secondary)] hover:bg-accent-cyan/10 hover:text-[var(--color-text-primary)] transition-colors"
                            >
                              Restart from {stage.replace('_', ' ')}
                            </button>
                          ))}
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>

              {/* Stage output tabs */}
              <div className="space-y-1.5">
                <h3 className="text-[10px] font-semibold text-[var(--color-text-muted)] uppercase tracking-wide">
                  Stage Outputs
                </h3>
                <StageTabs task={task} />
              </div>

              {/* Agent log */}
              <div className="space-y-1.5">
                <h3 className="text-[10px] font-semibold text-[var(--color-text-muted)] uppercase tracking-wide">
                  Agent Activity
                </h3>
                <AgentLog log={task.agentLog} />
              </div>
            </div>
          </div>
        ) : (
          <div className="h-full flex items-center justify-center">
            <p className="text-sm text-[var(--color-text-muted)]">Task not found</p>
          </div>
        )}
      </div>
    </div>
  )
}
