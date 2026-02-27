import { useProjectStore } from '../../stores/projectStore'
import { useLayoutStore } from '../../stores/layoutStore'
import { useTaskStore } from '../../stores/taskStore'
import type { Project } from '../../../../shared/types'

interface ProjectCardProps {
  project: Project
}

export function ProjectCard({ project }: ProjectCardProps) {
  const openProject = useProjectStore((s) => s.openProject)
  const deleteProject = useProjectStore((s) => s.deleteProject)
  const setView = useLayoutStore((s) => s.setView)
  const loadTasks = useTaskStore((s) => s.loadTasks)

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

  return (
    <div className="bg-surface rounded-lg p-4 border border-border flex flex-col gap-2 hover:border-accent-cyan/40 transition-colors">
      <div className="flex items-start justify-between">
        <div className="min-w-0 flex-1">
          <h3 className="text-lg font-bold text-text-primary truncate">{project.name}</h3>
          <p className="text-sm text-text-muted truncate">{project.path}</p>
          <p className="text-xs text-text-muted mt-1">Last opened: {lastOpened}</p>
        </div>
      </div>
      <div className="flex items-center gap-2 mt-auto pt-2">
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
