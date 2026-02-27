import { useState } from 'react'
import { useProjectStore } from '../../stores/projectStore'

interface RegisterProjectModalProps {
  onClose: () => void
}

export function RegisterProjectModal({ onClose }: RegisterProjectModalProps) {
  const [name, setName] = useState('')
  const [path, setPath] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const registerProject = useProjectStore((s) => s.registerProject)

  const handleBrowse = async () => {
    const selected = await window.api.fs.pickDirectory()
    if (selected) setPath(selected)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim() || !path.trim()) return
    setSubmitting(true)
    try {
      await registerProject(name.trim(), path.trim())
      onClose()
    } catch {
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <form
        onSubmit={handleSubmit}
        className="bg-surface rounded-lg p-6 w-full max-w-md border border-border shadow-xl"
      >
        <h2 className="text-xl font-semibold text-text-primary mb-4">Register Project</h2>

        <label className="block mb-3">
          <span className="text-sm text-text-secondary mb-1 block">Project Name</span>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="my-awesome-project"
            className="w-full bg-elevated border border-border rounded px-3 py-2 text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent-cyan"
          />
        </label>

        <label className="block mb-5">
          <span className="text-sm text-text-secondary mb-1 block">Project Path</span>
          <div className="flex gap-2">
            <input
              type="text"
              value={path}
              onChange={(e) => setPath(e.target.value)}
              placeholder="/path/to/project"
              className="flex-1 bg-elevated border border-border rounded px-3 py-2 text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent-cyan"
            />
            <button
              type="button"
              onClick={handleBrowse}
              className="bg-elevated border border-border rounded px-3 py-2 text-text-secondary hover:text-text-primary hover:border-accent-cyan transition-colors cursor-pointer"
            >
              Browse
            </button>
          </div>
        </label>

        <div className="flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-text-secondary hover:text-text-primary transition-colors cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={submitting || !name.trim() || !path.trim()}
            className="bg-accent-cyan text-bg px-4 py-2 rounded font-medium hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
          >
            {submitting ? 'Registering...' : 'Register'}
          </button>
        </div>
      </form>
    </div>
  )
}
