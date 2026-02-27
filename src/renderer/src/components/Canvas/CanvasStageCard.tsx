import { Check } from 'lucide-react'

interface CanvasStageCardProps {
  stage: string
  status: 'completed' | 'active' | 'pending'
}

const STAGE_COLORS: Record<string, string> = {
  brainstorm: 'var(--color-accent-violet)',
  design_review: 'var(--color-accent-violet)',
  plan: 'var(--color-accent-cyan)',
  implement: 'var(--color-accent-cyan)',
  code_review: 'var(--color-accent-amber)',
  verify: 'var(--color-accent-green)',
  done: 'var(--color-accent-green)'
}

const STAGE_LABELS: Record<string, string> = {
  brainstorm: 'Brainstorm',
  design_review: 'Design Review',
  plan: 'Plan',
  implement: 'Implement',
  code_review: 'Code Review',
  verify: 'Verify',
  done: 'Done'
}

export function CanvasStageCard({ stage, status }: CanvasStageCardProps) {
  const color = STAGE_COLORS[stage] ?? 'var(--color-accent-cyan)'
  const label = STAGE_LABELS[stage] ?? stage

  if (status === 'completed') {
    return (
      <div
        className="flex items-center gap-1.5 px-2 py-1 rounded text-xs"
        style={{ backgroundColor: 'var(--color-surface)', color: 'var(--color-text-muted)' }}
      >
        <Check size={10} style={{ color }} />
        <span className="line-through">{label}</span>
      </div>
    )
  }

  if (status === 'active') {
    return (
      <div
        className="flex items-center gap-1.5 px-2 py-1 rounded text-xs"
        style={{
          backgroundColor: 'var(--color-surface)',
          borderLeft: `2px solid ${color}`,
          boxShadow: `0 0 6px ${color}33`,
          color: 'var(--color-text-primary)'
        }}
      >
        <span
          className="inline-block w-1.5 h-1.5 rounded-full animate-pulse"
          style={{ backgroundColor: color }}
        />
        <span>{label}</span>
      </div>
    )
  }

  // pending
  return (
    <div
      className="flex items-center gap-1.5 px-2 py-1 rounded text-xs opacity-40"
      style={{ backgroundColor: 'var(--color-surface)', color: 'var(--color-text-muted)' }}
    >
      <span className="inline-block w-1.5 h-1.5 rounded-full" style={{ backgroundColor: 'var(--color-border)' }} />
      <span>{label}</span>
    </div>
  )
}
