import { useWorkshopStore } from '../../stores/workshopStore'
import { MermaidDiagram } from './MermaidDiagram'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { WorkshopArtifact } from '../../../../shared/types'

export function ArtifactPanel() {
  const artifacts = useWorkshopStore((s) => s.artifacts)
  const selectedArtifactId = useWorkshopStore((s) => s.selectedArtifactId)
  const artifactContent = useWorkshopStore((s) => s.artifactContent)

  const selectedArtifact = artifacts.find((a) => a.id === selectedArtifactId)

  if (artifacts.length === 0) {
    return (
      <div className="w-96 border-l border-border bg-surface/30 flex items-center justify-center">
        <p className="text-text-muted text-sm text-center px-6">
          Artifacts will appear here as Claude creates documents and diagrams
        </p>
      </div>
    )
  }

  return (
    <div className="w-96 border-l border-border bg-surface/30 flex flex-col">
      <div className="flex overflow-x-auto border-b border-border">
        {artifacts.map((artifact) => (
          <button
            key={artifact.id}
            onClick={() => useWorkshopStore.getState().selectArtifact(artifact.id)}
            className={`px-3 py-2 text-xs font-medium whitespace-nowrap border-b-2 transition-colors ${
              artifact.id === selectedArtifactId
                ? 'border-accent-teal text-accent-teal'
                : 'border-transparent text-text-muted hover:text-text'
            }`}
          >
            {artifact.name}
            <span className="ml-1 text-text-muted/60">v{artifact.currentVersion}</span>
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto">
        {selectedArtifact && artifactContent ? (
          <ArtifactViewer artifact={selectedArtifact} content={artifactContent} />
        ) : (
          <div className="p-4 text-text-muted text-sm">
            Select an artifact tab to view it
          </div>
        )}
      </div>
    </div>
  )
}

function ArtifactViewer({
  artifact,
  content,
}: {
  artifact: WorkshopArtifact
  content: string
}) {
  const isDiagram = artifact.type === 'diagram' || artifact.filePath?.endsWith('.mermaid')

  return (
    <div className="p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-text">{artifact.name}</h3>
        <span className="text-xs text-text-muted">v{artifact.currentVersion}</span>
      </div>

      {isDiagram ? (
        <MermaidDiagram content={content} id={artifact.id} />
      ) : (
        <div className="prose prose-sm prose-invert max-w-none">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
        </div>
      )}
    </div>
  )
}
