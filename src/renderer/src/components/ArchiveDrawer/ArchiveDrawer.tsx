import { useState } from 'react'
import { useTaskStore } from '../../stores/taskStore'
import { useLayoutStore } from '../../stores/layoutStore'
import { useProjectStore } from '../../stores/projectStore'

const tierClasses: Record<string, string> = {
  L1: 'bg-accent-green/20 text-accent-green',
  L2: 'bg-accent-cyan/20 text-accent-cyan',
  L3: 'bg-accent-violet/20 text-accent-violet'
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr)
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

export function ArchiveDrawer() {
  const tasks = useTaskStore((s) => s.tasks)
  const unarchiveTask = useTaskStore((s) => s.unarchiveTask)
  const deleteTask = useTaskStore((s) => s.deleteTask)
  const archiveDrawerOpen = useLayoutStore((s) => s.archiveDrawerOpen)
  const toggleArchiveDrawer = useLayoutStore((s) => s.toggleArchiveDrawer)
  const currentProject = useProjectStore((s) => s.currentProject)
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null)

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

  const handleDelete = async (taskId: number) => {
    if (!currentProject) return
    await deleteTask(currentProject.dbPath, taskId)
    setConfirmDeleteId(null)
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
      <div className="w-96 h-full bg-surface/60 backdrop-blur-lg border-l border-border flex flex-col animate-[slide-in-right_0.3s_cubic-bezier(0.4,0,0.2,1)]">
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

                  {/* Action buttons */}
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleUnarchive(task.id)}
                      className="flex-1 text-xs font-medium px-3 py-1.5 rounded-md bg-accent-cyan/10 text-accent-cyan hover:bg-accent-cyan/20 transition-colors cursor-pointer"
                    >
                      Unarchive
                    </button>
                    {confirmDeleteId === task.id ? (
                      <div className="flex gap-1">
                        <button
                          onClick={() => handleDelete(task.id)}
                          className="text-xs font-medium px-3 py-1.5 rounded-md bg-accent-magenta/20 text-accent-magenta hover:bg-accent-magenta/30 transition-colors cursor-pointer"
                        >
                          Confirm
                        </button>
                        <button
                          onClick={() => setConfirmDeleteId(null)}
                          className="text-xs px-2 py-1.5 rounded-md text-text-muted hover:text-text-primary transition-colors cursor-pointer"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => setConfirmDeleteId(task.id)}
                        className="text-xs font-medium px-3 py-1.5 rounded-md bg-accent-magenta/10 text-accent-magenta hover:bg-accent-magenta/20 transition-colors cursor-pointer"
                      >
                        Delete
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}
