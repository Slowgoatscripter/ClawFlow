import { useState } from 'react'
import type { Tier, Priority } from '../../../../shared/types'
import { Modal } from '../common/Modal'
import { useTaskStore } from '../../stores/taskStore'
import { useProjectStore } from '../../stores/projectStore'

interface CreateTaskModalProps {
  isOpen: boolean
  onClose: () => void
}

const TIERS: { value: Tier; label: string }[] = [
  { value: 'L1', label: 'L1 Quick' },
  { value: 'L2', label: 'L2 Standard' },
  { value: 'L3', label: 'L3 Full' }
]

const tierActiveColors: Record<Tier, string> = {
  L1: 'bg-accent-green/20 text-accent-green border-accent-green',
  L2: 'bg-accent-teal/20 text-accent-teal border-accent-teal',
  L3: 'bg-accent-mauve/20 text-accent-mauve border-accent-mauve'
}

const PRIORITIES: { value: Priority; label: string }[] = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'critical', label: 'Critical' }
]

const priorityActiveColors: Record<Priority, string> = {
  low: 'bg-text-muted/20 text-text-muted border-text-muted',
  medium: 'bg-accent-teal/20 text-accent-teal border-accent-teal',
  high: 'bg-accent-peach/20 text-accent-peach border-accent-peach',
  critical: 'bg-accent-red/20 text-accent-red border-accent-red'
}

export function CreateTaskModal({ isOpen, onClose }: CreateTaskModalProps) {
  const createTask = useTaskStore((s) => s.createTask)
  const currentProject = useProjectStore((s) => s.currentProject)
  const openProject = useProjectStore((s) => s.openProject)

  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [tier, setTier] = useState<Tier>('L2')
  const [priority, setPriority] = useState<Priority>('medium')
  const [autoMode, setAutoMode] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  if (!isOpen) return null

  const handleCreate = async () => {
    if (!title.trim() || !currentProject) return
    setSubmitting(true)
    try {
      await createTask(currentProject.dbPath, {
        title: title.trim(),
        description: description.trim(),
        tier,
        priority,
        autoMode
      })
      // Refresh stats
      await openProject(currentProject)
      onClose()
      // Reset form
      setTitle('')
      setDescription('')
      setTier('L2')
      setPriority('medium')
      setAutoMode(false)
    } finally {
      setSubmitting(false)
    }
  }

  const inactiveBtn = 'border border-border text-text-secondary hover:text-text-primary'

  return (
    <Modal onClose={onClose}>
      <h2 className="text-xl font-semibold text-text-primary mb-4">Create Task</h2>

      {/* Title */}
      <input
        type="text"
        placeholder="Task title"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        className="w-full bg-elevated border border-border rounded px-3 py-2 text-text-primary placeholder:text-text-muted mb-3 outline-none focus:border-accent-teal transition-colors"
      />

      {/* Description */}
      <textarea
        placeholder="Description (optional)"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        className="w-full bg-elevated border border-border rounded px-3 py-2 text-text-primary placeholder:text-text-muted min-h-[100px] mb-4 outline-none focus:border-accent-teal transition-colors resize-y"
      />

      {/* Tier */}
      <label className="text-xs text-text-muted mb-1.5 block">Tier</label>
      <div className="flex gap-2 mb-4">
        {TIERS.map((t) => (
          <button
            key={t.value}
            onClick={() => setTier(t.value)}
            className={`flex-1 text-xs font-medium px-3 py-1.5 rounded border transition-colors cursor-pointer ${
              tier === t.value ? tierActiveColors[t.value] : inactiveBtn
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Priority */}
      <label className="text-xs text-text-muted mb-1.5 block">Priority</label>
      <div className="flex gap-2 mb-4">
        {PRIORITIES.map((p) => (
          <button
            key={p.value}
            onClick={() => setPriority(p.value)}
            className={`flex-1 text-xs font-medium px-3 py-1.5 rounded border transition-colors cursor-pointer ${
              priority === p.value ? priorityActiveColors[p.value] : inactiveBtn
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>

      {/* Auto Mode */}
      <label className="flex items-center gap-2 mb-6 cursor-pointer">
        <input
          type="checkbox"
          checked={autoMode}
          onChange={(e) => setAutoMode(e.target.checked)}
          className="accent-accent-teal w-4 h-4"
        />
        <span className="text-sm text-text-secondary">Auto Mode</span>
      </label>

      {/* Footer */}
      <div className="flex justify-end gap-3">
        <button
          onClick={onClose}
          className="px-4 py-2 text-sm text-text-secondary hover:text-text-primary transition-colors cursor-pointer"
        >
          Cancel
        </button>
        <button
          onClick={handleCreate}
          disabled={!title.trim() || submitting}
          className="px-4 py-2 text-sm font-medium bg-accent-teal text-bg rounded-lg hover:opacity-90 transition-opacity disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed"
        >
          {submitting ? 'Creating...' : 'Create'}
        </button>
      </div>
    </Modal>
  )
}
