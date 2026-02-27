import { useState } from 'react'
import { Copy, Check } from 'lucide-react'

interface CodeBlockProps {
  language: string
  code: string
}

export function CodeBlock({ language, code }: CodeBlockProps) {
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Clipboard write failed silently
    }
  }

  const displayLanguage = language || 'text'

  return (
    <div
      className="rounded-md border overflow-hidden my-2"
      style={{
        borderColor: 'var(--color-border)',
        background: 'var(--color-elevated)'
      }}
    >
      {/* Header bar */}
      <div
        className="flex items-center justify-between px-3 py-1.5 border-b"
        style={{
          borderColor: 'var(--color-border)',
          background: 'var(--color-bg)'
        }}
      >
        <span
          className="text-[10px] font-semibold tracking-widest uppercase"
          style={{ color: 'var(--color-text-muted)' }}
        >
          {displayLanguage}
        </span>
        <button
          onClick={handleCopy}
          className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] transition-all"
          style={{
            color: copied ? 'var(--color-accent-cyan)' : 'var(--color-text-muted)',
            background: 'transparent'
          }}
          title="Copy code"
        >
          {copied ? <Check size={11} /> : <Copy size={11} />}
          <span>{copied ? 'Copied' : 'Copy'}</span>
        </button>
      </div>

      {/* Code area */}
      <div className="overflow-x-auto">
        <pre
          className="px-4 py-3 text-xs font-mono leading-relaxed m-0"
          style={{ color: 'var(--color-text-primary)' }}
        >
          <code>{code}</code>
        </pre>
      </div>
    </div>
  )
}
