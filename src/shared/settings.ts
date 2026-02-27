import { STAGE_CONFIGS } from './constants'
import type { PipelineStage } from './types'
import type { ValidationHook } from './hook-types'

export const SETTING_KEYS = {
  GLOBAL_MODEL: 'ai.globalModel',
  WORKSHOP_MODEL: 'ai.workshopModel',
  STAGE_MODEL_PREFIX: 'ai.stage.model.',
  STAGE_MAX_TURNS_PREFIX: 'pipeline.maxTurns.',
  STAGE_TIMEOUT_PREFIX: 'pipeline.timeout.',
  STAGE_AUTO_APPROVE_PREFIX: 'pipeline.autoApprove.',
  UI_ACTIVITY_FEED: 'ui.activityFeedDefault',
  UI_DENSITY: 'ui.density',
  UI_FONT_SIZE: 'ui.fontSize',
  'usage.autoPauseThreshold': 'usage.autoPauseThreshold',
  'usage.autoResume': 'usage.autoResume',
  'usage.monitorEnabled': 'usage.monitorEnabled',
  HOOK_PRE_PREFIX: 'pipeline.hooks.pre.',
  HOOK_POST_PREFIX: 'pipeline.hooks.post.',
  HOOK_PRESET: 'pipeline.hooks.preset',
} as const

export type ModelOption = 'claude-opus-4-6' | 'claude-sonnet-4-6' | 'claude-haiku-4-5-20251001'

export const MODEL_OPTIONS: { value: ModelOption; label: string }[] = [
  { value: 'claude-opus-4-6', label: 'Claude Opus 4.6' },
  { value: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6' },
  { value: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5' },
]

export type UIDensity = 'comfortable' | 'compact'
export type UIFontSize = 'small' | 'medium' | 'large'

export interface SettingsState {
  globalModel: ModelOption
  workshopModel: ModelOption
  stageModels: Partial<Record<PipelineStage, ModelOption>>
  stageMaxTurns: Partial<Record<PipelineStage, number>>
  stageTimeouts: Partial<Record<PipelineStage, number>>
  stageAutoApprove: Partial<Record<PipelineStage, number | null>>
  activityFeedDefault: boolean
  density: UIDensity
  fontSize: UIFontSize
  autoPauseThreshold: number
  autoResume: boolean
  usageMonitorEnabled: boolean
  hookPreset: string | null
  hooks: Record<string, ValidationHook[]>
}

export const DEFAULT_SETTINGS: SettingsState = {
  globalModel: 'claude-opus-4-6',
  workshopModel: 'claude-sonnet-4-6',
  stageModels: {},
  stageMaxTurns: {},
  stageTimeouts: {},
  stageAutoApprove: {},
  activityFeedDefault: true,
  density: 'comfortable',
  fontSize: 'medium',
  autoPauseThreshold: 95,
  autoResume: false,
  usageMonitorEnabled: true,
  hookPreset: null,
  hooks: {},
}

export function getEffectiveModel(stage: PipelineStage, settings: SettingsState): string {
  return settings.stageModels[stage] ?? settings.globalModel
}

export function getEffectiveMaxTurns(stage: PipelineStage, settings: SettingsState): number {
  return settings.stageMaxTurns[stage] ?? STAGE_CONFIGS[stage].maxTurns
}

export function getEffectiveTimeout(stage: PipelineStage, settings: SettingsState): number {
  return settings.stageTimeouts[stage] ?? STAGE_CONFIGS[stage].timeoutMs
}

export function getEffectiveAutoApprove(stage: PipelineStage, settings: SettingsState): number | null {
  const override = settings.stageAutoApprove[stage]
  if (override !== undefined) return override
  return STAGE_CONFIGS[stage].autoApproveThreshold
}
