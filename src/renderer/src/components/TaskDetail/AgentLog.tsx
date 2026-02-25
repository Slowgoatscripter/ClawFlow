import type { AgentLogEntry } from '../../../../shared/types'

const AGENT_COLORS: Record<string, string> = {
  brainstorm: 'bg-accent-mauve/20 text-accent-mauve',
  planner: 'bg-accent-teal/20 text-accent-teal',
  implementer: 'bg-accent-peach/20 text-accent-peach',
  reviewer: 'bg-accent-gold/20 text-accent-gold',
  verifier: 'bg-accent-green/20 text-accent-green'
}

function getAgentColor(agent: string): string {
  const lower = agent.toLowerCase()
  for (const [key, value] of Object.entries(AGENT_COLORS)) {
    if (lower.includes(key)) return value
  }
  return 'bg-accent-teal/20 text-accent-teal'
}

export function AgentLog({ log }: { log: AgentLogEntry[] }) {
  if (log.length === 0) {
    return (
      <div className="bg-surface rounded-lg p-6 text-text-muted text-sm text-center">
        No activity yet
      </div>
    )
  }

  const sorted = [...log].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  )

  return (
    <div className="bg-surface rounded-lg overflow-hidden max-h-[300px] overflow-y-auto">
      <div className="divide-y divide-border">
        {sorted.map((entry, i) => (
          <div key={i} className="flex items-start gap-3 px-4 py-2.5">
            <span className="text-xs text-text-muted font-mono whitespace-nowrap pt-0.5">
              {new Date(entry.timestamp).toLocaleTimeString()}
            </span>
            <span
              className={`text-[10px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap ${getAgentColor(entry.agent)}`}
            >
              {entry.agent}
            </span>
            <span className="text-sm font-medium text-text-primary whitespace-nowrap">
              {entry.action}
            </span>
            <span className="text-sm text-text-secondary truncate" title={entry.details}>
              {entry.details}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
