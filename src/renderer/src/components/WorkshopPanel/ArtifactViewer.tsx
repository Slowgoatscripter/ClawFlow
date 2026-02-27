import { useEffect, useRef, useState, useCallback } from 'react'
import mermaid from 'mermaid'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { ZoomIn, ZoomOut, Maximize2 } from 'lucide-react'
import type { WorkshopArtifact } from '../../../../shared/types'

// ─── Mermaid singleton init ──────────────────────────────────────────────────

let mermaidInitialized = false
let renderCounter = 0

function ensureMermaidInit(): void {
  if (mermaidInitialized) return
  mermaid.initialize({
    startOnLoad: false,
    theme: 'dark',
    themeVariables: {
      darkMode: true,
      background: '#1a1a2e',
      primaryColor: '#2dd4bf',
      primaryTextColor: '#e2e8f0',
      lineColor: '#475569',
    },
  })
  mermaidInitialized = true
}

// ─── MermaidViewer (zoom + pan) ───────────────────────────────────────────────

function MermaidViewer({ content, id }: { content: string; id: string }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const svgWrapperRef = useRef<HTMLDivElement>(null)

  const [svg, setSvg] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })

  // Drag state stored in ref to avoid re-render on every mouse-move
  const dragging = useRef(false)
  const dragStart = useRef({ x: 0, y: 0 })
  const panAtDragStart = useRef({ x: 0, y: 0 })

  // ── Render mermaid ──
  const renderDiagram = useCallback(async (src: string, diagramId: string): Promise<string> => {
    ensureMermaidInit()
    const elemId = `mermaid-${diagramId.replace(/[^a-zA-Z0-9]/g, '')}-${++renderCounter}`
    try {
      const result = await mermaid.render(elemId, src)
      return result.svg
    } finally {
      document.getElementById(elemId)?.remove()
    }
  }, [])

  useEffect(() => {
    if (!content) return
    let cancelled = false
    setError(null)
    setSvg(null)
    renderDiagram(content, id)
      .then((rendered) => {
        if (!cancelled) setSvg(rendered)
      })
      .catch((e: any) => {
        if (!cancelled) setError(e?.message ?? 'Failed to render diagram')
      })
    return () => {
      cancelled = true
    }
  }, [content, id, renderDiagram])

  // Inject SVG into DOM after render.
  // mermaid.render() sanitizes output internally via DOMPurify before returning.
  // We use replaceChildren + insertAdjacentHTML to mount the pre-sanitized SVG,
  // matching the pattern in MermaidDiagram.tsx.
  useEffect(() => {
    if (!svgWrapperRef.current || !svg) return
    svgWrapperRef.current.replaceChildren()
    const temp = document.createElement('div')
    // mermaid output is pre-sanitized SVG (DOMPurify runs internally)
    temp.insertAdjacentHTML('afterbegin', svg)
    const svgEl = temp.firstElementChild
    if (svgEl) {
      ;(svgEl as HTMLElement).style.maxWidth = 'none'
      svgWrapperRef.current.appendChild(svgEl)
    }
  }, [svg])

  // ── Wheel zoom ──
  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault()
    setZoom((prev) => {
      const delta = e.deltaY > 0 ? -0.1 : 0.1
      return Math.min(5.0, Math.max(0.3, +(prev + delta).toFixed(2)))
    })
  }, [])

  // ── Pan drag ──
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    dragging.current = true
    dragStart.current = { x: e.clientX, y: e.clientY }
    panAtDragStart.current = pan
    e.preventDefault()
  }, [pan])

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!dragging.current) return
    const dx = e.clientX - dragStart.current.x
    const dy = e.clientY - dragStart.current.y
    setPan({ x: panAtDragStart.current.x + dx, y: panAtDragStart.current.y + dy })
  }, [])

  const handleMouseUp = useCallback(() => {
    dragging.current = false
  }, [])

  const handleReset = useCallback(() => {
    setZoom(1)
    setPan({ x: 0, y: 0 })
  }, [])

  if (error) {
    return (
      <div className="p-4 rounded-lg text-sm m-4"
        style={{
          background: 'color-mix(in srgb, var(--color-accent-magenta, #c084fc) 10%, transparent)',
          border: '1px solid color-mix(in srgb, var(--color-accent-magenta, #c084fc) 30%, transparent)',
        }}
      >
        <p className="font-medium" style={{ color: 'var(--color-accent-magenta, #c084fc)' }}>
          Diagram render error
        </p>
        <pre className="mt-2 text-xs overflow-auto text-[var(--color-text-muted)]">{error}</pre>
      </div>
    )
  }

  if (!svg) {
    return (
      <div className="flex items-center justify-center h-full text-[var(--color-text-muted)] text-sm gap-2">
        <div className="w-2 h-2 rounded-full bg-[var(--color-accent-cyan)] animate-pulse" />
        Rendering diagram...
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      {/* Controls */}
      <div className="flex items-center gap-1 px-3 py-1.5 border-b border-[var(--color-border)] flex-shrink-0">
        <button
          onClick={() => setZoom((z) => Math.max(0.3, +(z - 0.1).toFixed(2)))}
          title="Zoom out"
          className="w-6 h-6 flex items-center justify-center rounded text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] hover:bg-[var(--color-elevated)] transition-all"
        >
          <ZoomOut size={13} />
        </button>
        <span className="text-[10px] text-[var(--color-text-muted)] w-9 text-center tabular-nums">
          {Math.round(zoom * 100)}%
        </span>
        <button
          onClick={() => setZoom((z) => Math.min(5.0, +(z + 0.1).toFixed(2)))}
          title="Zoom in"
          className="w-6 h-6 flex items-center justify-center rounded text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] hover:bg-[var(--color-elevated)] transition-all"
        >
          <ZoomIn size={13} />
        </button>
        <button
          onClick={handleReset}
          title="Reset view"
          className="w-6 h-6 flex items-center justify-center rounded text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] hover:bg-[var(--color-elevated)] transition-all"
        >
          <Maximize2 size={13} />
        </button>
      </div>

      {/* Pan/zoom canvas */}
      <div
        ref={containerRef}
        className="flex-1 overflow-hidden select-none"
        style={{ cursor: 'grab' }}
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
      >
        <div
          style={{
            transform: `translate(calc(-50% + ${pan.x}px), calc(-50% + ${pan.y}px)) scale(${zoom})`,
            transformOrigin: '0 0',
            position: 'relative',
            top: '50%',
            left: '50%',
          }}
        >
          <div ref={svgWrapperRef} />
        </div>
      </div>
    </div>
  )
}

// ─── Public ArtifactViewer ────────────────────────────────────────────────────

interface ArtifactViewerProps {
  artifact: WorkshopArtifact
  content: string
}

export function ArtifactViewer({ artifact, content }: ArtifactViewerProps) {
  const isMermaid = artifact.type === 'diagram' || artifact.filePath?.endsWith('.mermaid')

  if (isMermaid) {
    return <MermaidViewer content={content} id={artifact.id} />
  }

  // Code artifacts — filePath extension gives us a hint
  const isCode =
    artifact.filePath &&
    /\.(ts|tsx|js|jsx|py|rs|go|java|c|cpp|cs|rb|sh|json|yaml|yml|toml|sql)$/i.test(
      artifact.filePath
    )

  if (isCode) {
    return (
      <div className="h-full overflow-auto p-4">
        <pre className="text-xs font-mono text-[var(--color-text-secondary)] whitespace-pre-wrap break-words leading-relaxed">
          {content}
        </pre>
      </div>
    )
  }

  // Markdown / everything else
  return (
    <div className="h-full overflow-auto p-4">
      <div className="prose prose-sm prose-invert max-w-none">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
      </div>
    </div>
  )
}
