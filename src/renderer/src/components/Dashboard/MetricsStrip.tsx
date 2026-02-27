import { useMetricsStore } from '../../stores/metricsStore'
import { MetricTile } from './MetricTile'

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${Math.round(n / 1_000)}k`
  return String(n)
}

function formatTime(seconds: number): string {
  if (seconds >= 60) return `${Math.round(seconds / 60)}m`
  return `${Math.round(seconds)}s`
}

export function MetricsStrip() {
  const activeAgents = useMetricsStore((s) => s.activeAgents)
  const tasksDone = useMetricsStore((s) => s.tasksDone)
  const tasksDoneHistory = useMetricsStore((s) => s.tasksDoneHistory)
  const completionRate = useMetricsStore((s) => s.completionRate)
  const completionRateHistory = useMetricsStore((s) => s.completionRateHistory)
  const avgStageTime = useMetricsStore((s) => s.avgStageTime)
  const avgStageTimeHistory = useMetricsStore((s) => s.avgStageTimeHistory)
  const tokenUsage = useMetricsStore((s) => s.tokenUsage)
  const tokenUsageHistory = useMetricsStore((s) => s.tokenUsageHistory)

  return (
    <div className="flex gap-3 px-4 py-3 overflow-x-auto">
      <MetricTile
        value={activeAgents}
        label="Active Agents"
        color="var(--color-accent-peach)"
        sparkline={[activeAgents]}
        sparklineType="dots"
      />
      <MetricTile
        value={tasksDone}
        label="Tasks Done"
        color="var(--color-accent-green)"
        sparkline={tasksDoneHistory}
        sparklineType="bar"
      />
      <MetricTile
        value={`${completionRate}%`}
        label="Completion Rate"
        color="var(--color-accent-cyan)"
        sparkline={completionRateHistory}
        sparklineType="line"
      />
      <MetricTile
        value={formatTime(avgStageTime)}
        label="Avg Stage Time"
        color="var(--color-accent-amber)"
        sparkline={avgStageTimeHistory}
        sparklineType="line"
      />
      <MetricTile
        value={formatTokens(tokenUsage)}
        label="Token Usage"
        color="var(--color-accent-violet)"
        sparkline={tokenUsageHistory}
        sparklineType="area"
      />
    </div>
  )
}
