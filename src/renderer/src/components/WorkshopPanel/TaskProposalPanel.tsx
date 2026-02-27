import { useMemo } from 'react'
import { X, AlertTriangle, CheckCircle, Rocket, Pencil, ListPlus } from 'lucide-react'

interface ProposedTask {
  title: string
  objective: string
  files: Array<{ path: string; action: 'create' | 'modify' }>
  skill?: string
}

interface TaskProposalPanelProps {
  groupTitle: string
  tasks: ProposedTask[]
  onLaunch: () => void
  onEdit: () => void
  onQueue: () => void
  onClose: () => void
}

/**
 * Detect file conflicts: any file path that appears in more than one task.
 * Returns a Set of conflicting file paths.
 */
function detectFileConflicts(tasks: ProposedTask[]): Set<string> {
  const fileOwners = new Map<string, number>()
  for (const task of tasks) {
    for (const f of task.files) {
      fileOwners.set(f.path, (fileOwners.get(f.path) ?? 0) + 1)
    }
  }
  const conflicts = new Set<string>()
  for (const [path, count] of fileOwners) {
    if (count > 1) conflicts.add(path)
  }
  return conflicts
}

export function TaskProposalPanel({
  groupTitle,
  tasks,
  onLaunch,
  onEdit,
  onQueue,
  onClose,
}: TaskProposalPanelProps) {
  const conflicts = useMemo(() => detectFileConflicts(tasks), [tasks])
  const hasConflicts = conflicts.size > 0

  return (
    <div
      className="fixed bottom-4 left-4 z-30 w-[420px] max-w-[calc(100vw-2rem)] max-h-[70vh] flex flex-col bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl shadow-2xl animate-[proposal-in_0.25s_ease-out]"
      style={{
        // Custom keyframes defined inline for the enter animation
      }}
    >
      {/* Inline keyframes for entrance animation */}
      <style>{`
        @keyframes proposal-in {
          from { opacity: 0; transform: translateY(12px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>

      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-[var(--color-border)] flex-shrink-0">
        <span className="text-[10px] font-semibold tracking-[0.15em] uppercase text-[var(--color-accent-cyan)]">
          Task Proposals
        </span>
        <div className="flex-1" />
        <button
          onClick={onClose}
          className="w-6 h-6 flex items-center justify-center rounded text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-elevated)] transition-all"
          title="Close"
        >
          <X size={14} />
        </button>
      </div>

      {/* Group title */}
      <div className="px-4 pt-3 pb-2">
        <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">{groupTitle}</h3>
      </div>

      {/* Conflict / success banner */}
      {hasConflicts ? (
        <div className="mx-4 mb-2 flex items-center gap-2 px-3 py-2 rounded-lg bg-accent-magenta/10 border border-accent-magenta/30 text-accent-magenta text-xs font-medium">
          <AlertTriangle size={13} className="flex-shrink-0" />
          <span>File conflicts detected — resolve before launching</span>
        </div>
      ) : (
        <div className="mx-4 mb-2 flex items-center gap-2 px-3 py-2 rounded-lg bg-accent-green/10 border border-accent-green/30 text-accent-green text-xs font-medium">
          <CheckCircle size={13} className="flex-shrink-0" />
          <span>No file conflicts detected</span>
        </div>
      )}

      {/* Scrollable task list */}
      <div className="flex-1 min-h-0 overflow-y-auto px-4 pb-2">
        <div className="space-y-3">
          {tasks.map((task, idx) => (
            <div
              key={idx}
              className="bg-[var(--color-elevated)] rounded-lg p-3 space-y-2"
            >
              {/* Task header */}
              <div className="flex items-start gap-2">
                <span className="flex-shrink-0 w-5 h-5 rounded-full bg-accent-cyan/15 text-accent-cyan text-[10px] font-bold flex items-center justify-center">
                  {idx + 1}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-[var(--color-text-primary)] leading-snug">
                    {task.title}
                  </p>
                  <p className="text-xs text-[var(--color-text-secondary)] mt-0.5 leading-relaxed">
                    {task.objective}
                  </p>
                </div>
                {task.skill && (
                  <span className="flex-shrink-0 text-[9px] font-semibold px-1.5 py-0.5 rounded bg-accent-violet/15 text-accent-violet">
                    {task.skill}
                  </span>
                )}
              </div>

              {/* File assignments */}
              {task.files.length > 0 && (
                <div className="space-y-0.5 pl-7">
                  {task.files.map((f, fi) => {
                    const isConflict = conflicts.has(f.path)
                    return (
                      <div
                        key={fi}
                        className={`flex items-center gap-1.5 text-xs font-mono ${
                          isConflict ? 'text-accent-magenta' : 'text-[var(--color-text-secondary)]'
                        }`}
                      >
                        <span
                          className={`px-1 py-0.5 rounded text-[9px] font-semibold flex-shrink-0 ${
                            isConflict
                              ? 'bg-accent-magenta/20 text-accent-magenta'
                              : f.action === 'create'
                                ? 'bg-accent-green/20 text-accent-green'
                                : 'bg-accent-cyan/20 text-accent-cyan'
                          }`}
                        >
                          {f.action}
                        </span>
                        <span className="truncate">{f.path}</span>
                        {isConflict && (
                          <AlertTriangle size={10} className="flex-shrink-0 text-accent-magenta" />
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Action buttons */}
      <div className="flex items-center gap-2 px-4 py-3 border-t border-[var(--color-border)] flex-shrink-0">
        <button
          onClick={onLaunch}
          disabled={hasConflicts}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
            hasConflicts
              ? 'bg-text-muted/20 text-text-muted cursor-not-allowed'
              : 'bg-accent-green/15 text-accent-green hover:bg-accent-green/25'
          }`}
        >
          <Rocket size={12} />
          Launch Group
        </button>
        <button
          onClick={onEdit}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-accent-cyan/15 text-accent-cyan hover:bg-accent-cyan/25 transition-colors"
        >
          <Pencil size={12} />
          Edit Tasks
        </button>
        <button
          onClick={onQueue}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-[var(--color-elevated)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-border)] transition-colors"
        >
          <ListPlus size={12} />
          Queue
        </button>
      </div>
    </div>
  )
}
