import type { Task } from '../../../../shared/types'
import { isCircuitBreakerTripped } from '../../../../shared/pipeline-rules'
import { usePipelineStore } from '../../stores/pipelineStore'
import { isAwaitingReviewFromHandoffs } from '../../utils/taskHelpers'
import { PlanReviewGate } from './PlanReviewGate'
import { CodeReviewGate } from './CodeReviewGate'
import { CompletionReviewGate } from './CompletionReviewGate'
import { CircuitBreakerPanel } from './CircuitBreakerPanel'
import { OpenQuestionsPanel } from './OpenQuestionsPanel'
import { FDRLSection } from './FDRLSection'

interface Props {
  task: Task
}

export function InterventionPanel({ task }: Props) {
  const awaitingReviewEvent = usePipelineStore((s) => s.awaitingReview[task.id] ?? false)
  const streaming = usePipelineStore((s) => s.streaming)
  const activeTaskId = usePipelineStore((s) => s.activeTaskId)
  const isStreamingThisTask = streaming && activeTaskId === task.id

  // Combine ephemeral event flag with persistent handoff-derived state
  const awaitingReview = awaitingReviewEvent || isAwaitingReviewFromHandoffs(task)

  // 1. Circuit breaker takes highest priority
  if (isCircuitBreakerTripped(task)) {
    return (
      <div className="bg-surface/80 backdrop-blur-md border border-accent-amber/40 rounded-lg p-6 my-4">
        <CircuitBreakerPanel task={task} />
        <FDRLSection taskId={task.id} />
      </div>
    )
  }

  // 2. Open questions from last handoff
  if (task.handoffs.length > 0) {
    const lastHandoff = task.handoffs[task.handoffs.length - 1]
    const questions = lastHandoff.openQuestions
    if (questions && questions !== 'none' && questions.trim() !== '' && !isStreamingThisTask) {
      return (
        <div className="bg-surface/80 backdrop-blur-md border border-accent-amber/40 rounded-lg p-6 my-4">
          <OpenQuestionsPanel task={task} />
        </div>
      )
    }
  }

  // 3. Plan/brainstorm review gate — show when agent is done AND awaiting review
  if ((task.status === 'brainstorming' || task.status === 'planning' || task.status === 'design_review') && awaitingReview && !isStreamingThisTask) {
    return (
      <div className="bg-surface/80 backdrop-blur-md border border-accent-amber/40 rounded-lg p-6 my-4">
        <PlanReviewGate task={task} />
      </div>
    )
  }

  // 4. Code review gate — same pattern
  if (task.status === 'code_review' && awaitingReview && !isStreamingThisTask) {
    return (
      <div className="bg-surface/80 backdrop-blur-md border border-accent-amber/40 rounded-lg p-6 my-4">
        <CodeReviewGate task={task} />
      </div>
    )
  }

  // 5. Completion review gate — task finished, approve or send back
  if (task.status === 'done' && awaitingReview && !isStreamingThisTask) {
    return (
      <div className="bg-surface/80 backdrop-blur-md border border-accent-green/40 rounded-lg p-6 my-4">
        <CompletionReviewGate task={task} />
      </div>
    )
  }

  // 6. No intervention needed
  return null
}
