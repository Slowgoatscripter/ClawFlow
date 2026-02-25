import { useState } from 'react'
import type { Handoff, HandoffStatus } from '../../../../shared/types'
import { colors } from '../../theme'

const STAGE_LABELS: Record<string, string> = {
  brainstorm: 'Brainstorm',
  design_review: 'Design Review',
  plan: 'Plan',
  implement: 'Implement',
  code_review: 'Code Review',
  verify: 'Verify',
  done: 'Done'
}

const STATUS_INDICATOR: Record<HandoffStatus, { color: string; label: string }> = {
  completed: { color: colors.accent.green, label: 'Completed' },
  blocked: { color: colors.accent.red, label: 'Blocked' },
  needs_intervention: { color: colors.accent.gold, label: 'Needs Intervention' }
}

export function HandoffChain({ handoffs }: { handoffs: Handoff[] }) {
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null)

  if (handoffs.length === 0) {
    return (
      <div className="bg-surface rounded-lg p-6 text-text-muted text-sm text-center">
        No handoffs yet
      </div>
    )
  }

  return (
    <div className="bg-surface rounded-lg overflow-hidden divide-y divide-border">
      {handoffs.map((h, i) => {
        const isExpanded = expandedIdx === i
        const indicator = STATUS_INDICATOR[h.status]

        return (
          <div key={i}>
            {/* Header */}
            <button
              onClick={() => setExpandedIdx(isExpanded ? null : i)}
              className="w-full flex items-center gap-3 px-4 py-3 hover:bg-elevated transition-colors text-left"
            >
              <svg
                className={`w-4 h-4 text-text-muted transition-transform ${isExpanded ? 'rotate-90' : ''}`}
                fill="currentColor"
                viewBox="0 0 20 20"
              >
                <path
                  fillRule="evenodd"
                  d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z"
                  clipRule="evenodd"
                />
              </svg>
              <span className="text-sm font-medium text-text-primary">
                {STAGE_LABELS[h.stage] ?? h.stage}
              </span>
              <span className="text-xs text-text-muted">{h.agent}</span>
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-elevated text-text-secondary">
                {h.model}
              </span>
              <span className="text-xs text-text-muted ml-auto">
                {new Date(h.timestamp).toLocaleString()}
              </span>
              <span
                className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                style={{ backgroundColor: indicator.color }}
                title={indicator.label}
              />
            </button>

            {/* Expanded content */}
            {isExpanded && (
              <div className="px-4 pb-4 space-y-3">
                <HandoffField label="Summary" value={h.summary} />
                <HandoffField label="Key Decisions" value={h.keyDecisions} />
                <HandoffField
                  label="Open Questions"
                  value={h.openQuestions}
                  highlight={h.openQuestions.toLowerCase() !== 'none' ? 'blue' : undefined}
                />
                <HandoffField label="Files Modified" value={h.filesModified} />
                <HandoffField label="Next Stage Needs" value={h.nextStageNeeds} />
                <HandoffField
                  label="Warnings"
                  value={h.warnings}
                  highlight={h.warnings.toLowerCase() !== 'none' ? 'amber' : undefined}
                />
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

function HandoffField({
  label,
  value,
  highlight
}: {
  label: string
  value: string
  highlight?: 'amber' | 'blue'
}) {
  const bgClass =
    highlight === 'amber'
      ? 'bg-accent-gold/10 border border-accent-gold/30'
      : highlight === 'blue'
        ? 'bg-accent-teal/10 border border-accent-teal/30'
        : 'bg-elevated'

  return (
    <div className={`rounded p-3 ${bgClass}`}>
      <span className="text-xs font-semibold text-text-muted uppercase tracking-wide">
        {label}
      </span>
      <p className="text-sm text-text-primary mt-1 whitespace-pre-wrap">{value}</p>
    </div>
  )
}
