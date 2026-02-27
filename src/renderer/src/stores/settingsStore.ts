import { create } from 'zustand'
import {
  SETTING_KEYS,
  DEFAULT_SETTINGS,
  type SettingsState,
  type ModelOption,
  type UIDensity,
  type UIFontSize,
} from '../../../shared/settings'
import type { PipelineStage } from '../../../shared/types'
import type { ValidationHook } from '../../../shared/hook-types'

interface SettingsStore extends SettingsState {
  settingsModalOpen: boolean

  // Modal
  openSettingsModal: () => void
  closeSettingsModal: () => void

  // Load
  loadGlobalSettings: () => Promise<void>
  loadProjectSettings: (dbPath: string) => Promise<void>

  // AI model setters
  setGlobalModel: (model: ModelOption) => Promise<void>
  setWorkshopModel: (model: ModelOption) => Promise<void>
  setStageModel: (stage: PipelineStage, model: ModelOption | null) => Promise<void>

  // Pipeline per-stage setters
  setStageMaxTurns: (stage: PipelineStage, turns: number | null) => Promise<void>
  setStageTimeout: (stage: PipelineStage, ms: number | null) => Promise<void>
  setStageAutoApprove: (stage: PipelineStage, threshold: number | null) => Promise<void>

  // UI setters
  setActivityFeedDefault: (open: boolean) => Promise<void>
  setDensity: (density: UIDensity) => Promise<void>
  setFontSize: (size: UIFontSize) => Promise<void>

  // Hook setters
  setHookPreset: (preset: string | null, projectDbPath: string) => Promise<void>
  setHooks: (hooks: Record<string, ValidationHook[]>, projectDbPath: string) => Promise<void>

  // Reset
  resetToDefaults: () => Promise<void>
}

/**
 * Parse a flat key-value record from IPC into a SettingsState partial.
 * Handles both exact keys and prefix-keyed stage maps.
 */
function parseSettingsRecord(
  record: Record<string, string>
): Partial<SettingsState> {
  const partial: Partial<SettingsState> = {}

  const stageModels: Partial<Record<PipelineStage, ModelOption>> = {}
  const stageMaxTurns: Partial<Record<PipelineStage, number>> = {}
  const stageTimeouts: Partial<Record<PipelineStage, number>> = {}
  const stageAutoApprove: Partial<Record<PipelineStage, number | null>> = {}

  for (const [key, value] of Object.entries(record)) {
    if (key === SETTING_KEYS.GLOBAL_MODEL) {
      partial.globalModel = value as ModelOption
    } else if (key === SETTING_KEYS.WORKSHOP_MODEL) {
      partial.workshopModel = value as ModelOption
    } else if (key.startsWith(SETTING_KEYS.STAGE_MODEL_PREFIX)) {
      const stage = key.slice(SETTING_KEYS.STAGE_MODEL_PREFIX.length) as PipelineStage
      stageModels[stage] = value as ModelOption
    } else if (key.startsWith(SETTING_KEYS.STAGE_MAX_TURNS_PREFIX)) {
      const stage = key.slice(SETTING_KEYS.STAGE_MAX_TURNS_PREFIX.length) as PipelineStage
      stageMaxTurns[stage] = Number(value)
    } else if (key.startsWith(SETTING_KEYS.STAGE_TIMEOUT_PREFIX)) {
      const stage = key.slice(SETTING_KEYS.STAGE_TIMEOUT_PREFIX.length) as PipelineStage
      stageTimeouts[stage] = Number(value)
    } else if (key.startsWith(SETTING_KEYS.STAGE_AUTO_APPROVE_PREFIX)) {
      const stage = key.slice(SETTING_KEYS.STAGE_AUTO_APPROVE_PREFIX.length) as PipelineStage
      stageAutoApprove[stage] = value === 'null' ? null : Number(value)
    } else if (key === SETTING_KEYS.UI_ACTIVITY_FEED) {
      partial.activityFeedDefault = value === 'true'
    } else if (key === SETTING_KEYS.UI_DENSITY) {
      partial.density = value as UIDensity
    } else if (key === SETTING_KEYS.UI_FONT_SIZE) {
      partial.fontSize = value as UIFontSize
    } else if (key === SETTING_KEYS.HOOK_PRESET) {
      partial.hookPreset = value === 'null' ? null : value
    } else if (key.startsWith(SETTING_KEYS.HOOK_PRE_PREFIX) || key.startsWith(SETTING_KEYS.HOOK_POST_PREFIX)) {
      try {
        const hooks = partial.hooks ?? {}
        // Determine the stage key: e.g. "pipeline.hooks.pre.implement" → "pre.implement"
        let stageKey: string
        if (key.startsWith(SETTING_KEYS.HOOK_PRE_PREFIX)) {
          stageKey = 'pre.' + key.slice(SETTING_KEYS.HOOK_PRE_PREFIX.length)
        } else {
          stageKey = 'post.' + key.slice(SETTING_KEYS.HOOK_POST_PREFIX.length)
        }
        hooks[stageKey] = JSON.parse(value) as ValidationHook[]
        partial.hooks = hooks
      } catch {
        // ignore malformed hook JSON
      }
    }
  }

  if (Object.keys(stageModels).length > 0) partial.stageModels = stageModels
  if (Object.keys(stageMaxTurns).length > 0) partial.stageMaxTurns = stageMaxTurns
  if (Object.keys(stageTimeouts).length > 0) partial.stageTimeouts = stageTimeouts
  if (Object.keys(stageAutoApprove).length > 0) partial.stageAutoApprove = stageAutoApprove

  return partial
}

