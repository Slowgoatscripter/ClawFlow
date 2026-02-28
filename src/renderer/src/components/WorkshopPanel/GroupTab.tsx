import { MessageSquare, Eye, PauseCircle, PlayCircle, Trash2 } from 'lucide-react'
import { useCanvasStore } from '../../stores/canvasStore'
import { usePipelineStore } from '../../stores/pipelineStore'
import { hasOpenQuestions, isAwaitingReviewFromHandoffs } from '../../utils/taskHelpers'
import { ContextWindowBar } from './ContextWindowBar'
import type { TaskGroup, Task, TaskGroupStatus } from '../../../../shared/types'

// ─── Status badge ─────────────────────────────────────────────────────────────

function statusColor(status: TaskGroupStatus): string {
  switch (status) {
    case 'running':
      return 'var(--color-accent-green)'
    case 'paused':
      return 'var(--color-accent-amber)'
    case 'failed':
      return 'var(--color-accent-magenta)'
    case 'planning':
    case 'queued':
      return 'var(--color-accent-violet)'
    case 'completed':
      return 'var(--color-text-muted)'
    default:
      return 'var(--color-text-muted)'
  }
}

function StatusBadge({ status }: { status: TaskGroupStatus }) {
  const color = statusColor(status)
  return (
    <span
      className="inline-flex items-center gap-1 text-[9px] font-semibold tracking-[0.1em] uppercase px-1.5 py-0.5 rounded"
      style={{
        color,
        background: `color-mix(in srgb, ${color} 12%, transparent)`,
        border: `1px solid color-mix(in srgb, ${color} 25%, transparent)`,
      }}
    >
      {/* Dot */}
      <span
        className="w-1 h-1 rounded-full flex-shrink-0"
        style={{
          background: color,
          boxShadow: status === 'running' ? `0 0 4px ${color}` : undefined,
        }}
      />
      {status}
    </span>
  )
}

// ─── Task status label ────────────────────────────────────────────────────────

function taskStageLabel(task: Task): string {
  switch (task.status) {
    case 'brainstorming':
      return 'Brainstorming'
    case 'design_review':
      return 'Design Review'
    case 'planning':
      return 'Planning'
    case 'implementing':
      return 'Implementing'
    case 'code_review':
      return 'Code Review'
    case 'verifying':
      return 'Verifying'
    case 'done':
      return 'Done'
    case 'blocked':
      return 'Blocked'
    case 'paused':
      return 'Paused'
    case 'backlog':
      return 'Queued'
    default:
      return task.status
  }
}

function taskStageColor(task: Task): string {
  switch (task.status) {
    case 'implementing':
    case 'done':
      return 'var(--color-accent-green)'
    case 'paused':
    case 'blocked':
      return 'var(--color-accent-amber)'
    case 'planning':
    case 'brainstorming':
    case 'design_review':
      return 'var(--color-accent-violet)'
    case 'code_review':
    case 'verifying':
      return 'var(--color-accent-cyan)'
    default:
      return 'var(--color-text-muted)'
  }
}

// ─── Task card ────────────────────────────────────────────────────────────────

