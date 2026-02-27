import { useState, useEffect } from 'react'
import type { KnowledgeEntry, KnowledgeCategory } from '../../../../shared/knowledge-types'
import { useKnowledgeStore } from '../../stores/knowledgeStore'
import { useProjectStore } from '../../stores/projectStore'

const CATEGORIES: { value: KnowledgeCategory; label: string }[] = [
  { value: 'business_rule', label: 'Business Rule' },
  { value: 'architecture', label: 'Architecture' },
  { value: 'api_quirk', label: 'API Quirk' },
  { value: 'lesson_learned', label: 'Lesson Learned' },
  { value: 'convention', label: 'Convention' },
]

const CATEGORY_COLORS: Record<KnowledgeCategory, string> = {
  business_rule: 'text-cyan-400 bg-cyan-400/10 border-cyan-400/30',
  architecture: 'text-violet-400 bg-violet-400/10 border-violet-400/30',
  api_quirk: 'text-orange-400 bg-orange-400/10 border-orange-400/30',
  lesson_learned: 'text-emerald-400 bg-emerald-400/10 border-emerald-400/30',
  convention: 'text-sky-400 bg-sky-400/10 border-sky-400/30',
}

interface CandidateCardProps {
  candidate: KnowledgeEntry
  dbPath: string
}

