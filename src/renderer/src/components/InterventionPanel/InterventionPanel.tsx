import type { Task } from '../../../../shared/types'
import { isCircuitBreakerTripped } from '../../../../shared/pipeline-rules'
import { PlanReviewGate } from './PlanReviewGate'
import { CodeReviewGate } from './CodeReviewGate'
import { CircuitBreakerPanel } from './CircuitBreakerPanel'
import { OpenQuestionsPanel } from './OpenQuestionsPanel'

interface Props {
  task: Task
}

export function InterventionPanel({ task }: Props) {
  // 1. Circuit breaker takes highest priority
  if (isCircuitBreakerTripped(task)) {
    return (
      <div className="bg-surface border border-accent-gold rounded-lg p-6 my-4">
        <CircuitBreakerPanel task={task} />
      </div>
    )
  }

  // 2. Open questions from last handoff
  if (task.handoffs.length > 0) {
    const lastHandoff = task.handoffs[task.handoffs.length - 1]
    const questions = lastHandoff.openQuestions
    if (questions && questions !== 'none' && questions.trim() !== '') {
      return (
        <div className="bg-surface border border-accent-gold rounded-lg p-6 my-4">
          <OpenQuestionsPanel task={task} />
        </div>
      )
    }
  }

  // 3. Plan review gate
  if (task.status === 'planning' || task.status === 'design_review') {
    return (
      <div className="bg-surface border border-accent-gold rounded-lg p-6 my-4">
        <PlanReviewGate task={task} />
      </div>
    )
  }

  // 4. Code review gate
  if (task.status === 'code_review') {
    return (
      <div className="bg-surface border border-accent-gold rounded-lg p-6 my-4">
        <CodeReviewGate task={task} />
      </div>
    )
  }

  // 5. No intervention needed
  return null
}
