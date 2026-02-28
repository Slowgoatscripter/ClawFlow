import type { TodoItem } from '../../../../shared/types'
import { usePipelineStore } from '../../stores/pipelineStore'

interface CanvasTodoStripProps {
  taskId: number
}

export function CanvasTodoStrip({ taskId }: CanvasTodoStripProps) {
  const stageTodos = usePipelineStore((s) => s.todosByTaskId[taskId])

  if (!stageTodos) return null

  // Flatten all todos across all stages
  const allTodos: TodoItem[] = Object.values(stageTodos).flat()

  if (allTodos.length === 0) return null

  const total = allTodos.length
  const completed = allTodos.filter((t) => t.status === 'completed').length
  const inProgress = allTodos.find((t) => t.status === 'in_progress')
  const progressPct = total > 0 ? (completed / total) * 100 : 0

  const currentText = inProgress
    ? inProgress.subject.length > 40
      ? inProgress.subject.slice(0, 40) + '…'
      : inProgress.subject
    : null

  return (
    <div style={{ padding: '4px 8px 2px' }}>
      {/* Progress bar */}
      <div
        style={{
          height: '4px',
          borderRadius: '2px',
          backgroundColor: 'var(--color-border)',
          overflow: 'hidden',
          marginBottom: '3px',
        }}
      >
        <div
          style={{
            height: '100%',
            width: `${progressPct}%`,
            backgroundColor: 'var(--color-accent-green)',
            borderRadius: '2px',
            transition: 'width 0.3s ease',
          }}
        />
      </div>

      {/* Bottom row: count + current item */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
        <span
          style={{
            fontSize: '11px',
            color: 'var(--color-text-secondary)',
            flexShrink: 0,
          }}
        >
          {completed}/{total}
        </span>
        {currentText && (
          <span
            style={{
              fontSize: '11px',
              color: 'var(--color-text-muted)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            · {currentText}
          </span>
        )}
      </div>
    </div>
  )
}