function CandidateCard({ candidate, dbPath }: CandidateCardProps) {
  const [mode, setMode] = useState<'idle' | 'edit'>('idle')
  const [editedContent, setEditedContent] = useState(candidate.content)
  const [applyGlobal, setApplyGlobal] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  const { promoteCandidate, discardCandidate, updateEntry } = useKnowledgeStore()

  const handleConfirm = async () => {
    setSubmitting(true)
    try {
      await promoteCandidate(dbPath, candidate.id, applyGlobal)
    } finally {
      setSubmitting(false)
    }
  }

  const handleEdit = async () => {
    if (!editedContent.trim()) return
    setSubmitting(true)
    try {
      await updateEntry(dbPath, candidate.id, { content: editedContent.trim() })
      await promoteCandidate(dbPath, candidate.id, applyGlobal)
    } finally {
      setSubmitting(false)
      setMode('idle')
    }
  }

  const handleDiscard = async () => {
    setSubmitting(true)
    try {
      await discardCandidate(dbPath, candidate.id)
    } finally {
      setSubmitting(false)
    }
  }

  const contentPreview =
    candidate.content.length > 200
      ? candidate.content.slice(0, 200) + '…'
      : candidate.content

  const categoryStyle = CATEGORY_COLORS[candidate.category] ?? 'text-zinc-400 bg-zinc-400/10 border-zinc-400/30'

  return (
    <div className="bg-white/5 backdrop-blur-sm border border-cyan-400/20 rounded-lg p-4 space-y-3 transition-all duration-200 hover:border-cyan-400/35 hover:bg-white/[0.07]">
      {/* Header row */}
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-mono text-xs font-semibold text-cyan-300 bg-cyan-400/10 border border-cyan-400/25 rounded px-2 py-0.5">
              {candidate.key}
            </span>
            <span className={`text-xs font-medium border rounded px-2 py-0.5 ${categoryStyle}`}>
              {CATEGORIES.find((c) => c.value === candidate.category)?.label ?? candidate.category}
            </span>
          </div>
          <p className="text-sm text-white/80 font-medium leading-snug">{candidate.summary}</p>
        </div>
      </div>

      {/* Content preview */}
      {mode === 'idle' && (
        <p className="text-xs text-white/50 font-mono leading-relaxed bg-black/20 rounded p-3 border border-white/5">
          {contentPreview}
        </p>
      )}

      {/* Edit mode */}
      {mode === 'edit' && (
        <textarea
          value={editedContent}
          onChange={(e) => setEditedContent(e.target.value)}
          className="w-full min-h-[120px] bg-black/30 border border-amber-400/40 rounded p-3 text-xs font-mono text-white/80 resize-y focus:outline-none focus:border-amber-400/70 focus:bg-black/40 transition-colors"
        />
      )}

      {/* Global toggle + action buttons */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <label className="flex items-center gap-2 cursor-pointer select-none group">
          <div className="relative">
            <input
              type="checkbox"
              checked={applyGlobal}
              onChange={(e) => setApplyGlobal(e.target.checked)}
              className="sr-only"
            />
            <div
              className={`w-8 h-4 rounded-full border transition-all duration-200 ${
                applyGlobal
                  ? 'bg-cyan-500/40 border-cyan-400/60'
                  : 'bg-white/5 border-white/20'
              }`}
            >
              <div
                className={`w-3 h-3 rounded-full mt-0.5 transition-all duration-200 ${
                  applyGlobal
                    ? 'ml-4 bg-cyan-400'
                    : 'ml-0.5 bg-white/30'
                }`}
              />
            </div>
          </div>
          <span className="text-xs text-white/50 group-hover:text-white/70 transition-colors">
            Apply to all projects
          </span>
        </label>

        <div className="flex items-center gap-2">
          {mode === 'idle' ? (
            <>
              <button
                onClick={handleConfirm}
                disabled={submitting}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium text-emerald-400 border border-emerald-400/30 bg-emerald-400/5 hover:bg-emerald-400/15 hover:border-emerald-400/50 transition-all duration-150 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                </svg>
                Confirm
              </button>
              <button
                onClick={() => setMode('edit')}
                disabled={submitting}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium text-amber-400 border border-amber-400/30 bg-amber-400/5 hover:bg-amber-400/15 hover:border-amber-400/50 transition-all duration-150 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931z" />
                </svg>
                Edit
              </button>
              <button
                onClick={handleDiscard}
                disabled={submitting}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium text-red-400/70 border border-red-400/25 bg-red-400/5 hover:bg-red-400/15 hover:border-red-400/40 transition-all duration-150 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                </svg>
                Discard
              </button>
            </>
          ) : (
            <>
              <button
                onClick={handleEdit}
                disabled={submitting || !editedContent.trim()}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium text-emerald-400 border border-emerald-400/30 bg-emerald-400/5 hover:bg-emerald-400/15 hover:border-emerald-400/50 transition-all duration-150 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                </svg>
                Save &amp; Confirm
              </button>
              <button
                onClick={() => { setMode('idle'); setEditedContent(candidate.content) }}
                disabled={submitting}
                className="px-3 py-1.5 rounded text-xs font-medium text-white/40 border border-white/10 bg-white/5 hover:bg-white/10 transition-all duration-150 disabled:opacity-40"
              >
                Cancel
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

interface AddLessonFormProps {
  dbPath: string
  onClose: () => void
}

function AddLessonForm({ dbPath, onClose }: AddLessonFormProps) {
  const [key, setKey] = useState('')
  const [summary, setSummary] = useState('')
  const [content, setContent] = useState('')
  const [category, setCategory] = useState<KnowledgeCategory>('lesson_learned')
  const [submitting, setSubmitting] = useState(false)

  const { createEntry } = useKnowledgeStore()

  const handleSave = async () => {
    if (!key.trim() || !summary.trim() || !content.trim()) return
    setSubmitting(true)
    try {
      await createEntry(dbPath, {
        key: key.trim(),
        summary: summary.trim(),
        content: content.trim(),
        category,
        tags: [],
        source: 'manual',
        status: 'active',
      })
      onClose()
    } finally {
      setSubmitting(false)
    }
  }

  const isValid = key.trim() && summary.trim() && content.trim()

  return (
    <div className="bg-white/5 backdrop-blur-sm border border-cyan-400/25 rounded-lg p-4 space-y-3">
      <h4 className="text-xs font-semibold text-cyan-400/80 uppercase tracking-wider">New Lesson</h4>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <label className="text-xs text-white/40 font-medium">Key</label>
          <input
            type="text"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder="e.g. auth-token-refresh"
            className="w-full bg-black/30 border border-white/10 rounded px-3 py-2 text-sm text-white/80 placeholder:text-white/25 focus:outline-none focus:border-cyan-400/50 transition-colors"
          />
        </div>
        <div className="space-y-1">
          <label className="text-xs text-white/40 font-medium">Category</label>
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value as KnowledgeCategory)}
            className="w-full bg-black/30 border border-white/10 rounded px-3 py-2 text-sm text-white/80 focus:outline-none focus:border-cyan-400/50 transition-colors appearance-none cursor-pointer"
          >
            {CATEGORIES.map((c) => (
              <option key={c.value} value={c.value} className="bg-zinc-900">
                {c.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="space-y-1">
        <label className="text-xs text-white/40 font-medium">Summary</label>
        <input
          type="text"
          value={summary}
          onChange={(e) => setSummary(e.target.value)}
          placeholder="One-line description..."
          className="w-full bg-black/30 border border-white/10 rounded px-3 py-2 text-sm text-white/80 placeholder:text-white/25 focus:outline-none focus:border-cyan-400/50 transition-colors"
        />
      </div>

      <div className="space-y-1">
        <label className="text-xs text-white/40 font-medium">Content</label>
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="Full details and context..."
          className="w-full min-h-[100px] bg-black/30 border border-white/10 rounded px-3 py-2 text-sm text-white/80 placeholder:text-white/25 resize-y focus:outline-none focus:border-cyan-400/50 transition-colors"
        />
      </div>

      <div className="flex items-center gap-2 pt-1">
        <button
          onClick={handleSave}
          disabled={submitting || !isValid}
          className="flex items-center gap-1.5 px-4 py-2 rounded text-xs font-semibold text-emerald-400 border border-emerald-400/30 bg-emerald-400/5 hover:bg-emerald-400/15 hover:border-emerald-400/50 transition-all duration-150 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
          </svg>
          Save Lesson
        </button>
        <button
          onClick={onClose}
          disabled={submitting}
          className="px-4 py-2 rounded text-xs font-medium text-white/40 border border-white/10 hover:bg-white/5 transition-all duration-150"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}

interface Props {
  taskId?: string
}

export function FDRLSection({ taskId }: Props) {
  const [showAddForm, setShowAddForm] = useState(false)

  const candidates = useKnowledgeStore((s) => s.candidates)
  const loadCandidates = useKnowledgeStore((s) => s.loadCandidates)
  const project = useProjectStore((s) => s.currentProject)

  const dbPath = project?.dbPath ?? ''

  useEffect(() => {
    if (dbPath) {
      loadCandidates(dbPath, taskId)
    }
  }, [dbPath, taskId, loadCandidates])

  if (!dbPath) return null
  if (candidates.length === 0 && !showAddForm) {
    return (
      <div className="pt-4 border-t border-white/5">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-semibold text-white/30 uppercase tracking-wider">Lessons Learned</span>
          <button
            onClick={() => setShowAddForm(true)}
            className="flex items-center gap-1 px-2.5 py-1 rounded text-xs font-medium text-cyan-400/60 border border-cyan-400/20 hover:bg-cyan-400/5 hover:text-cyan-400 hover:border-cyan-400/35 transition-all duration-150"
          >
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
            Add
          </button>
        </div>
        {showAddForm && (
          <AddLessonForm dbPath={dbPath} onClose={() => setShowAddForm(false)} />
        )}
      </div>
    )
  }

  return (
    <div className="pt-5 border-t border-cyan-400/10 space-y-4">
      {/* Section header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <svg className="w-4 h-4 text-cyan-400/70" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 18v-5.25m0 0a6.01 6.01 0 001.5-.189m-1.5.189a6.01 6.01 0 01-1.5-.189m3.75 7.478a12.06 12.06 0 01-4.5 0m3.75 2.383a14.406 14.406 0 01-3 0M14.25 18v-.192c0-.983.658-1.823 1.508-2.316a7.5 7.5 0 10-7.517 0c.85.493 1.509 1.333 1.509 2.316V18" />
          </svg>
          <h4 className="text-sm font-semibold text-white/70">Lessons Learned</h4>
          {candidates.length > 0 && (
            <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-cyan-400/15 border border-cyan-400/30 text-cyan-400 tabular-nums">
              {candidates.length}
            </span>
          )}
        </div>
        <button
          onClick={() => setShowAddForm((v) => !v)}
          className="flex items-center gap-1 px-2.5 py-1 rounded text-xs font-medium text-cyan-400/60 border border-cyan-400/20 hover:bg-cyan-400/5 hover:text-cyan-400 hover:border-cyan-400/35 transition-all duration-150"
        >
          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d={showAddForm ? "M19.5 12h-15" : "M12 4.5v15m7.5-7.5h-15"} />
          </svg>
          {showAddForm ? 'Close' : 'Add New Lesson'}
        </button>
      </div>

      {/* Candidate cards */}
      {candidates.length > 0 && (
        <div className="space-y-3">
          {candidates.map((candidate) => (
            <CandidateCard key={candidate.id} candidate={candidate} dbPath={dbPath} />
          ))}
        </div>
      )}

      {/* Add lesson form */}
      {showAddForm && (
        <AddLessonForm dbPath={dbPath} onClose={() => setShowAddForm(false)} />
      )}
    </div>
  )
}
