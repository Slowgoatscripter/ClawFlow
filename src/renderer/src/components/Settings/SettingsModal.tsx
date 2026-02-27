import { useState, type MouseEvent } from 'react'
import { useSettingsStore } from '../../stores/settingsStore'
import { MODEL_OPTIONS, type ModelOption } from '../../../../shared/settings'
import { STAGE_CONFIGS } from '../../../../shared/constants'
import type { PipelineStage } from '../../../../shared/types'

type Tab = 'models' | 'pipeline' | 'preferences'

const TABS: { key: Tab; label: string }[] = [
  { key: 'models', label: 'AI Models' },
  { key: 'pipeline', label: 'Pipeline' },
  { key: 'preferences', label: 'Preferences' },
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
        </div>
      </div>
    </div>
  )
}
