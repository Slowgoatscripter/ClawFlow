import { useState, type MouseEvent } from 'react'
import { useSettingsStore } from '../../stores/settingsStore'
import { useProjectStore } from '../../stores/projectStore'
import { MODEL_OPTIONS, type ModelOption } from '../../../../shared/settings'
import { STAGE_CONFIGS } from '../../../../shared/constants'
import { HOOK_PRESETS, type ValidationHook } from '../../../../shared/hook-types'
import type { PipelineStage } from '../../../../shared/types'

type Tab = 'models' | 'pipeline' | 'preferences' | 'hooks'

const TABS: { key: Tab; label: string }[] = [
  { key: 'models', label: 'AI Models' },
  { key: 'pipeline', label: 'Pipeline' },
  { key: 'preferences', label: 'Preferences' },
  { key: 'hooks', label: 'Validation Hooks' },
]

/** Pipeline stages excluding 'done' */
const EDITABLE_STAGES = (Object.keys(STAGE_CONFIGS) as PipelineStage[]).filter(
  (s) => s !== 'done'
)

/** "design_review" -> "Design Review" */
function formatStageName(stage: string): string {
  return stage
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}

// ─── Sub-components ──────────────────────────────────────────────

function SelectModel({
  value,
  onChange,
  includeDefault,
}: {
  value: ModelOption | ''
  onChange: (v: ModelOption | null) => void
  includeDefault?: boolean
}) {
  return (
    <select
      value={value}
      onChange={(e) => {
        const v = e.target.value
        onChange(v === '' ? null : (v as ModelOption))
      }}
      className="bg-elevated text-text-primary border border-border rounded-md px-3 py-1.5 text-sm focus:outline-none focus:border-accent-cyan"
    >
      {includeDefault && <option value="">Use Global Default</option>}
      {MODEL_OPTIONS.map((opt) => (
        <option key={opt.value} value={opt.value}>
          {opt.label}
        </option>
      ))}
    </select>
  )
}

// ─── Tab: AI Models ──────────────────────────────────────────────

function ModelsTab() {
  const globalModel = useSettingsStore((s) => s.globalModel)
  const workshopModel = useSettingsStore((s) => s.workshopModel)
  const stageModels = useSettingsStore((s) => s.stageModels)
  const setGlobalModel = useSettingsStore((s) => s.setGlobalModel)
  const setWorkshopModel = useSettingsStore((s) => s.setWorkshopModel)
  const setStageModel = useSettingsStore((s) => s.setStageModel)

  return (
    <div className="space-y-6">
      {/* Global Default */}
      <section>
        <h3 className="text-sm font-semibold text-text-primary mb-2">
          Global Default Model
        </h3>
        <SelectModel
          value={globalModel}
          onChange={(v) => v && setGlobalModel(v)}
        />
      </section>

      <div className="h-px bg-gradient-to-r from-border via-border-bright to-transparent" />

      {/* Per-Stage Overrides */}
      <section>
        <h3 className="text-sm font-semibold text-text-primary mb-2">
          Per-Stage Overrides
        </h3>
        <div className="space-y-2">
          {EDITABLE_STAGES.map((stage) => (
            <div key={stage} className="flex items-center justify-between">
              <span className="text-sm text-text-secondary">
                {formatStageName(stage)}
              </span>
              <SelectModel
                value={stageModels[stage] ?? ''}
                onChange={(v) => setStageModel(stage, v)}
                includeDefault
              />
            </div>
          ))}
        </div>
      </section>

      <div className="h-px bg-gradient-to-r from-border via-border-bright to-transparent" />

      {/* Workshop Model */}
      <section>
        <h3 className="text-sm font-semibold text-text-primary mb-2">
          Workshop Model
        </h3>
        <SelectModel
          value={workshopModel}
          onChange={(v) => v && setWorkshopModel(v)}
        />
      </section>
    </div>
  )
}

// ─── Tab: Pipeline ───────────────────────────────────────────────