function TaskCard({
  task,
  contextTokens,
  contextMax,
  seqNumber,
  isNext,
}: {
  task: Task
  contextTokens?: number
  contextMax?: number
  seqNumber?: number | null
  isNext?: boolean
}) {
  const awaitingReviewEvent = usePipelineStore((s) => s.awaitingReview[task.id] ?? false)
  const needsApproval = awaitingReviewEvent || isAwaitingReviewFromHandoffs(task)
  const taskHasQuestions = hasOpenQuestions(task)

  const indicatorColor = taskHasQuestions
    ? 'var(--color-accent-magenta)'
    : needsApproval
      ? 'var(--color-accent-amber)'
      : null

  const stageLabel = taskStageLabel(task)
  const stageColor = taskStageColor(task)
  const hasContext = contextTokens !== undefined && contextMax !== undefined && contextMax > 0

  return (
    <div
      className="rounded-lg p-3 flex flex-col gap-2"
      style={{
        background: 'var(--color-elevated)',
        border: indicatorColor
          ? `1px solid color-mix(in srgb, ${indicatorColor} 50%, transparent)`
          : '1px solid var(--color-border)',
        boxShadow: indicatorColor
          ? `0 0 8px color-mix(in srgb, ${indicatorColor} 15%, transparent)`
          : undefined,
      }}
    >
      {/* Row 1: Title + stage chip */}
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            {seqNumber != null && task.status !== 'done' && (
              <span
                className="flex-shrink-0 text-[9px] font-bold w-4 h-4 flex items-center justify-center rounded"
                style={{
                  backgroundColor: ['brainstorming', 'design_review', 'planning', 'implementing', 'code_review', 'verifying'].includes(task.status)
                    ? 'color-mix(in srgb, var(--color-accent-cyan) 20%, transparent)'
                    : task.status === 'blocked'
                      ? 'color-mix(in srgb, var(--color-text-muted) 15%, transparent)'
                      : 'color-mix(in srgb, var(--color-text-primary) 15%, transparent)',
                  color: ['brainstorming', 'design_review', 'planning', 'implementing', 'code_review', 'verifying'].includes(task.status)
                    ? 'var(--color-accent-cyan)'
                    : task.status === 'blocked'
                      ? 'var(--color-text-muted)'
                      : 'var(--color-text-primary)',
                }}
              >
                {seqNumber}
              </span>
            )}
            {isNext && (
              <span
                className="flex-shrink-0 text-[8px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full"
                style={{
                  backgroundColor: 'color-mix(in srgb, var(--color-accent-cyan) 20%, transparent)',
                  color: 'var(--color-accent-cyan)',
                  border: '1px solid color-mix(in srgb, var(--color-accent-cyan) 35%, transparent)',
                }}
              >
                next
              </span>
            )}
            {taskHasQuestions && (
              <span
                className="flex-shrink-0 text-[8px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full"
                style={{
                  backgroundColor: 'color-mix(in srgb, var(--color-accent-magenta) 20%, transparent)',
                  color: 'var(--color-accent-magenta)',
                  border: '1px solid color-mix(in srgb, var(--color-accent-magenta) 35%, transparent)',
                }}
              >
                question
              </span>
            )}
            {needsApproval && !taskHasQuestions && (
              <span
                className="flex-shrink-0 text-[8px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full"
                style={{
                  backgroundColor: 'color-mix(in srgb, var(--color-accent-amber) 20%, transparent)',
                  color: 'var(--color-accent-amber)',
                  border: '1px solid color-mix(in srgb, var(--color-accent-amber) 35%, transparent)',
                }}
              >
                approval
              </span>
            )}
            <p
              className="text-[11px] font-medium leading-tight truncate"
              style={{ color: 'var(--color-text-primary)' }}
            >
              {task.title}
            </p>
          </div>
          {task.currentAgent && (
            <p
              className="text-[9px] mt-0.5 truncate"
              style={{ color: 'var(--color-text-muted)' }}
            >
              {task.currentAgent}
            </p>
          )}
        </div>
        {/* Stage badge */}
        <span
          className="flex-shrink-0 text-[9px] font-semibold tracking-[0.08em] uppercase px-1.5 py-0.5 rounded"
          style={{
            color: stageColor,
            background: `color-mix(in srgb, ${stageColor} 12%, transparent)`,
            border: `1px solid color-mix(in srgb, ${stageColor} 20%, transparent)`,
          }}
        >
          {stageLabel}
        </span>
      </div>

      {/* Row 2: Context window bar */}
      {hasContext && (
        <div>
          <p
            className="text-[9px] mb-1 uppercase tracking-[0.1em]"
            style={{ color: 'var(--color-text-muted)' }}
          >
            Context
          </p>
          <ContextWindowBar used={contextTokens!} max={contextMax!} />
        </div>
      )}

      {/* Row 3: Action buttons */}
      <div className="flex items-center gap-1.5 pt-0.5">
        <button
          onClick={() => {
            /* TODO: open message agent panel */
          }}
          className="flex items-center gap-1 px-2 py-1 rounded text-[10px] font-medium transition-all hover:opacity-80 active:scale-95"
          style={{
            color: 'var(--color-accent-cyan)',
            background: 'color-mix(in srgb, var(--color-accent-cyan) 10%, transparent)',
            border: '1px solid color-mix(in srgb, var(--color-accent-cyan) 20%, transparent)',
          }}
          title="Message agent"
        >
          <MessageSquare size={10} />
          <span>Message</span>
        </button>
        <button
          onClick={() => {
            /* TODO: open output peek panel */
          }}
          className="flex items-center gap-1 px-2 py-1 rounded text-[10px] font-medium transition-all hover:opacity-80 active:scale-95"
          style={{
            color: 'var(--color-text-secondary)',
            background: 'var(--color-bg)',
            border: '1px solid var(--color-border)',
          }}
          title="Peek output"
        >
          <Eye size={10} />
          <span>Peek</span>
        </button>
      </div>
    </div>
  )
}

