import { Component, useRef, useState, type ReactNode, type ErrorInfo } from 'react'
import { useWorkshopStore } from '../../stores/workshopStore'
import { MermaidDiagram } from './MermaidDiagram'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { WorkshopArtifact } from '../../../../shared/types'

class ArtifactErrorBoundary extends Component<
  { children: ReactNode; artifactId: string },
  { error: string | null }
> {
  state = { error: null as string | null }

  static getDerivedStateFromError(error: Error) {
    return { error: error.message }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[ArtifactPanel] render error:', error.message, info.componentStack)
  }

  componentDidUpdate(prevProps: { artifactId: string }) {
    if (prevProps.artifactId !== this.props.artifactId) {
      this.setState({ error: null })
    }
  }

  render() {
    if (this.state.error) {
      return (
        <div className="p-4 bg-red-500/10 border border-red-500/30 rounded-lg text-sm text-red-400 m-4">
          <p className="font-medium">Render error</p>
          <pre className="mt-2 text-xs overflow-auto">{this.state.error}</pre>
        </div>
      )
    }
    return this.props.children
  }
}

export function ArtifactPanel() {
  const artifacts = useWorkshopStore((s) => s.artifacts)
  const selectedArtifactId = useWorkshopStore((s) => s.selectedArtifactId)
  const artifactContent = useWorkshopStore((s) => s.artifactContent)
  const artifactLoading = useWorkshopStore((s) => s.artifactLoading)
  const [expanded, setExpanded] = useState(false)

  const cachedArtifactsRef = useRef<WorkshopArtifact[]>([])
  if (artifacts.length > 0) {
    cachedArtifactsRef.current = artifacts
  }
  const displayArtifacts = artifacts.length > 0 ? artifacts : cachedArtifactsRef.current

  const selectedArtifact = displayArtifacts.find((a) => a.id === selectedArtifactId)

  if (displayArtifacts.length === 0) {
    return (
      <div className="w-96 flex-shrink-0 border-l border-border bg-surface/30 flex items-center justify-center">
        <p className="text-text-muted text-sm text-center px-6">
          Artifacts will appear here as Claude creates documents and diagrams
        </p>
      </div>
    )
  }

  // Fullscreen overlay
  if (expanded && selectedArtifact && artifactContent !== null) {
    return (
      <>
        {/* Keep the side panel slot so layout doesn't shift */}
        <div className="w-96 flex-shrink-0 border-l border-border bg-surface/30" />

        {/* Fullscreen overlay */}
        <div className="fixed inset-0 z-50 bg-bg/95 flex flex-col">
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-border">
            <div className="flex items-center gap-3">
              <h2 className="text-lg font-semibold text-text">{selectedArtifact.name}</h2>
              <span className="text-sm text-text-muted">v{selectedArtifact.currentVersion}</span>
              <span className="text-xs text-text-muted/60 px-2 py-0.5 rounded bg-surface border border-border">
                {selectedArtifact.type}
              </span>
            </div>
            <button
              onClick={() => setExpanded(false)}
              className="px-3 py-1.5 rounded-md text-sm font-medium bg-surface border border-border text-text-muted hover:text-text hover:border-accent-teal transition-colors"
            >
              Close
            </button>
          </div>

          {/* Content */}
          <div className="flex-1 min-h-0 overflow-auto p-8">
            <div className="max-w-5xl mx-auto">
              <ArtifactErrorBoundary artifactId={selectedArtifact.id}>
                <ArtifactContent artifact={selectedArtifact} content={artifactContent} />
              </ArtifactErrorBoundary>
            </div>
          </div>
        </div>
      </>
    )
  }

  return (
    <div className="w-96 flex-shrink-0 border-l border-border bg-surface/30 flex flex-col h-full">
      <div className="flex overflow-x-auto border-b border-border">
        {displayArtifacts.map((artifact) => (
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

      <div className="flex-1 min-h-0 overflow-y-auto">
        {artifactLoading ? (
          <div className="p-4 flex items-center gap-2 text-text-muted text-sm">
            <div className="w-2 h-2 rounded-full bg-accent-teal animate-pulse" />
            Loading artifact...
          </div>
        ) : selectedArtifact && artifactContent !== null ? (
          <div>
            {/* Expand button */}
            <div className="flex justify-end px-4 pt-3">
              <button
                onClick={() => setExpanded(true)}
                className="text-xs text-text-muted hover:text-accent-teal transition-colors flex items-center gap-1"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5v-4m0 4h-4m4 0l-5-5" />
                </svg>
                Expand
              </button>
            </div>

            <ArtifactErrorBoundary artifactId={selectedArtifact.id}>
              <ArtifactViewer artifact={selectedArtifact} content={artifactContent} />
            </ArtifactErrorBoundary>
          </div>
        ) : selectedArtifactId ? (
          <div className="p-4 text-text-muted text-sm">
            Could not load artifact content
          </div>
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
  return (
    <div className="p-4 pt-1">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-text">{artifact.name}</h3>
        <span className="text-xs text-text-muted">v{artifact.currentVersion}</span>
      </div>
      <ArtifactContent artifact={artifact} content={content} />
    </div>
  )
}

function ArtifactContent({
  artifact,
  content,
}: {
  artifact: WorkshopArtifact
  content: string
}) {
  const isDiagram = artifact.type === 'diagram' || artifact.filePath?.endsWith('.mermaid')

  if (isDiagram) {
    return <MermaidDiagram content={content} id={artifact.id} />
  }

  return (
    <div className="prose prose-sm prose-invert max-w-none">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
    </div>
  )
}