function PipelineTab() {
  const stageMaxTurns = useSettingsStore((s) => s.stageMaxTurns)
  const stageTimeouts = useSettingsStore((s) => s.stageTimeouts)
  const stageAutoApprove = useSettingsStore((s) => s.stageAutoApprove)
  const setStageMaxTurns = useSettingsStore((s) => s.setStageMaxTurns)
  const setStageTimeout = useSettingsStore((s) => s.setStageTimeout)
  const setStageAutoApprove = useSettingsStore((s) => s.setStageAutoApprove)
  const resetToDefaults = useSettingsStore((s) => s.resetToDefaults)

  const handleNumberChange = (
    stage: PipelineStage,
    field: 'maxTurns' | 'timeout' | 'autoApprove',
    raw: string
  ) => {
    if (raw === '') {
      // Clear override — revert to default
      if (field === 'maxTurns') setStageMaxTurns(stage, null)
      else if (field === 'timeout') setStageTimeout(stage, null)
      else setStageAutoApprove(stage, null)
      return
    }
    const num = Number(raw)
    if (Number.isNaN(num)) return
    if (field === 'maxTurns') setStageMaxTurns(stage, num)
    else if (field === 'timeout') setStageTimeout(stage, num * 60000) // minutes → ms
    else setStageAutoApprove(stage, num)
  }

  return (
    <div className="space-y-4">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-text-secondary text-left border-b border-border">
              <th className="pb-2 pr-4 font-medium">Stage</th>
              <th className="pb-2 pr-4 font-medium">Max Turns</th>
              <th className="pb-2 pr-4 font-medium">Timeout (min)</th>
              <th className="pb-2 font-medium">Auto-Approve</th>
            </tr>
          </thead>
          <tbody>
            {EDITABLE_STAGES.map((stage) => {
              const defaults = STAGE_CONFIGS[stage]
              const hasAutoApprove = defaults.autoApproveThreshold !== null

              return (
                <tr key={stage} className="border-b border-border/50">
                  <td className="py-2 pr-4 text-text-primary">
                    {formatStageName(stage)}
                  </td>
                  <td className="py-2 pr-4">
                    <input
                      type="number"
                      min={1}
                      max={500}
                      placeholder={String(defaults.maxTurns)}
                      value={stageMaxTurns[stage] ?? ''}
                      onChange={(e) =>
                        handleNumberChange(stage, 'maxTurns', e.target.value)
                      }
                      className="w-20 bg-elevated text-text-primary border border-border rounded-md px-2 py-1 text-sm focus:outline-none focus:border-accent-cyan placeholder:text-text-muted"
                    />
                  </td>
                  <td className="py-2 pr-4">
                    <input
                      type="number"
                      min={1}
                      max={120}
                      placeholder={String(defaults.timeoutMs / 60000)}
                      value={
                        stageTimeouts[stage] != null
                          ? stageTimeouts[stage]! / 60000
                          : ''
                      }
                      onChange={(e) =>
                        handleNumberChange(stage, 'timeout', e.target.value)
                      }
                      className="w-20 bg-elevated text-text-primary border border-border rounded-md px-2 py-1 text-sm focus:outline-none focus:border-accent-cyan placeholder:text-text-muted"
                    />
                  </td>
                  <td className="py-2">
                    {hasAutoApprove ? (
                      <input
                        type="number"
                        min={0}
                        max={5}
                        step={0.5}
                        placeholder={String(defaults.autoApproveThreshold)}
                        value={
                          stageAutoApprove[stage] !== undefined
                            ? stageAutoApprove[stage] ?? ''
                            : ''
                        }
                        onChange={(e) =>
                          handleNumberChange(
                            stage,
                            'autoApprove',
                            e.target.value
                          )
                        }
                        className="w-20 bg-elevated text-text-primary border border-border rounded-md px-2 py-1 text-sm focus:outline-none focus:border-accent-cyan placeholder:text-text-muted"
                      />
                    ) : (
                      <span className="text-text-muted">&mdash;</span>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <button
        onClick={resetToDefaults}
        className="px-4 py-2 rounded-md bg-elevated text-text-secondary hover:text-text-primary border border-border hover:border-accent-cyan transition-colors text-sm cursor-pointer"
      >
        Reset to Defaults
      </button>
    </div>
  )
}

// ─── Tab: Preferences ────────────────────────────────────────────

function ToggleSwitch({
  checked,
  onChange,
}: {
  checked: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`relative w-11 h-6 rounded-full transition-colors cursor-pointer ${
        checked ? 'bg-accent-cyan shadow-[0_0_8px_rgba(0,229,255,0.2)]' : 'bg-elevated border border-border'
      }`}
    >
      <span
        className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-text-primary transition-transform ${
          checked ? 'translate-x-5' : 'translate-x-0'
        }`}
      />
    </button>
  )
}

function ButtonGroup<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[]
  value: T
  onChange: (v: T) => void
}) {
  return (
    <div className="inline-flex rounded-md border border-border overflow-hidden">
      {options.map((opt) => (
        <button
          key={opt.value}
          onClick={() => onChange(opt.value)}
          className={`px-3 py-1.5 text-sm transition-colors cursor-pointer ${
            value === opt.value
              ? 'bg-elevated text-text-primary'
              : 'bg-surface text-text-secondary hover:text-text-primary'
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  )
}

function PreferencesTab() {
  const activityFeedDefault = useSettingsStore((s) => s.activityFeedDefault)
  const density = useSettingsStore((s) => s.density)
  const fontSize = useSettingsStore((s) => s.fontSize)
  const setActivityFeedDefault = useSettingsStore(
    (s) => s.setActivityFeedDefault
  )
  const setDensity = useSettingsStore((s) => s.setDensity)
  const setFontSize = useSettingsStore((s) => s.setFontSize)

  return (
    <div className="space-y-6">
      {/* Activity Feed */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-text-primary">
            Activity Feed
          </h3>
          <p className="text-xs text-text-secondary mt-0.5">
            Show the activity feed by default when opening a project
          </p>
        </div>
        <ToggleSwitch
          checked={activityFeedDefault}
          onChange={setActivityFeedDefault}
        />
      </div>

      {/* UI Density */}
      <div>
        <h3 className="text-sm font-semibold text-text-primary mb-2">
          UI Density
        </h3>
        <ButtonGroup
          options={[
            { value: 'comfortable', label: 'Comfortable' },
            { value: 'compact', label: 'Compact' },
          ]}
          value={density}
          onChange={setDensity}
        />
      </div>

      {/* Font Size */}
      <div>
        <h3 className="text-sm font-semibold text-text-primary mb-2">
          Font Size
        </h3>
        <ButtonGroup
          options={[
            { value: 'small', label: 'Small' },
            { value: 'medium', label: 'Medium' },
            { value: 'large', label: 'Large' },
          ]}
          value={fontSize}
          onChange={setFontSize}
        />
      </div>
    </div>
  )
}

// ─── Tab: Validation Hooks ───────────────────────────────────────

const HOOK_STAGES = [
  'pre.brainstorm', 'post.brainstorm',
  'pre.plan', 'post.plan',
  'pre.implement', 'post.implement',
  'pre.code_review', 'post.code_review',
  'pre.verify', 'post.verify',
] as const

type HookStage = typeof HOOK_STAGES[number]

const PRESET_OPTIONS = [
  { value: '', label: 'None' },
  { value: 'typescript', label: 'TypeScript' },
  { value: 'full-js', label: 'Full JS' },
  { value: 'python', label: 'Python' },
]

interface HookRow {
  stageKey: HookStage
  hook: ValidationHook
  index: number
}

function HooksTab() {
  const hookPreset = useSettingsStore((s) => s.hookPreset)
  const hooks = useSettingsStore((s) => s.hooks)
  const setHookPreset = useSettingsStore((s) => s.setHookPreset)
  const setHooks = useSettingsStore((s) => s.setHooks)
  const currentProject = useProjectStore((s) => s.currentProject)

  const [showAddForm, setShowAddForm] = useState(false)
  const [addName, setAddName] = useState('')
  const [addCommand, setAddCommand] = useState('')
  const [addArgs, setAddArgs] = useState('')
  const [addStage, setAddStage] = useState<HookStage>('post.implement')
  const [addRequired, setAddRequired] = useState(false)
  const [addTimeout, setAddTimeout] = useState('30000')

  const dbPath = currentProject?.dbPath ?? ''

  /** Flatten hooks record into rows for display */
  const allRows: HookRow[] = []
  for (const stageKey of HOOK_STAGES) {
    const list = hooks[stageKey] ?? []
    list.forEach((hook, index) => {
      allRows.push({ stageKey, hook, index })
    })
  }

  const handlePresetChange = async (presetName: string) => {
    if (!dbPath) return
    if (presetName === '') {
      await setHookPreset(null, dbPath)
      await setHooks({}, dbPath)
      return
    }
    const preset = HOOK_PRESETS.find((p) => p.name === presetName)
    if (!preset) return
    await setHookPreset(presetName, dbPath)
    await setHooks(preset.hooks as Record<string, ValidationHook[]>, dbPath)
  }

  const handleDelete = async (stageKey: HookStage, index: number) => {
    if (!dbPath) return
    const updated = { ...hooks }
    const list = [...(updated[stageKey] ?? [])]
    list.splice(index, 1)
    if (list.length === 0) {
      delete updated[stageKey]
    } else {
      updated[stageKey] = list
    }
    await setHooks(updated, dbPath)
  }

  const handleAdd = async () => {
    if (!dbPath || !addName.trim() || !addCommand.trim()) return
    const newHook: ValidationHook = {
      name: addName.trim(),
      command: addCommand.trim(),
      args: addArgs.trim() ? addArgs.trim().split(/\s+/) : [],
      timeout: Number(addTimeout) || 30000,
      required: addRequired,
    }
    const updated = { ...hooks }
    updated[addStage] = [...(updated[addStage] ?? []), newHook]
    await setHooks(updated, dbPath)
    // Reset form
    setAddName('')
    setAddCommand('')
    setAddArgs('')
    setAddStage('post.implement')
    setAddRequired(false)
    setAddTimeout('30000')
    setShowAddForm(false)
  }

  const inputCls = 'bg-elevated text-text-primary border border-border rounded-md px-3 py-1.5 text-sm focus:outline-none focus:border-accent-cyan placeholder:text-text-muted w-full'
  const selectCls = 'bg-elevated text-text-primary border border-border rounded-md px-3 py-1.5 text-sm focus:outline-none focus:border-accent-cyan'

  return (
    <div className="space-y-6">
      {/* Notice if no project open */}
      {!dbPath && (
        <div className="rounded-md border border-border bg-elevated/50 px-4 py-3 text-sm text-text-secondary">
          Open a project to configure validation hooks. Hooks are stored per-project.
        </div>
      )}

      {/* Preset Selector */}
      <section>
        <h3 className="text-sm font-semibold text-text-primary mb-1">Preset</h3>
        <p className="text-xs text-text-secondary mb-2">
          Quickly load a standard hook configuration. Selecting a preset replaces current hooks.
        </p>
        <select
          value={hookPreset ?? ''}
          onChange={(e) => handlePresetChange(e.target.value)}
          disabled={!dbPath}
          className={selectCls}
        >
          {PRESET_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </section>

      <div className="h-px bg-gradient-to-r from-border via-border-bright to-transparent" />

      {/* Hook List */}
      <section>
        <h3 className="text-sm font-semibold text-text-primary mb-3">Configured Hooks</h3>
        {allRows.length === 0 ? (
          <p className="text-sm text-text-muted italic">No hooks configured. Select a preset or add a custom hook below.</p>
        ) : (
          <div className="rounded-md border border-border overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-elevated/60 text-text-secondary text-left border-b border-border">
                  <th className="px-3 py-2 font-medium">Name</th>
                  <th className="px-3 py-2 font-medium">Command</th>
                  <th className="px-3 py-2 font-medium">Stage</th>
                  <th className="px-3 py-2 font-medium">Required</th>
                  <th className="px-3 py-2 font-medium w-8" />
                </tr>
              </thead>
              <tbody>
                {allRows.map(({ stageKey, hook, index }) => (
                  <tr key={`${stageKey}-${index}`} className="border-b border-border/50 hover:bg-elevated/30 transition-colors">
                    <td className="px-3 py-2 text-text-primary font-medium">{hook.name}</td>
                    <td className="px-3 py-2 text-text-secondary font-mono text-xs">
                      {[hook.command, ...(hook.args ?? [])].join(' ')}
                    </td>
                    <td className="px-3 py-2">
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs border border-border text-text-secondary bg-elevated/50">
                        {stageKey}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      {hook.required ? (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs border border-accent-cyan/40 text-accent-cyan bg-accent-cyan/10">
                          required
                        </span>
                      ) : (
                        <span className="text-text-muted text-xs">optional</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <button
                        onClick={() => handleDelete(stageKey, index)}
                        disabled={!dbPath}
                        className="text-text-muted hover:text-red-400 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                        aria-label="Delete hook"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M3 6h18" /><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" /><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
                        </svg>
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <div className="h-px bg-gradient-to-r from-border via-border-bright to-transparent" />

      {/* Add Hook */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-text-primary">Add Custom Hook</h3>
          <button
            onClick={() => setShowAddForm((v) => !v)}
            disabled={!dbPath}
            className="px-3 py-1.5 rounded-md text-sm border border-border text-text-secondary hover:text-text-primary hover:border-accent-cyan transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {showAddForm ? 'Cancel' : '+ Add Hook'}
          </button>
        </div>

        {showAddForm && (
          <div className="rounded-md border border-border bg-elevated/30 p-4 space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-text-secondary mb-1">Name</label>
                <input
                  type="text"
                  placeholder="e.g. TypeScript Check"
                  value={addName}
                  onChange={(e) => setAddName(e.target.value)}
                  className={inputCls}
                />
              </div>
              <div>
                <label className="block text-xs text-text-secondary mb-1">Command</label>
                <input
                  type="text"
                  placeholder="e.g. npx"
                  value={addCommand}
                  onChange={(e) => setAddCommand(e.target.value)}
                  className={inputCls}
                />
              </div>
            </div>

            <div>
              <label className="block text-xs text-text-secondary mb-1">Args (space-separated)</label>
              <input
                type="text"
                placeholder="e.g. tsc --noEmit"
                value={addArgs}
                onChange={(e) => setAddArgs(e.target.value)}
                className={inputCls}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-text-secondary mb-1">Stage Trigger</label>
                <select
                  value={addStage}
                  onChange={(e) => setAddStage(e.target.value as HookStage)}
                  className={selectCls + ' w-full'}
                >
                  {HOOK_STAGES.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs text-text-secondary mb-1">Timeout (ms)</label>
                <input
                  type="number"
                  min={1000}
                  step={1000}
                  value={addTimeout}
                  onChange={(e) => setAddTimeout(e.target.value)}
                  className={inputCls}
                />
              </div>
            </div>

            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className="text-sm text-text-secondary">Required</span>
                <button
                  role="switch"
                  aria-checked={addRequired}
                  onClick={() => setAddRequired((v) => !v)}
                  className={`relative w-11 h-6 rounded-full transition-colors cursor-pointer ${
                    addRequired ? 'bg-accent-cyan shadow-[0_0_8px_rgba(0,229,255,0.2)]' : 'bg-elevated border border-border'
                  }`}
                >
                  <span
                    className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-text-primary transition-transform ${
                      addRequired ? 'translate-x-5' : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>
              <button
                onClick={handleAdd}
                disabled={!addName.trim() || !addCommand.trim()}
                className="px-4 py-2 rounded-md bg-accent-cyan/10 border border-accent-cyan/40 text-accent-cyan text-sm hover:bg-accent-cyan/20 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Add Hook
              </button>
            </div>
          </div>
        )}
      </section>
    </div>
  )
}

// ─── Main Modal ──────────────────────────────────────────────────

export function SettingsModal() {
  const isOpen = useSettingsStore((s) => s.settingsModalOpen)
  const closeSettingsModal = useSettingsStore((s) => s.closeSettingsModal)
  const [activeTab, setActiveTab] = useState<Tab>('models')

  if (!isOpen) return null

  const handleOverlay = (e: MouseEvent) => {
    if (e.target === e.currentTarget) closeSettingsModal()
  }

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
      onClick={handleOverlay}
    >
      <div className="bg-surface rounded-lg max-w-3xl w-full mx-4 flex overflow-hidden max-h-[80vh]">
        {/* Left sidebar */}
        <div className="w-48 shrink-0 bg-surface/60 backdrop-blur-lg border-r border-border p-4 flex flex-col gap-1">
          <h2 className="text-lg font-semibold text-text-primary mb-4">
            Settings
          </h2>
          {TABS.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`text-left px-3 py-2 rounded-md text-sm transition-colors cursor-pointer ${
                activeTab === tab.key
                  ? 'bg-elevated text-text-primary'
                  : 'text-text-secondary hover:text-text-primary'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Content panel */}
        <div className="flex-1 p-6 overflow-y-auto relative">
          {/* Close button */}
          <button
            onClick={closeSettingsModal}
            className="absolute top-4 right-4 text-text-secondary hover:text-text-primary transition-colors cursor-pointer"
            aria-label="Close settings"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M18 6 6 18" />
              <path d="m6 6 12 12" />
            </svg>
          </button>

          {/* Tab title */}
          <h2 className="text-lg font-semibold text-text-primary mb-4">
            {TABS.find((t) => t.key === activeTab)?.label}
          </h2>

          {/* Active tab content */}
          {activeTab === 'models' && <ModelsTab />}
          {activeTab === 'pipeline' && <PipelineTab />}
          {activeTab === 'preferences' && <PreferencesTab />}
          {activeTab === 'hooks' && <HooksTab />}
        </div>
      </div>
    </div>
  )
}
