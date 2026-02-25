import type { PipelineStage, Task, Tier } from './types'
import { TIER_STAGES, CIRCUIT_BREAKER_LIMIT } from './constants'

export interface TransitionResult {
  allowed: boolean
  nextStage: PipelineStage | null
  reason: string
}

export function getNextStage(tier: Tier, currentStage: PipelineStage): PipelineStage | null {
  const stages = TIER_STAGES[tier]
  const currentIndex = stages.indexOf(currentStage)
  if (currentIndex === -1 || currentIndex === stages.length - 1) return null
  return stages[currentIndex + 1]
}

export function getFirstStage(tier: Tier): PipelineStage {
  return TIER_STAGES[tier][0]
}

export function canTransition(task: Task, targetStage: PipelineStage): TransitionResult {
  const stages = TIER_STAGES[task.tier]

  if (!stages.includes(targetStage)) {
    return { allowed: false, nextStage: null, reason: `Stage ${targetStage} is not part of tier ${task.tier}` }
  }

  if (targetStage === 'plan' && task.planReviewCount >= CIRCUIT_BREAKER_LIMIT) {
    return { allowed: false, nextStage: null, reason: `Circuit breaker: plan rejected ${task.planReviewCount} times` }
  }
  if (targetStage === 'implement' && task.implReviewCount >= CIRCUIT_BREAKER_LIMIT) {
    return { allowed: false, nextStage: null, reason: `Circuit breaker: implementation rejected ${task.implReviewCount} times` }
  }

  return { allowed: true, nextStage: targetStage, reason: 'ok' }
}

export function shouldAutoApprove(stage: PipelineStage, score: number | null, autoMode: boolean): boolean {
  if (!autoMode) return false
  if (score === null) return false

  const thresholds: Partial<Record<PipelineStage, number>> = {
    plan: 4.0,
    code_review: 4.0
  }

  const threshold = thresholds[stage]
  if (!threshold) return false
  return score >= threshold
}

export function isCircuitBreakerTripped(task: Task): boolean {
  return task.planReviewCount >= CIRCUIT_BREAKER_LIMIT || task.implReviewCount >= CIRCUIT_BREAKER_LIMIT
}
