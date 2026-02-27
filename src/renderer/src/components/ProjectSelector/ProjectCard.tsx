import { useEffect, useState } from 'react'
import { useProjectStore } from '../../stores/projectStore'
import { useLayoutStore } from '../../stores/layoutStore'
import { useTaskStore } from '../../stores/taskStore'
import type { Project, ProjectStats } from '../../../../shared/types'

interface ProjectCardProps {
  project: Project
}

export function ProjectCard({ project }: ProjectCardProps) {
  const openProject = useProjectStore((s) => s.openProject)
  const deleteProject = useProjectStore((s) => s.deleteProject)
  const setView = useLayoutStore((s) => s.setView)
  const loadTasks = useTaskStore((s) => s.loadTasks)
  const [stats, setStats] = useState<ProjectStats | null>(null)

  useEffect(() => {
    let cancelled = false
    window.api.tasks.stats(project.dbPath).then((s) => {
      if (!cancelled) setStats(s)
    }).catch(() => {})
    return () => { cancelled = true }
  }, [project.dbPath])

  const handleOpen = async () => {
    await openProject(project)
    await loadTasks(project.dbPath)
    setView('dashboard')
  }

  const handleDelete = async () => {
    await deleteProject(project.name)
  }

  const lastOpened = project.lastOpened
    ? new Date(project.lastOpened).toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      })
    : 'Never'

  const total = stats ? stats.backlog + stats.inProgress + stats.done + stats.blocked : 0
  const activeTasks = stats ? stats.inProgress : 0
  const doneTasks = stats ? stats.done : 0
  const progressPct = total > 0 ? Math.round((doneTasks / total) * 100) : 0

  return (
    <div className="bg-surface rounded-lg p-4 border border-border flex flex-col gap-3 hover:border-accent-cyan/40 hover:shadow-[0_0_12px_rgba(0,229,255,0.06)] transition-colors">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="text-lg font-bold text-text-primary truncate">{project.name}</h3>
            {activeTasks > 0 && (
              <span className="shrink-0 px-1.5 py-0.5 rounded text-[10px] font-bold bg-accent-cyan/15 text-accent-cyan border border-accent-cyan/25">
                {activeTasks} active
              </span>
            )}
          </div>
          <p className="text-sm text-text-muted truncate">{project.path}</p>
        </div>
      </div>

      {/* Progress bar */}
      {total > 0 && (
        <div className="flex items-center gap-2">
          <div className="flex-1 h-1.5 rounded-full bg-border/50 overflow-hidden">
            <div
              className="h-full rounded-full bg-accent-cyan transition-all duration-300"
              style={{ width: `${progressPct}%` }}
            />
          </div>
          <span className="text-[10px] text-text-muted shrink-0">
            {doneTasks}/{total}
          </span>
        </div>
      )}

      <p className="text-xs text-text-muted">Last activity: {lastOpened}</p>

      <div className="flex items-center gap-2 mt-auto pt-1">
        <button
          onClick={handleOpen}
          className="bg-accent-cyan text-bg px-4 py-1.5 rounded text-sm font-medium hover:opacity-90 transition-opacity cursor-pointer"
        >
          Open
        </button>
        <button
          onClick={handleDelete}
          className="text-accent-magenta text-sm hover:opacity-80 transition-opacity cursor-pointer ml-auto"
        >
          Delete
        </button>
      </div>
    </div>
  )
}
