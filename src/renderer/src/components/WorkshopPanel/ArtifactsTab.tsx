import { useState } from 'react'
import { GitBranch, Code, FileText, ChevronLeft } from 'lucide-react'
import { useWorkshopStore } from '../../stores/workshopStore'
import { ArtifactViewer } from './ArtifactViewer'
import type { WorkshopArtifact, WorkshopArtifactType } from '../../../../shared/types'

// ─── Icon mapping ─────────────────────────────────────────────────────────────

function artifactIcon(type: WorkshopArtifactType, filePath: string) {
  if (type === 'diagram' || filePath?.endsWith('.mermaid')) return GitBranch
  if (
    filePath &&
    /\.(ts|tsx|js|jsx|py|rs|go|java|c|cpp|cs|rb|sh|json|yaml|yml|toml|sql)$/i.test(filePath)
  )
    return Code
  return FileText
}

function typeLabel(type: WorkshopArtifactType): string {
  switch (type) {
    case 'design_doc':
      return 'Design Doc'
    case 'diagram':
      return 'Diagram'
    case 'task_breakdown':
      return 'Tasks'
    case 'spec':
      return 'Spec'
    case 'architecture':
      return 'Architecture'
    default:
      return type
  }
}

// ─── List row ─────────────────────────────────────────────────────────────────

function ArtifactRow({
  artifact,
  onClick,
}: {
  artifact: WorkshopArtifact
  onClick: () => void
}) {
  const Icon = artifactIcon(artifact.type, artifact.filePath)

  return (
    <button
      onClick={onClick}
      className="w-full flex items-center gap-2.5 px-3 py-2.5 text-left hover:bg-[var(--color-elevated)] transition-colors group"
    >
      <Icon
        size={14}
        className="flex-shrink-0 text-[var(--color-text-muted)] group-hover:text-[var(--color-accent-cyan)] transition-colors"
      />
      <span className="flex-1 min-w-0 truncate text-xs text-[var(--color-text-secondary)] group-hover:text-[var(--color-text)] transition-colors">
        {artifact.name}
      </span>
      <span className="flex-shrink-0 text-[10px] text-[var(--color-text-muted)] px-1.5 py-0.5 rounded bg-[var(--color-elevated)] border border-[var(--color-border)]">
        {typeLabel(artifact.type)}
      </span>
    </button>
  )
}

// ─── ArtifactsTab ─────────────────────────────────────────────────────────────

export function ArtifactsTab() {
  const artifacts = useWorkshopStore((s) => s.artifacts)
  const selectedArtifactId = useWorkshopStore((s) => s.selectedArtifactId)
  const artifactContent = useWorkshopStore((s) => s.artifactContent)
  const artifactLoading = useWorkshopStore((s) => s.artifactLoading)
  const selectArtifact = useWorkshopStore((s) => s.selectArtifact)
  const clearArtifactSelection = useWorkshopStore((s) => s.clearArtifactSelection)

  // Local detail view state — driven by selectedArtifactId
  const [detailId, setDetailId] = useState<string | null>(null)

  const openDetail = (id: string) => {
    setDetailId(id)
    selectArtifact(id)
  }

  const closeDetail = () => {
    setDetailId(null)
    clearArtifactSelection()
  }

  const selectedArtifact = artifacts.find((a) => a.id === detailId)

  // ── Detail view ──
  if (detailId) {
    return (
      <div className="flex flex-col h-full">
        {/* Detail header */}
        <div className="flex items-center gap-2 px-3 py-2 border-b border-[var(--color-border)] flex-shrink-0">
          <button
            onClick={closeDetail}
            className="flex items-center gap-1 text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] transition-colors"
          >
            <ChevronLeft size={13} />
            Back
          </button>
          {selectedArtifact && (
            <>
              <span className="text-[var(--color-border)]">|</span>
              <span className="text-xs font-medium text-[var(--color-text-secondary)] truncate flex-1 min-w-0">
                {selectedArtifact.name}
              </span>
              <span className="flex-shrink-0 text-[10px] text-[var(--color-text-muted)]">
                v{selectedArtifact.currentVersion}
              </span>
            </>
          )}
        </div>

        {/* Viewer */}
        <div className="flex-1 min-h-0 overflow-hidden">
          {artifactLoading ? (
            <div className="flex items-center justify-center h-full text-[var(--color-text-muted)] text-sm gap-2">
              <div className="w-2 h-2 rounded-full bg-[var(--color-accent-cyan)] animate-pulse" />
              Loading artifact...
            </div>
          ) : selectedArtifact && artifactContent !== null ? (
            <ArtifactViewer artifact={selectedArtifact} content={artifactContent} />
          ) : selectedArtifactId && !artifactLoading ? (
            <div className="flex items-center justify-center h-full text-[var(--color-text-muted)] text-sm">
              Could not load artifact content
            </div>
          ) : null}
        </div>
      </div>
    )
  }

  // ── List view ──
  if (artifacts.length === 0) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-xs text-[var(--color-text-muted)] text-center px-4">No artifacts yet</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      {artifacts.map((artifact) => (
        <ArtifactRow key={artifact.id} artifact={artifact} onClick={() => openDetail(artifact.id)} />
      ))}
    </div>
  )
}
