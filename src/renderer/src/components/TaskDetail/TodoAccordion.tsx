import { useState } from 'react'
import type { TodoItem } from '../../../../shared/types'

const stageLabels: Record<string, string> = {
  brainstorm: 'Brainstorming',
  design_review: 'Design Review',
  plan: 'Planning',
  implement: 'Implementing',
  code_review: 'Code Review',
  verify: 'Verifying'
}

const stageOrder = ['verify', 'code_review', 'implement', 'plan', 'design_review', 'brainstorm']

function StatusIcon({ status }: { status: string }) {
  if (status === 'completed') return <span className="text-accent-green">&#10003;</span>
  if (status === 'in_progress') return <span className="text-accent-cyan animate-pulse">&#9679;</span>
  return <span className="text-text-muted">&#9675;</span>
}

export function TodoAccordion({ todos, currentStage }: { todos: Record<string, TodoItem[]>; currentStage?: string }) {
  const populatedStages = stageOrder.filter(s => todos[s]?.length > 0)
  const [expanded, setExpanded] = useState<Set<string>>(
    new Set(currentStage && todos[currentStage] ? [currentStage] : populatedStages.slice(0, 1))
  )

  if (populatedStages.length === 0) return null

  const toggle = (stage: string) => {
    setExpanded(prev => {
      const next = new Set(prev)
      next.has(stage) ? next.delete(stage) : next.add(stage)
      return next
    })
  }

  return (
    <div className="space-y-2">
      <h2 className="text-sm font-semibold text-text-muted uppercase tracking-wide">Task Progress</h2>
      {populatedStages.map(stage => {
        const items = todos[stage]
        const done = items.filter(t => t.status === 'completed').length
        const allDone = done === items.length
        const isOpen = expanded.has(stage)

        return (
          <div key={stage} className="bg-elevated rounded-lg overflow-hidden">
            <button
              onClick={() => toggle(stage)}
              className="w-full flex items-center justify-between px-4 py-2.5 text-sm hover:bg-surface transition-colors"
            >
              <span className="flex items-center gap-2">
                <span className="text-text-muted">{isOpen ? '\u25BC' : '\u25B6'}</span>
                <span className="text-text-primary font-medium">{stageLabels[stage] || stage}</span>
                <span className="text-text-muted">({done}/{items.length})</span>
              </span>
              {allDone && <span className="text-accent-green text-xs">&#10003;</span>}
            </button>
            {isOpen && (
              <div className="px-4 pb-3 space-y-1.5">
                {items.map(item => (
                  <div key={item.id} className="flex items-start gap-2 text-sm">
                    <StatusIcon status={item.status} />
                    <span className={item.status === 'completed' ? 'text-text-muted line-through' : 'text-text-primary'}>
                      {item.subject}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
