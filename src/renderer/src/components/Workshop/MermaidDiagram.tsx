import { useEffect, useRef, useState } from 'react'
import mermaid from 'mermaid'

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

export function MermaidDiagram({ content, id }: { content: string; id: string }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!containerRef.current || !content) return

    const render = async () => {
      try {
        setError(null)
        const elementId = `mermaid-${id.replace(/[^a-zA-Z0-9]/g, '')}`
        const { svg } = await mermaid.render(elementId, content)
        if (containerRef.current) {
          // Mermaid.render() produces sanitized SVG output - safe to use innerHTML
          containerRef.current.innerHTML = svg
        }
      } catch (e: any) {
        setError(e.message ?? 'Failed to render diagram')
      }
    }

    render()
  }, [content, id])

  if (error) {
    return (
      <div className="p-4 bg-red-500/10 border border-red-500/30 rounded-lg text-sm text-red-400">
        <p className="font-medium">Diagram render error</p>
        <pre className="mt-2 text-xs overflow-auto">{error}</pre>
        <pre className="mt-2 text-xs text-text-muted overflow-auto">{content}</pre>
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
