export function TitleBar() {
  return (
    <div
      className="relative flex items-center justify-between w-full h-8 bg-surface/70 backdrop-blur-md select-none shrink-0"
      style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
    >
      {/* Left: wordmark */}
      <span className="pl-20 text-xs font-semibold tracking-widest bg-gradient-to-r from-accent-cyan to-accent-violet bg-clip-text text-transparent">
        CLAWFLOW
      </span>

      {/* Right: window controls */}
      <div
        className="flex items-center h-full"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        {/* Minimize */}
        <button
          onClick={() => window.api.window.minimize()}
          className="h-full w-11 flex items-center justify-center text-text-muted hover:bg-white/10 hover:text-text-primary transition-colors"
          aria-label="Minimize"
        >
          <svg width="10" height="1" viewBox="0 0 10 1" fill="currentColor">
            <rect width="10" height="1" />
          </svg>
        </button>

        {/* Maximize / Restore */}
        <button
          onClick={() => window.api.window.maximize()}
          className="h-full w-11 flex items-center justify-center text-text-muted hover:bg-white/10 hover:text-text-primary transition-colors"
          aria-label="Maximize"
        >
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1">
            <rect x="0.5" y="0.5" width="9" height="9" />
          </svg>
        </button>

        {/* Close */}
        <button
          onClick={() => window.api.window.close()}
          className="h-full w-11 flex items-center justify-center text-text-muted hover:bg-accent-magenta hover:text-white transition-colors"
          aria-label="Close"
        >
          <svg width="10" height="10" viewBox="0 0 10 10" stroke="currentColor" strokeWidth="1.2">
            <line x1="0" y1="0" x2="10" y2="10" />
            <line x1="10" y1="0" x2="0" y2="10" />
          </svg>
        </button>
      </div>
      <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-accent-cyan via-transparent to-accent-magenta" />
    </div>
  )
}
