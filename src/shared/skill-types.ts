export interface SkillInfo {
  name: string
  hasCore: boolean
  hasExtended: boolean
  coreTokenEstimate: number
  extendedTokenEstimate: number
}

export const STAGE_SKILL_MAP: Record<string, string> = {
  brainstorm: 'brainstorming',
  design_review: 'design-review',
  plan: 'writing-plans',
  implement: 'test-driven-development',
  code_review: 'code-review',
  verify: 'verification',
  done: 'completion'
}
