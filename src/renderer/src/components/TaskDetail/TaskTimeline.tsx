import type { Task, PipelineStage } from '../../../../shared/types'
import { TIER_STAGES, STATUS_TO_STAGE } from '../../../../shared/constants'

const STAGE_LABELS: Record<PipelineStage, string> = {
  brainstorm: 'Brainstorm',
  design_review: 'Design Review',
  plan: 'Plan',
  implement: 'Implement',
  code_review: 'Code Review',
  verify: 'Verify',
  done: 'Done'
}

function getCompletedStages(task: Task): Set<PipelineStage> {
  const completed = new Set<PipelineStage>()
  for (const h of task.handoffs) {
    if (h.status === 'completed') completed.add(h.stage)
  }
  if (task.status === 'done') completed.add('done')
  return completed
}

function getCurrentStage(task: Task): PipelineStage | null {
  if (task.status === 'backlog' || task.status === 'done') return null
  return STATUS_TO_STAGE[task.status] ?? null
}

function getTimestamp(task: Task, stage: PipelineStage): string | null {
  const handoff = task.handoffs.find(h => h.stage === stage && h.status === 'completed')
  if (handoff) return new Date(handoff.timestamp).toLocaleDateString()
  if (stage === 'done' && task.completedAt) return new Date(task.completedAt).toLocaleDateString()
  return null
}

export function TaskTimeline({ task }: { task: Task }) {
  const stages = TIER_STAGES[task.tier].filter(s => s !== 'done')
  const allStages = [...stages, 'done' as PipelineStage]
  const completed = getCompletedStages(task)
  const current = getCurrentStage(task)

  return (
    <div className="w-full py-6 px-4">
      <div className="flex items-center justify-between relative">
        {allStages.map((stage, i) => {
          const isCompleted = completed.has(stage)
          const isCurrent = stage === current
          const isLast = i === allStages.length - 1
          const timestamp = getTimestamp(task, stage)

          return (
            <div key={stage} className="flex items-center flex-1 last:flex-none">
              {/* Stage node */}
              <div className="flex flex-col items-center relative z-10">
                <div
                  className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${
                    isCompleted
                      ? 'bg-accent-green border-accent-green'
                      : isCurrent
                        ? 'bg-accent-cyan border-accent-cyan animate-pulse'
                        : 'bg-transparent border-border'
                  }`}
                >
                  {isCompleted && (
                    <svg className="w-3 h-3 text-bg" fill="currentColor" viewBox="0 0 20 20">
                      <path
                        fillRule="evenodd"
                        d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                        clipRule="evenodd"
                      />
                    </svg>
                  )}
                </div>
                <span className="text-xs text-text-secondary mt-2 whitespace-nowrap">
                  {STAGE_LABELS[stage]}
                </span>
                {timestamp && (
                  <span className="text-[10px] text-text-muted mt-0.5">{timestamp}</span>
                )}
              </div>

              {/* Connecting line */}
              {!isLast && (
                <div
                  className={`flex-1 h-0.5 mx-1 mt-[-1.5rem] ${
                    isCompleted
                      ? 'bg-accent-green'
                      : isCurrent
                        ? 'border-t-2 border-dashed border-accent-cyan bg-transparent'
                        : 'bg-border'
                  }`}
                />
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
