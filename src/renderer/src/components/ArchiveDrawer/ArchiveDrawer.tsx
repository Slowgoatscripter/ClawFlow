import { useTaskStore } from '../../stores/taskStore'
import { useLayoutStore } from '../../stores/layoutStore'
import { useProjectStore } from '../../stores/projectStore'

const tierClasses: Record<string, string> = {
  L1: 'bg-accent-green/20 text-accent-green',
  L2: 'bg-accent-teal/20 text-accent-teal',
  L3: 'bg-accent-mauve/20 text-accent-mauve'
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr)
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

export function ArchiveDrawer() {
  const tasks = useTaskStore((s) => s.tasks)
  const unarchiveTask = useTaskStore((s) => s.unarchiveTask)
  const archiveDrawerOpen = useLayoutStore((s) => s.archiveDrawerOpen)
  const toggleArchiveDrawer = useLayoutStore((s) => s.toggleArchiveDrawer)
  const currentProject = useProjectStore((s) => s.currentProject)

  if (!archiveDrawerOpen) return null

  const archivedTasks = tasks
    .filter((t) => t.archivedAt !== null)
    .sort((a, b) => {
      // Sort descending by archivedAt (newest first)
      return new Date(b.archivedAt!).getTime() - new Date(a.archivedAt!).getTime()
    })

  const handleUnarchive = async (taskId: number) => {
    if (!currentProject) return
    await unarchiveTask(currentProject.dbPath, taskId)
  }

  return (
    // Full-screen overlay
    <div className="fixed inset-0 z-50 flex">
      {/* Backdrop */}
      <div
        className="flex-1 bg-black/40"
        onClick={toggleArchiveDrawer}
        aria-hidden="true"
      />

      {/* Slide-in panel */}
      <div className="w-96 h-full bg-surface border-l border-border flex flex-col animate-[slide-in-right_0.2s_ease-out]">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border flex-shrink-0">
          <h2 className="text-text-primary font-semibold text-base">
            Archived Tasks ({archivedTasks.length})
          </h2>
          <button
            onClick={toggleArchiveDrawer}
            className="text-text-secondary hover:text-text-primary transition-colors cursor-pointer p-1"
            aria-label="Close archive drawer"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M18 6 6 18" />
              <path d="m6 6 12 12" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-4">
          {archivedTasks.length === 0 ? (
            <div className="flex items-center justify-center h-full">
              <p className="text-text-muted text-sm">No archived tasks</p>
            </div>
          ) : (
            <ul className="flex flex-col gap-3">
              {archivedTasks.map((task) => (
                <li
                  key={task.id}
                  className="bg-elevated border border-border rounded-lg p-3 flex flex-col gap-2"
                >
                  {/* Title */}
                  <p className="text-text-primary text-sm font-medium leading-snug">
                    {task.title}
                  </p>

                  {/* Tier badge + completion date */}
                  <div className="flex items-center justify-between gap-2">
                    <span
                      className={`text-xs font-medium px-2 py-0.5 rounded-full ${tierClasses[task.tier] ?? 'bg-text-muted/20 text-text-muted'}`}
                    >
                      {task.tier}
                    </span>
                    {task.archivedAt && (
                      <span className="text-text-muted text-xs">
                        Archived {formatDate(task.archivedAt)}
                      </span>
                    )}
                  </div>

                  {/* Unarchive button */}
                  <button
                    onClick={() => handleUnarchive(task.id)}
                    className="w-full text-xs font-medium px-3 py-1.5 rounded-md bg-accent-teal/10 text-accent-teal hover:bg-accent-teal/20 transition-colors cursor-pointer"
                  >
                    Unarchive
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}
