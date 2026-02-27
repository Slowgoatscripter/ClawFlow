interface DiffViewerProps {
  diff: string
  fileName?: string
}

function classifyLine(line: string): string {
  if (line.startsWith('+++') || line.startsWith('---')) {
    return 'text-text-muted'
  }
  if (line.startsWith('+')) {
    return 'text-accent-green bg-accent-green/8'
  }
  if (line.startsWith('-')) {
    return 'text-accent-magenta bg-accent-magenta/8'
  }
  if (line.startsWith('@@')) {
    return 'text-accent-cyan'
  }
  return 'text-text-primary'
}

export function DiffViewer({ diff, fileName }: DiffViewerProps) {
  const lines = diff.split('\n')

  return (
    <div className="rounded-lg border border-border overflow-hidden bg-surface">
      {fileName && (
        <div className="px-4 py-2 bg-elevated border-b border-border text-sm font-medium text-text-secondary font-mono truncate">
          {fileName}
        </div>
      )}
      <div className="overflow-x-auto">
        <pre className="text-xs font-mono leading-relaxed">
          {lines.map((line, i) => (
            <div key={i} className={`flex ${classifyLine(line)}`}>
              <span className="w-12 shrink-0 text-right pr-3 select-none text-text-muted/50 border-r border-border/30">
                {i + 1}
              </span>
              <span className="pl-3 pr-4 whitespace-pre">{line}</span>
            </div>
          ))}
        </pre>
      </div>
    </div>
  )
}
