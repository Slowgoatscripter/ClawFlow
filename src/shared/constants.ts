import type { PipelineStage, StageConfig, Tier } from './types'

export const TIER_STAGES: Record<Tier, PipelineStage[]> = {
  L1: ['plan', 'implement', 'done'],
  L2: ['brainstorm', 'plan', 'implement', 'verify', 'done'],
  L3: ['brainstorm', 'design_review', 'plan', 'implement', 'code_review', 'verify', 'done']
}

export const STAGE_CONFIGS: Record<PipelineStage, StageConfig> = {
  brainstorm: {
    stage: 'brainstorm',
    skill: 'brainstorming',
    model: 'claude-opus-4-6',
    maxTurns: 50,
    timeoutMs: 900000,
    pauses: true,
    autoApproveThreshold: null,
    template: 'brainstorm-agent.md'
  },
  design_review: {
    stage: 'design_review',
    skill: 'design-review',
    model: 'claude-opus-4-6',
    maxTurns: 60,
    timeoutMs: 1200000,
    pauses: true,
    autoApproveThreshold: null,
    template: 'design-review-agent.md'
  },
  plan: {
    stage: 'plan',
    skill: 'writing-plans',
    model: 'claude-opus-4-6',
    maxTurns: 30,
    timeoutMs: 600000,
    pauses: true,
    autoApproveThreshold: 4.0,
    template: 'plan-agent.md'
  },
  implement: {
    stage: 'implement',
    skill: 'test-driven-development',
    model: 'claude-opus-4-6',
    maxTurns: 100,
    timeoutMs: 1800000,
    pauses: false,
    autoApproveThreshold: null,
    template: 'implement-agent.md'
  },
  code_review: {
    stage: 'code_review',
    skill: 'requesting-code-review',
    model: 'claude-sonnet-4-6',
    maxTurns: 20,
    timeoutMs: 600000,
    pauses: true,
    autoApproveThreshold: 4.0,
    template: 'code-review-agent.md'
  },
  verify: {
    stage: 'verify',
    skill: 'verification-before-completion',
    model: 'claude-sonnet-4-6',
    maxTurns: 15,
    timeoutMs: 300000,
    pauses: false,
    autoApproveThreshold: null,
    template: 'verify-agent.md'
  },
  done: {
    stage: 'done',
    skill: 'finishing-a-development-branch',
    model: 'claude-sonnet-4-6',
    maxTurns: 10,
    timeoutMs: 300000,
    pauses: true,
    autoApproveThreshold: null,
    template: 'completion-agent.md'
  }
}

export const CIRCUIT_BREAKER_LIMIT = 3

export const STATUS_TO_STAGE: Record<string, PipelineStage> = {
  brainstorming: 'brainstorm',
  design_review: 'design_review',
  planning: 'plan',
  implementing: 'implement',
  code_review: 'code_review',
  verifying: 'verify',
  done: 'done'
}

export const STAGE_TO_STATUS: Record<PipelineStage, string> = {
  brainstorm: 'brainstorming',
  design_review: 'design_review',
  plan: 'planning',
  implement: 'implementing',
  code_review: 'code_review',
  verify: 'verifying',
  done: 'done'
}

/** DB fields to clear when restarting from each stage */
export const STAGE_CLEAR_FIELDS: Record<string, string[]> = {
  brainstorm: ['brainstormOutput'],
  design_review: ['designReview'],
  plan: ['plan', 'planReviewCount'],
  implement: ['implementationNotes', 'commitHash'],
  code_review: ['reviewComments', 'reviewScore', 'implReviewCount'],
  verify: ['testResults', 'verifyResult'],
  done: ['completedAt']
}

/**
 * Returns the DB update payload to clear all stage fields at and after targetStage
 * for the given tier's stage sequence.
 */
export function getClearFieldsPayload(
  tier: 'L1' | 'L2' | 'L3',
  targetStage: string
): Record<string, null | number | never[]> {
  const stages = TIER_STAGES[tier]
  const targetIndex = stages.indexOf(targetStage as PipelineStage)
  if (targetIndex === -1) return {}

  const payload: Record<string, null | number | never[]> = {}

  for (let i = targetIndex; i < stages.length; i++) {
    const stage = stages[i]
    const fields = STAGE_CLEAR_FIELDS[stage]
    if (!fields) continue
    for (const field of fields) {
      // Reset counters to 0, everything else to null
      if (field.endsWith('Count')) {
        payload[field] = 0
      } else {
        payload[field] = null
      }
    }
  }

  // Always clear these on any restart
  payload['activeSessionId'] = null
  payload['richHandoff'] = null
  payload['currentAgent'] = null
  payload['todos'] = null
  payload['handoffs'] = []

  return payload
}