// ─── Group section ────────────────────────────────────────────────────────────

function GroupSection({ group, tasks }: { group: TaskGroup; tasks: Task[] }) {
  const contextByTaskId = usePipelineStore((s) => s.contextByTaskId)
  const groupExecutionOrder = useCanvasStore((s) => s.groupExecutionOrder)
  const nextTaskId = useCanvasStore((s) => s.nextTaskId)
  const orderList = groupExecutionOrder[group.id] ?? []
  const isRunning = group.status === 'running'
  const isPaused = group.status === 'paused'

  const handlePause = async () => {
    try {
      await window.api.pipeline.pauseGroup(group.id)
    } catch (err) {
      console.error('pauseGroup failed', err)
    }
  }

  const handleResume = async () => {
    try {
      await window.api.pipeline.resumeGroup(group.id)
    } catch (err) {
      console.error('resumeGroup failed', err)
    }
  }

  const handleDelete = async () => {
    if (!confirm(`Delete group "${group.title}"? Tasks will be unlinked but not deleted.`)) return
    try {
      await useCanvasStore.getState().deleteGroup(group.id)
    } catch (err) {
      console.error('deleteGroup failed', err)
    }
  }

  return (
    <div className="flex flex-col gap-2">
      {/* Group header */}
      <div
        className="flex items-center gap-2 px-3 py-2 rounded-lg"
        style={{
          background: 'var(--color-surface)',
          border: '1px solid var(--color-border)',
        }}
      >
        <span
          className="flex-1 min-w-0 text-[11px] font-semibold truncate"
          style={{ color: 'var(--color-text-primary)' }}
        >
          {group.title}
        </span>
        <StatusBadge status={group.status} />
        <button
          onClick={handleDelete}
          className="flex-shrink-0 p-1 rounded transition-all hover:opacity-80 active:scale-95"
          style={{
            color: 'var(--color-text-muted)',
          }}
          title="Delete group"
        >
          <Trash2 size={12} />
        </button>
      </div>

      {/* Task cards */}
      {tasks.length > 0 ? (
        <div className="flex flex-col gap-0 pl-2">
          {[...tasks]
            .sort((a, b) => {
              const ai = orderList.indexOf(a.id)
              const bi = orderList.indexOf(b.id)
              return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi)
            })
            .map((task, index, sortedTasks) => {
              const ctx = contextByTaskId[task.id]
              const seqIndex = orderList.indexOf(task.id)
              const seqNumber = seqIndex >= 0 ? seqIndex + 1 : null
              const isNext = task.id === nextTaskId
              const isLast = index === sortedTasks.length - 1
              const hasDeps = (task.dependencyIds ?? []).length > 0
              const depsAllDone = (task.dependencyIds ?? []).every(depId =>
                tasks.find(t => t.id === depId)?.status === 'done'
              )

              return (
                <div key={task.id} className="relative">
                  {/* Connector line from previous task */}
                  {index > 0 && (
                    <div
                      className="absolute left-[7px] -top-1 w-0.5 h-2"
                      style={{
                        backgroundColor: hasDeps && !depsAllDone
                          ? 'var(--color-accent-amber)'
                          : 'var(--color-accent-green)',
                        opacity: 0.5
                      }}
                    />
                  )}
                  {/* Connector dot */}
                  {sortedTasks.length > 1 && (
                    <div
                      className="absolute left-[4px] top-3 w-2 h-2 rounded-full"
                      style={{
                        backgroundColor: hasDeps && !depsAllDone
                          ? 'var(--color-accent-amber)'
                          : 'var(--color-accent-green)',
                        opacity: 0.6
                      }}
                    />
                  )}
                  {/* Connector line to next task */}
                  {!isLast && (
                    <div
                      className="absolute left-[7px] bottom-0 w-0.5 h-2"
                      style={{
                        backgroundColor: 'var(--color-accent-green)',
                        opacity: 0.3
                      }}
                    />
                  )}
                  <div className={sortedTasks.length > 1 ? 'ml-5 mb-2' : 'mb-2'}>
                    <TaskCard
                      task={task}
                      contextTokens={ctx?.tokens}
                      contextMax={ctx?.max}
                      seqNumber={seqNumber}
                      isNext={isNext}
                    />
                    {hasDeps && !depsAllDone && (
                      <div
                        className="text-[9px] mt-1 px-1.5 py-0.5 rounded inline-block"
                        style={{
                          color: 'var(--color-accent-amber)',
                          backgroundColor: 'color-mix(in srgb, var(--color-accent-amber) 10%, transparent)',
                        }}
                      >
                        Blocked by #{(() => {
                          const blockingTask = tasks.find(t => task.dependencyIds?.includes(t.id) && t.status !== 'done')
                          if (!blockingTask) return '?'
                          const blockIdx = orderList.indexOf(blockingTask.id)
                          return blockIdx >= 0 ? blockIdx + 1 : '?'
                        })()}
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
        </div>
      ) : (
        <p
          className="text-[11px] pl-2"
          style={{ color: 'var(--color-text-muted)' }}
        >
          No tasks in this group
        </p>
      )}

      {/* Group controls */}
      {(isRunning || isPaused) && (
        <div
          className="flex items-center gap-2 pt-1 px-1 pb-1 mt-1 border-t"
          style={{ borderColor: 'var(--color-border)' }}
        >
          {isRunning ? (
            <button
              onClick={handlePause}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded text-[10px] font-semibold tracking-wide transition-all hover:opacity-80 active:scale-95"
              style={{
                color: 'var(--color-accent-amber)',
                background: 'color-mix(in srgb, var(--color-accent-amber) 10%, transparent)',
                border: '1px solid color-mix(in srgb, var(--color-accent-amber) 25%, transparent)',
              }}
            >
              <PauseCircle size={12} />
              Pause Group
            </button>
          ) : (
            <button
              onClick={handleResume}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded text-[10px] font-semibold tracking-wide transition-all hover:opacity-80 active:scale-95"
              style={{
                color: 'var(--color-accent-green)',
                background: 'color-mix(in srgb, var(--color-accent-green) 10%, transparent)',
                border: '1px solid color-mix(in srgb, var(--color-accent-green) 25%, transparent)',
              }}
            >
              <PlayCircle size={12} />
              Resume Group
            </button>
          )}
        </div>
      )}
    </div>
  )
}

// ─── GroupTab ─────────────────────────────────────────────────────────────────

export function GroupTab() {
  const groups = useCanvasStore((s) => s.groups)
  const groupTasks = useCanvasStore((s) => s.groupTasks)

  // Show only active groups (not completed/archived)
  const activeGroups = groups.filter((g) => g.status !== 'completed')

  if (activeGroups.length === 0) {
    return (
      <div className="h-full flex items-center justify-center px-4">
        <p
          className="text-xs text-center"
          style={{ color: 'var(--color-text-muted)' }}
        >
          No active task groups
        </p>
      </div>
    )
  }

  return (
    <div
      className="flex flex-col gap-4 p-3 overflow-y-auto h-full"
      style={{ scrollbarWidth: 'thin', scrollbarColor: 'var(--color-border) transparent' }}
    >
      {activeGroups.map((group) => (
        <GroupSection
          key={group.id}
          group={group}
          tasks={groupTasks[group.id] ?? []}
        />
      ))}
    </div>
  )
}
