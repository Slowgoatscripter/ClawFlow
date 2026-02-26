import type { Task } from '../../../shared/types'
import { STATUS_TO_STAGE } from '../../../shared/constants'

/**
 * Derive "awaiting review" from persisted handoff data.
 * A task is awaiting review if the last handoff matches the current stage,
 * completed successfully, and has no open questions.
 * This supplements the ephemeral event-based flag so the gate survives
 * app restarts and navigation.
 */
export function isAwaitingReviewFromHandoffs(task: Task): boolean {
  if (task.handoffs.length === 0) return false
  const currentStage = STATUS_TO_STAGE[task.status]
  if (!currentStage) return false
  const lastHandoff = task.handoffs[task.handoffs.length - 1]
  if (lastHandoff.stage !== currentStage) return false
  if (lastHandoff.status !== 'completed') return false
  const q = lastHandoff.openQuestions
  if (q && q !== 'none' && q.trim() !== '') return false
  return true
}
