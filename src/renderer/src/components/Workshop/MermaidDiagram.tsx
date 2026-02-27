import { useEffect, useRef, useState, useCallback } from 'react'
import mermaid from 'mermaid'

let mermaidInitialized = false
let renderCounter = 0

function ensureMermaidInit() {
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

export function MermaidDiagram({ content, id }: { content: string; id: string }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [error, setError] = useState<string | null>(null)
  const [svg, setSvg] = useState<string | null>(null)

  const renderDiagram = useCallback(async (diagramContent: string, diagramId: string) => {
    ensureMermaidInit()
    const elementId = `mermaid-${diagramId.replace(/[^a-zA-Z0-9]/g, '')}-${++renderCounter}`
    try {
      const result = await mermaid.render(elementId, diagramContent)
      return result.svg
    } finally {
      // Clean up the temp element Mermaid inserts into the document during rendering
      const tempEl = document.getElementById(elementId)
      if (tempEl) tempEl.remove()
    }
  }, [])

  useEffect(() => {
    if (!content) return

    let cancelled = false

    setError(null)
    renderDiagram(content, id)
      .then((renderedSvg) => {
        if (!cancelled) {
          setSvg(renderedSvg)
        }
      })
      .catch((e: any) => {
        if (!cancelled) {
          setError(e.message ?? 'Failed to render diagram')
        }
      })

    return () => {
      cancelled = true
    }
  }, [content, id, renderDiagram])

  // Write SVG to DOM via ref - mermaid.render() sanitizes output internally via DOMPurify
  useEffect(() => {
    if (containerRef.current && svg) {
      containerRef.current.replaceChildren()
      const wrapper = document.createElement('div')
      wrapper.insertAdjacentHTML('afterbegin', svg) // mermaid output is pre-sanitized SVG
      const svgEl = wrapper.firstElementChild
      if (svgEl) {
        containerRef.current.appendChild(svgEl)
      }
    }
  }, [svg])

  if (error) {
    return (
      <div className="p-4 bg-accent-magenta/10 border border-accent-magenta/30 rounded-lg text-sm text-accent-magenta">
        <p className="font-medium">Diagram render error</p>
        <pre className="mt-2 text-xs overflow-auto">{error}</pre>
        <pre className="mt-2 text-xs text-text-muted overflow-auto">{content}</pre>
      </div>
    )
  }

  if (!svg) {
    return (
      <div className="w-full flex items-center justify-center p-4 text-text-muted text-sm">
        <div className="w-2 h-2 rounded-full bg-accent-cyan animate-pulse mr-2" />
        Rendering diagram...
      </div>
    )
  }

  return (
    <div
      ref={containerRef}
      className="w-full overflow-auto flex items-center justify-center p-4"
    />
  )
}
