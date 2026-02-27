import { useProjectStore } from '../../stores/projectStore'

interface MetricCardProps {
  label: string
  value: string | number
  colorClass: string
  borderClass: string
}

function MetricCard({ label, value, colorClass, borderClass }: MetricCardProps) {
  return (
    <div className={`bg-surface/60 backdrop-blur-sm rounded-lg p-4 flex-1 min-w-0 border-l-4 ${borderClass}`}>
      <p className="text-xs text-text-muted mb-1">{label}</p>
      <p className={`text-2xl font-bold font-mono ${colorClass}`}>{value}</p>
    </div>
  )
}

export function MetricsRow() {
  const stats = useProjectStore((s) => s.stats)

  const inFlight = stats ? stats.inProgress : 0
  const completionRate = stats ? `${Math.round(stats.completionRate)}%` : '0%'
  const avgReview = stats?.avgReviewScore != null ? stats.avgReviewScore.toFixed(1) : '\u2014'
  const circuitBreakers = stats ? stats.circuitBreakerTrips : 0

  return (
    <div className="flex gap-4 px-4 py-4">
      <MetricCard label="In Flight" value={inFlight} colorClass="text-accent-peach" borderClass="border-l-accent-peach" />
      <MetricCard label="Completion Rate" value={completionRate} colorClass="text-accent-green" borderClass="border-l-accent-green" />
      <MetricCard label="Avg Review Score" value={avgReview} colorClass="text-accent-amber" borderClass="border-l-accent-amber" />
      <MetricCard label="Circuit Breakers" value={circuitBreakers} colorClass="text-accent-magenta" borderClass="border-l-accent-magenta" />
    </div>
  )
}
