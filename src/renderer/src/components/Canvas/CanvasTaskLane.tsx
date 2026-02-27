import type { Task } from '../../../../shared/types'
import { getTaskStages } from '../../../../shared/constants'
import { STAGE_TO_STATUS } from '../../../../shared/constants'
import { useLayoutStore } from '../../stores/layoutStore'
import { CanvasStageCard } from './CanvasStageCard'
import { CanvasTimeline } from './CanvasTimeline'

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

  const handleClick = () => {
    useLayoutStore.getState().openTaskDetail(task.id)
  }

  const content = (
    <div className="flex flex-col gap-1 min-w-[160px] cursor-pointer" onClick={handleClick}>
      <div className="flex items-center justify-between gap-2 mb-0.5">
        <span
          className="text-xs font-medium truncate"
          style={{ color: 'var(--color-text-primary)' }}
        >
          {task.title}
        </span>
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

      <CanvasTimeline taskId={task.id} />
    </div>
  )

  if (standalone) {
    return (
      <div
        className="p-3 rounded-lg"
        style={{
          backgroundColor: 'var(--color-elevated)',
          border: '1px solid var(--color-border)'
        }}
      >
        {content}
      </div>
    )
  }

  return <div className="p-2">{content}</div>
}
