interface ContextWindowBarProps {
  used: number
  max: number
}

export function ContextWindowBar({ used, max }: ContextWindowBarProps) {
  const safeMax = max > 0 ? max : 1
  const pct = Math.min(100, Math.round((used / safeMax) * 100))

  const fillColor =
    pct > 80
      ? 'var(--color-accent-magenta)'
      : pct > 50
        ? 'var(--color-accent-amber)'
        : 'var(--color-accent-green)'

  return (
    <div className="flex items-center gap-2 w-full">
      {/* Track */}
      <div
        className="flex-1 h-1.5 rounded-full overflow-hidden"
        style={{ background: 'var(--color-border)' }}
      >
        {/* Fill */}
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{
            width: `${pct}%`,
            background: fillColor,
            boxShadow: pct > 80 ? `0 0 6px ${fillColor}` : undefined,
          }}
        />
      </div>
      {/* Percentage label */}
      <span
        className="flex-shrink-0 text-[9px] tabular-nums font-medium"
        style={{ color: fillColor, minWidth: '28px', textAlign: 'right' }}
      >
        {pct}%
      </span>
    </div>
  )
}
