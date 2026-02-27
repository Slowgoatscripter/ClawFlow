interface MetricTileProps {
  value: string | number
  label: string
  sublabel?: string
  color: string // CSS variable value like 'var(--color-accent-cyan)'
  sparkline: number[]
  sparklineType: 'bar' | 'line' | 'area' | 'dots'
}

const SVG_W = 48
const SVG_H = 16

function normalize(data: number[]): number[] {
  if (data.length === 0) return []
  const max = Math.max(...data)
  if (max === 0) return data.map(() => 0)
  return data.map((v) => (v / max) * SVG_H)
}

function renderBar(pts: number[], color: string) {
  const barW = 4
  const gap = 1
  const total = pts.length
  if (total === 0) return null
  return (
    <g>
      {pts.map((h, i) => {
        const x = SVG_W - (total - i) * (barW + gap)
        return (
          <rect
            key={i}
            x={x}
            y={SVG_H - h}
            width={barW}
            height={Math.max(h, 0.5)}
            fill={color}
            opacity={0.85}
            rx={0.5}
          />
        )
      })}
    </g>
  )
}

function points(pts: number[]): string {
  if (pts.length === 0) return ''
  const step = pts.length > 1 ? SVG_W / (pts.length - 1) : 0
  return pts.map((h, i) => `${i * step},${SVG_H - h}`).join(' ')
}

function renderLine(pts: number[], color: string) {
  if (pts.length < 2) return null
  return <polyline points={points(pts)} fill="none" stroke={color} strokeWidth={1.5} />
}

function renderArea(pts: number[], color: string) {
  if (pts.length < 2) return null
  const step = SVG_W / (pts.length - 1)
  const polyPts = points(pts)
  const areaPath = `${polyPts} ${SVG_W},${SVG_H} 0,${SVG_H}`
  return (
    <g>
      <polygon points={areaPath} fill={color} opacity={0.2} />
      <polyline points={polyPts} fill="none" stroke={color} strokeWidth={1.5} />
    </g>
  )
}

function renderDots(pts: number[], color: string) {
  if (pts.length === 0) return null
  const step = pts.length > 1 ? SVG_W / (pts.length - 1) : SVG_W / 2
  return (
    <g>
      {pts.map((h, i) => (
        <circle key={i} cx={i * step} cy={SVG_H - h} r={1.8} fill={color} opacity={0.9} />
      ))}
    </g>
  )
}

const renderers = {
  bar: renderBar,
  line: renderLine,
  area: renderArea,
  dots: renderDots,
} as const

export function MetricTile({ value, label, sublabel, color, sparkline, sparklineType }: MetricTileProps) {
  const pts = normalize(sparkline.slice(-10))
  const render = renderers[sparklineType]

  return (
    <div
      className="flex items-center justify-between gap-3 rounded-lg px-3 py-2 min-w-[160px]"
      style={{
        background: 'var(--color-surface)',
        border: '1px solid var(--color-border)',
      }}
    >
      <div className="flex flex-col min-w-0">
        <span
          className="text-lg font-bold font-mono leading-tight truncate"
          style={{ color }}
        >
          {value}
        </span>
        <span
          className="text-[10px] leading-tight truncate"
          style={{ color: 'var(--color-text-muted)' }}
        >
          {label}
        </span>
        {sublabel && (
          <span
            className="text-[9px] leading-tight truncate"
            style={{ color: 'var(--color-text-muted)', opacity: 0.6 }}
          >
            {sublabel}
          </span>
        )}
      </div>
      <svg
        width={SVG_W}
        height={SVG_H}
        viewBox={`0 0 ${SVG_W} ${SVG_H}`}
        className="shrink-0"
      >
        {render(pts, color)}
      </svg>
    </div>
  )
}
