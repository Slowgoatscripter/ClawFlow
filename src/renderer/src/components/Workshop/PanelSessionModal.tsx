import { useState } from 'react'
import type { MouseEvent } from 'react'
import { PanelPersona } from '../../../../shared/types'
import {
  BUILT_IN_PERSONAS,
  PERSONA_COLORS,
  createCustomPersona
} from '../../../../shared/panel-personas'

interface PanelSessionModalProps {
  onConfirm: (title: string, personas: PanelPersona[]) => void
  onCancel: () => void
}

const MAX_PERSONAS = 4
const MIN_PERSONAS = 2

const ALL_COLORS = Object.keys(PERSONA_COLORS)

export function PanelSessionModal({ onConfirm, onCancel }: PanelSessionModalProps) {
  const [title, setTitle] = useState('')
  const [selected, setSelected] = useState<PanelPersona[]>([])
  const [showCustomForm, setShowCustomForm] = useState(false)
  const [customName, setCustomName] = useState('')
  const [customDescription, setCustomDescription] = useState('')

  const handleOverlay = (e: MouseEvent) => {
    if (e.target === e.currentTarget) onCancel()
  }

  const isSelected = (persona: PanelPersona) => selected.some((p) => p.id === persona.id)

  const togglePersona = (persona: PanelPersona) => {
    if (isSelected(persona)) {
      setSelected((prev) => prev.filter((p) => p.id !== persona.id))
    } else if (selected.length < MAX_PERSONAS) {
      setSelected((prev) => [...prev, persona])
    }
  }

  const getAvailableColor = (): string => {
    const usedColors = new Set(selected.map((p) => p.color))
    return ALL_COLORS.find((c) => !usedColors.has(c)) ?? ALL_COLORS[0]
  }

  const handleAddCustom = () => {
    if (!customName.trim() || !customDescription.trim()) return
    if (selected.length >= MAX_PERSONAS) return

    const color = getAvailableColor()
    const persona = createCustomPersona(customName.trim(), customDescription.trim(), color)
    setSelected((prev) => [...prev, persona])
    setCustomName('')
    setCustomDescription('')
    setShowCustomForm(false)
  }

  const handleConfirm = () => {
    if (selected.length < MIN_PERSONAS) return
    onConfirm(title.trim() || 'Panel Discussion', selected)
  }

  return (
    <div
      className="fixed inset-0 bg-black/60 flex items-center justify-center z-50"
      onClick={handleOverlay}
    >
      <div className="bg-bg-secondary border border-border rounded-lg shadow-xl w-full max-w-[520px] max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="px-6 py-4 border-b border-border">
          <h2 className="text-lg font-semibold text-text">New Panel Discussion</h2>
          <p className="text-sm text-text-muted mt-1">Select 2-4 personas</p>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {/* Optional title */}
          <div>
            <label className="text-xs text-text-muted mb-1.5 block">
              Title <span className="text-text-muted/50">(optional)</span>
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Auth system design review"
              className="w-full bg-bg border border-border rounded-md px-3 py-2 text-sm text-text placeholder:text-text-muted/50 focus:outline-none focus:border-accent-cyan/50"
            />
          </div>

          {/* Persona grid */}
          <div className="grid grid-cols-2 gap-3">
            {BUILT_IN_PERSONAS.map((persona) => {
              const colors = PERSONA_COLORS[persona.color]
              const active = isSelected(persona)
              const atMax = selected.length >= MAX_PERSONAS && !active

              return (
                <button
                  key={persona.id}
                  onClick={() => togglePersona(persona)}
                  disabled={atMax}
                  className={`text-left p-3 rounded-lg border transition-colors cursor-pointer ${
                    active
                      ? `${colors.bg} ${colors.border}`
                      : atMax
                        ? 'border-border opacity-40 cursor-not-allowed'
                        : 'border-border hover:border-text-muted/30'
                  }`}
                >
                  <div className="flex items-center gap-2 mb-1.5">
                    <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${colors.dot}`} />
                    <span className="text-sm font-medium text-text truncate">{persona.name}</span>
                  </div>
                  <p className="text-xs text-text-muted line-clamp-2 leading-relaxed">
                    {persona.systemPrompt.slice(0, 100)}...
                  </p>
                </button>
              )
            })}
          </div>

          {/* Add custom persona */}
          {!showCustomForm ? (
            <button
              onClick={() => setShowCustomForm(true)}
              disabled={selected.length >= MAX_PERSONAS}
              className="w-full py-2 border border-dashed border-border rounded-lg text-sm text-text-muted hover:text-text hover:border-text-muted/30 transition-colors disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
            >
              + Add Custom Persona
            </button>
          ) : (
            <div className="border border-border rounded-lg p-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-text">Custom Persona</span>
                <button
                  onClick={() => {
                    setShowCustomForm(false)
                    setCustomName('')
                    setCustomDescription('')
                  }}
                  className="text-xs text-text-muted hover:text-text transition-colors cursor-pointer"
                >
                  Cancel
                </button>
              </div>
              <input
                type="text"
                value={customName}
                onChange={(e) => setCustomName(e.target.value)}
                placeholder="Persona name"
                className="w-full bg-bg border border-border rounded-md px-3 py-2 text-sm text-text placeholder:text-text-muted/50 focus:outline-none focus:border-accent-cyan/50"
              />
              <textarea
                value={customDescription}
                onChange={(e) => setCustomDescription(e.target.value)}
                placeholder="Describe this persona's focus and expertise..."
                rows={3}
                className="w-full bg-bg border border-border rounded-md px-3 py-2 text-sm text-text placeholder:text-text-muted/50 resize-none focus:outline-none focus:border-accent-cyan/50"
              />
              <button
                onClick={handleAddCustom}
                disabled={!customName.trim() || !customDescription.trim()}
                className="px-4 py-1.5 rounded-md bg-accent-cyan text-bg text-sm font-medium hover:bg-accent-cyan/90 disabled:opacity-50 transition-colors cursor-pointer"
              >
                Add Persona
              </button>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-border flex items-center justify-between">
          <span className="text-xs text-text-muted">
            {selected.length}/{MAX_PERSONAS} selected
          </span>

          <div className="flex gap-3">
            <button
              onClick={onCancel}
              className="px-4 py-2 rounded-md text-text-muted hover:text-text transition-colors text-sm cursor-pointer"
            >
              Cancel
            </button>
            <button
              onClick={handleConfirm}
              disabled={selected.length < MIN_PERSONAS}
              className="px-4 py-2 rounded-md bg-accent-cyan text-bg font-medium text-sm hover:bg-accent-cyan/90 disabled:opacity-50 transition-colors cursor-pointer"
            >
              Start Panel
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
