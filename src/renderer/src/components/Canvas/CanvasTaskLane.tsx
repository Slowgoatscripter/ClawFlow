import type { Task } from '../../../../shared/types'
import { getTaskStages } from '../../../../shared/constants'
import { STAGE_TO_STATUS } from '../../../../shared/constants'
import { useLayoutStore } from '../../stores/layoutStore'
import { useCanvasStore } from '../../stores/canvasStore'
import { usePipelineStore } from '../../stores/pipelineStore'
import { hasOpenQuestions, isAwaitingReviewFromHandoffs } from '../../utils/taskHelpers'
import { CanvasStageCard } from './CanvasStageCard'
import { CanvasTimeline } from './CanvasTimeline'
import { CanvasTodoStrip } from './CanvasTodoStrip'

interface CanvasTaskLaneProps {
  task: Task
  standalone?: boolean
}

function getStageStatus(
  stage: string,
  taskStatus: string,
  stages: string[]
): 'completed' | 'active' | 'pending' {
  const currentStatusStage = Object.entries(STAGE_TO_STATUS).find(
    ([, status]) => status === taskStatus
  )?.[0]

  if (!currentStatusStage) {
    // For statuses like 'backlog', 'blocked', 'paused' - all stages are pending
    return 'pending'
  }

  const stageIndex = stages.indexOf(stage)
  const currentIndex = stages.indexOf(currentStatusStage)

  if (currentIndex === -1) return 'pending'
  if (stageIndex < currentIndex) return 'completed'
  if (stageIndex === currentIndex) return 'active'
  return 'pending'
}

export function CanvasTaskLane({ task, standalone = false }: CanvasTaskLaneProps) {
  const stages = getTaskStages(task.tier, !!task.groupId)

  const hasTodos = usePipelineStore(
    (s) => !!s.todosByTaskId[task.id] && Object.keys(s.todosByTaskId[task.id]).length > 0
  )

  const executionOrder = useCanvasStore((s) => s.executionOrder)
  const groupExecutionOrder = useCanvasStore((s) => s.groupExecutionOrder)
  const nextTaskId = useCanvasStore((s) => s.nextTaskId)

  const orderList = task.groupId != null
    ? (groupExecutionOrder[task.groupId] ?? [])
    : executionOrder
  const seqIndex = orderList.indexOf(task.id)
  const seqNumber = seqIndex >= 0 ? seqIndex + 1 : null

  const awaitingReviewEvent = usePipelineStore((s) => s.awaitingReview[task.id] ?? false)
  const needsApproval = awaitingReviewEvent || isAwaitingReviewFromHandoffs(task)
  const hasQuestions = hasOpenQuestions(task)

  const isNext = task.id === nextTaskId
  const isRunning = ['brainstorming', 'design_review', 'planning', 'implementing', 'code_review', 'verifying'].includes(task.status)
  const isBlocked = task.status === 'blocked'
  const isDone = task.status === 'done'

  const indicatorColor = hasQuestions
    ? 'var(--color-accent-magenta)'
    : needsApproval
      ? 'var(--color-accent-amber)'
      : null

  const handleClick = () => {
    useLayoutStore.getState().openTaskDetail(task.id)
  }

  const content = (
    <div className="flex flex-col gap-1 min-w-[160px] cursor-pointer" onClick={handleClick}>
      <div className="flex items-center justify-between gap-2 mb-0.5">
        <div className="flex items-center gap-1.5 min-w-0">
          {seqNumber != null && !isDone && (
            <span
              className="flex-shrink-0 text-[9px] font-bold w-4 h-4 flex items-center justify-center rounded"
              style={{
                backgroundColor: isRunning
                  ? 'color-mix(in srgb, var(--color-accent-cyan) 20%, transparent)'
                  : isBlocked
                    ? 'color-mix(in srgb, var(--color-text-muted) 15%, transparent)'
                    : 'color-mix(in srgb, var(--color-text-primary) 15%, transparent)',
                color: isRunning
                  ? 'var(--color-accent-cyan)'
                  : isBlocked
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
          {hasQuestions && (
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
          {needsApproval && !hasQuestions && (
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
          <span
            className="text-xs font-medium truncate"
            style={{ color: 'var(--color-text-primary)' }}
          >
            {task.title}
          </span>
        </div>
        {task.currentAgent && (
          <span
            className="text-[10px] px-1.5 py-0.5 rounded-full shrink-0"
            style={{
              backgroundColor: 'var(--color-accent-cyan)22',
              color: 'var(--color-accent-cyan)'
            }}
          >
            {task.currentAgent}
          </span>
        )}
      </div>

      <div className="flex flex-col gap-0.5">
        {stages.map((stage) => (
          <CanvasStageCard
            key={stage}
            stage={stage}
            status={getStageStatus(stage, task.status, stages)}
          />
        ))}
      </div>

      {hasTodos && <CanvasTodoStrip taskId={task.id} />}

      <CanvasTimeline taskId={task.id} />
    </div>
  )

  if (standalone) {
    return (
      <div
        data-task-id={task.id}
        className="p-3 rounded-lg"
        style={{
          backgroundColor: 'var(--color-elevated)',
          border: indicatorColor
            ? `1px solid color-mix(in srgb, ${indicatorColor} 50%, transparent)`
            : '1px solid var(--color-border)',
          boxShadow: indicatorColor
            ? `0 0 8px color-mix(in srgb, ${indicatorColor} 15%, transparent)`
            : undefined,
        }}
      >
        {content}
      </div>
    )
  }

  return <div data-task-id={task.id} className="p-2">{content}</div>
}
