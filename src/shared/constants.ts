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
    pauses: true,
    autoApproveThreshold: null,
    template: 'brainstorm-agent.md'
  },
  design_review: {
    stage: 'design_review',
    skill: 'design-review',
    model: 'claude-opus-4-6',
    maxTurns: 40,
    pauses: true,
    autoApproveThreshold: null,
    template: 'design-review-agent.md'
  },
  plan: {
    stage: 'plan',
    skill: 'writing-plans',
    model: 'claude-opus-4-6',
    maxTurns: 30,
    pauses: true,
    autoApproveThreshold: 4.0,
    template: 'plan-agent.md'
  },
  implement: {
    stage: 'implement',
    skill: 'test-driven-development',
    model: 'claude-opus-4-6',
    maxTurns: 100,
    pauses: false,
    autoApproveThreshold: null,
    template: 'implement-agent.md'
  },
  code_review: {
    stage: 'code_review',
    skill: 'requesting-code-review',
    model: 'claude-sonnet-4-6',
    maxTurns: 20,
    pauses: true,
    autoApproveThreshold: 4.0,
    template: 'code-review-agent.md'
  },
  verify: {
    stage: 'verify',
    skill: 'verification-before-completion',
    model: 'claude-sonnet-4-6',
    maxTurns: 15,
    pauses: false,
    autoApproveThreshold: null,
    template: 'verify-agent.md'
  },
  done: {
    stage: 'done',
    skill: 'finishing-a-development-branch',
    model: 'claude-sonnet-4-6',
    maxTurns: 10,
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
