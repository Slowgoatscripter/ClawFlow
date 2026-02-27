import type { PipelineStage } from '../shared/types'

// Estimated token budget per stage based on maxTurns and typical usage
const STAGE_BUDGETS: Record<PipelineStage, number> = {
  brainstorm: 15_000,
  design_review: 20_000,
  plan: 10_000,
  implement: 60_000,
  code_review: 15_000,
  verify: 10_000,
  done: 5_000,
}

const SAFETY_MARGIN = 1.2 // 20% safety margin

export interface ContextBudgetCheck {
  canContinue: boolean
  currentUsage: number
  contextMax: number
  estimatedNeed: number
  remainingContext: number
  usagePercent: number
}

export function checkContextBudget(
  currentUsage: number,
  contextMax: number,
  nextStage: PipelineStage
): ContextBudgetCheck {
  const estimatedNeed = (STAGE_BUDGETS[nextStage] ?? 15_000) * SAFETY_MARGIN
  const remainingContext = contextMax - currentUsage
  const canContinue = remainingContext >= estimatedNeed
  const usagePercent = Math.round((currentUsage / contextMax) * 100)

  return { canContinue, currentUsage, contextMax, estimatedNeed, remainingContext, usagePercent }
}