export const useSettingsStore = create<SettingsStore>((set, get) => ({
  // --- Default state ---
  ...DEFAULT_SETTINGS,
  settingsModalOpen: false,

  // --- Modal ---
  openSettingsModal: () => set({ settingsModalOpen: true }),
  closeSettingsModal: () => set({ settingsModalOpen: false }),

  // --- Load ---
  loadGlobalSettings: async () => {
    const record = await window.api.settings.getAllGlobal()
    const parsed = parseSettingsRecord(record)
    set({ ...DEFAULT_SETTINGS, ...parsed })
  },

  loadProjectSettings: async (dbPath: string) => {
    // Load global first, then overlay project overrides
    const globalRecord = await window.api.settings.getAllGlobal()
    const globalParsed = parseSettingsRecord(globalRecord)

    const projectRecord = await window.api.settings.getAllProject(dbPath)
    const projectParsed = parseSettingsRecord(projectRecord)

    // Merge: defaults → global → project, deep-merging the partial record maps
    const merged: Partial<SettingsState> = {
      ...DEFAULT_SETTINGS,
      ...globalParsed,
      ...projectParsed,
      stageModels: {
        ...DEFAULT_SETTINGS.stageModels,
        ...(globalParsed.stageModels ?? {}),
        ...(projectParsed.stageModels ?? {}),
      },
      stageMaxTurns: {
        ...DEFAULT_SETTINGS.stageMaxTurns,
        ...(globalParsed.stageMaxTurns ?? {}),
        ...(projectParsed.stageMaxTurns ?? {}),
      },
      stageTimeouts: {
        ...DEFAULT_SETTINGS.stageTimeouts,
        ...(globalParsed.stageTimeouts ?? {}),
        ...(projectParsed.stageTimeouts ?? {}),
      },
      stageAutoApprove: {
        ...DEFAULT_SETTINGS.stageAutoApprove,
        ...(globalParsed.stageAutoApprove ?? {}),
        ...(projectParsed.stageAutoApprove ?? {}),
      },
    }

    set(merged as SettingsStore)
  },

  // --- AI model setters ---
  setGlobalModel: async (model: ModelOption) => {
    await window.api.settings.setGlobal(SETTING_KEYS.GLOBAL_MODEL, model)
    set({ globalModel: model })
  },

  setWorkshopModel: async (model: ModelOption) => {
    await window.api.settings.setGlobal(SETTING_KEYS.WORKSHOP_MODEL, model)
    set({ workshopModel: model })
  },

  setStageModel: async (stage: PipelineStage, model: ModelOption | null) => {
    const key = `${SETTING_KEYS.STAGE_MODEL_PREFIX}${stage}`
    if (model === null) {
      await window.api.settings.deleteGlobal(key)
      set((state) => {
        const updated = { ...state.stageModels }
        delete updated[stage]
        return { stageModels: updated }
      })
    } else {
      await window.api.settings.setGlobal(key, model)
      set((state) => ({
        stageModels: { ...state.stageModels, [stage]: model },
      }))
    }
  },

  // --- Pipeline per-stage setters ---
  setStageMaxTurns: async (stage: PipelineStage, turns: number | null) => {
    const key = `${SETTING_KEYS.STAGE_MAX_TURNS_PREFIX}${stage}`
    if (turns === null) {
      await window.api.settings.deleteGlobal(key)
      set((state) => {
        const updated = { ...state.stageMaxTurns }
        delete updated[stage]
        return { stageMaxTurns: updated }
      })
    } else {
      await window.api.settings.setGlobal(key, String(turns))
      set((state) => ({
        stageMaxTurns: { ...state.stageMaxTurns, [stage]: turns },
      }))
    }
  },

  setStageTimeout: async (stage: PipelineStage, ms: number | null) => {
    const key = `${SETTING_KEYS.STAGE_TIMEOUT_PREFIX}${stage}`
    if (ms === null) {
      await window.api.settings.deleteGlobal(key)
      set((state) => {
        const updated = { ...state.stageTimeouts }
        delete updated[stage]
        return { stageTimeouts: updated }
      })
    } else {
      await window.api.settings.setGlobal(key, String(ms))
      set((state) => ({
        stageTimeouts: { ...state.stageTimeouts, [stage]: ms },
      }))
    }
  },

  setStageAutoApprove: async (stage: PipelineStage, threshold: number | null) => {
    const key = `${SETTING_KEYS.STAGE_AUTO_APPROVE_PREFIX}${stage}`
    if (threshold === undefined) {
      // undefined means "remove the key entirely" — treat same as null removal
      await window.api.settings.deleteGlobal(key)
      set((state) => {
        const updated = { ...state.stageAutoApprove }
        delete updated[stage]
        return { stageAutoApprove: updated }
      })
    } else {
      // null is a valid stored value meaning "disabled"; store it as 'null' string
      await window.api.settings.setGlobal(key, threshold === null ? 'null' : String(threshold))
      set((state) => ({
        stageAutoApprove: { ...state.stageAutoApprove, [stage]: threshold },
      }))
    }
  },

  // --- UI setters ---
  setActivityFeedDefault: async (open: boolean) => {
    await window.api.settings.setGlobal(SETTING_KEYS.UI_ACTIVITY_FEED, String(open))
    set({ activityFeedDefault: open })
  },

  setDensity: async (density: UIDensity) => {
    await window.api.settings.setGlobal(SETTING_KEYS.UI_DENSITY, density)
    set({ density })
  },

  setFontSize: async (size: UIFontSize) => {
    await window.api.settings.setGlobal(SETTING_KEYS.UI_FONT_SIZE, size)
    set({ fontSize: size })
  },

  // --- Hook setters ---
  setHookPreset: async (preset: string | null, projectDbPath: string) => {
    await window.api.settings.setProject(projectDbPath, SETTING_KEYS.HOOK_PRESET, preset === null ? 'null' : preset)
    set({ hookPreset: preset })
  },

  setHooks: async (hooks: Record<string, ValidationHook[]>, projectDbPath: string) => {
    // Persist each stage bucket under its prefix key
    for (const [stageKey, hookList] of Object.entries(hooks)) {
      let settingsKey: string
      if (stageKey.startsWith('pre.')) {
        settingsKey = SETTING_KEYS.HOOK_PRE_PREFIX + stageKey.slice('pre.'.length)
      } else {
        settingsKey = SETTING_KEYS.HOOK_POST_PREFIX + stageKey.slice('post.'.length)
      }
      await window.api.settings.setProject(projectDbPath, settingsKey, JSON.stringify(hookList))
    }
    set({ hooks })
  },

  // --- Reset ---
  resetToDefaults: async () => {
    const state = get()

    // Delete all per-stage overrides
    for (const stage of Object.keys(state.stageModels) as PipelineStage[]) {
      await window.api.settings.deleteGlobal(`${SETTING_KEYS.STAGE_MODEL_PREFIX}${stage}`)
    }
    for (const stage of Object.keys(state.stageMaxTurns) as PipelineStage[]) {
      await window.api.settings.deleteGlobal(`${SETTING_KEYS.STAGE_MAX_TURNS_PREFIX}${stage}`)
    }
    for (const stage of Object.keys(state.stageTimeouts) as PipelineStage[]) {
      await window.api.settings.deleteGlobal(`${SETTING_KEYS.STAGE_TIMEOUT_PREFIX}${stage}`)
    }
    for (const stage of Object.keys(state.stageAutoApprove) as PipelineStage[]) {
      await window.api.settings.deleteGlobal(`${SETTING_KEYS.STAGE_AUTO_APPROVE_PREFIX}${stage}`)
    }

    // Delete top-level keys
    await window.api.settings.deleteGlobal(SETTING_KEYS.GLOBAL_MODEL)
    await window.api.settings.deleteGlobal(SETTING_KEYS.WORKSHOP_MODEL)
    await window.api.settings.deleteGlobal(SETTING_KEYS.UI_ACTIVITY_FEED)
    await window.api.settings.deleteGlobal(SETTING_KEYS.UI_DENSITY)
    await window.api.settings.deleteGlobal(SETTING_KEYS.UI_FONT_SIZE)

    set({ ...DEFAULT_SETTINGS })
  },
}))
