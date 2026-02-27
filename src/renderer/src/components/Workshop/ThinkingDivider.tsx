interface ThinkingDividerProps {
  isActive?: boolean
}

export function ThinkingDivider({ isActive = false }: ThinkingDividerProps) {
  return (
    <div className="flex items-center gap-2 my-2">
      <div className="flex-1 h-px bg-border/50" />
      {isActive ? (
        <span className="text-xs text-text-muted flex items-center gap-1">
          <span className="flex gap-0.5">
            <span className="w-1 h-1 rounded-full bg-accent-cyan shadow-[0_0_4px_rgba(0,229,255,0.3)] animate-bounce [animation-delay:0ms]" />
            <span className="w-1 h-1 rounded-full bg-accent-cyan shadow-[0_0_4px_rgba(0,229,255,0.3)] animate-bounce [animation-delay:150ms]" />
            <span className="w-1 h-1 rounded-full bg-accent-cyan shadow-[0_0_4px_rgba(0,229,255,0.3)] animate-bounce [animation-delay:300ms]" />
          </span>
          thinking
        </span>
      ) : (
        <span className="text-[10px] text-text-muted/40">·</span>
      )}
      <div className="flex-1 h-px bg-border/50" />
    </div>
  )
}
