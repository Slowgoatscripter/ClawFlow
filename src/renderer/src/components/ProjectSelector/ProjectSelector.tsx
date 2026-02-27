import { useEffect, useState } from 'react'
import { useProjectStore } from '../../stores/projectStore'
import { ProjectCard } from './ProjectCard'
import { RegisterProjectModal } from './RegisterProjectModal'

export function ProjectSelector() {
  const [showModal, setShowModal] = useState(false)
  const projects = useProjectStore((s) => s.projects)
  const loading = useProjectStore((s) => s.loading)
  const loadProjects = useProjectStore((s) => s.loadProjects)

  useEffect(() => {
    loadProjects()
  }, [loadProjects])

  return (
    <div className="h-full bg-bg flex flex-col items-center justify-center px-6">
      <div className="w-full max-w-2xl flex flex-col items-center">
        {/* Wordmark */}
        <div className="relative flex flex-col items-center">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(0,229,255,0.08)_0%,transparent_70%)] pointer-events-none" />
          <h1 className="text-3xl font-bold tracking-widest bg-gradient-to-r from-accent-cyan to-accent-violet bg-clip-text text-transparent mb-1">CLAWFLOW</h1>
          <p className="text-text-muted mb-8">Autonomous Development Pipeline</p>
        </div>

        {/* Register Button */}
        <button
          onClick={() => setShowModal(true)}
          className="bg-gradient-to-r from-accent-cyan to-accent-violet text-bg px-5 py-2 rounded font-medium hover:opacity-90 transition-opacity cursor-pointer mb-8"
        >
          Register Project
        </button>

        {/* Project List */}
        {loading ? (
          <p className="text-text-muted">Loading projects...</p>
        ) : projects.length === 0 ? (
          <p className="text-text-muted">No projects registered yet</p>
        ) : (
          <div className="w-full grid grid-cols-1 sm:grid-cols-2 gap-4">
            {projects.map((project) => (
              <ProjectCard key={project.name} project={project} />
            ))}
          </div>
        )}
      </div>

      {/* Register Modal */}
      {showModal && <RegisterProjectModal onClose={() => setShowModal(false)} />}
    </div>
  )
}
