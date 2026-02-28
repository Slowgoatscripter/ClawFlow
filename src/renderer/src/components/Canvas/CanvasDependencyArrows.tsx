import { useEffect, useRef, useState } from 'react'
import { useCanvasStore } from '../../stores/canvasStore'

interface Arrow {
  fromId: number
  toId: number
  satisfied: boolean
}

interface Point {
  x: number
  y: number
}

interface ComputedArrow extends Arrow {
  from: Point
  to: Point
}

export function CanvasDependencyArrows() {
  const groups = useCanvasStore((s) => s.groups)
  const groupTasks = useCanvasStore((s) => s.groupTasks)
  const standaloneTasks = useCanvasStore((s) => s.standaloneTasks)
  const [arrows, setArrows] = useState<ComputedArrow[]>([])
  const containerRef = useRef<HTMLDivElement>(null)

  // Collect all tasks
  const allTasks = [...standaloneTasks, ...groups.flatMap((g) => groupTasks[g.id] ?? [])]

  // Build a stable key for the dependency on task statuses
  const taskKey = allTasks.map((t) => `${t.id}-${t.status}`).join(',')

  useEffect(() => {
    const taskMap = new Map(allTasks.map((t) => [t.id, t]))

    // Build arrow definitions from dependency relationships
    const arrowDefs: Arrow[] = []
    for (const task of allTasks) {
      for (const depId of task.dependencyIds ?? []) {
        if (taskMap.has(depId)) {
          arrowDefs.push({
            fromId: depId,
            toId: task.id,
            satisfied: taskMap.get(depId)!.status === 'done'
          })
        }
      }
    }

    if (arrowDefs.length === 0) {
      setArrows([])
      return
    }

    // Compute positions from DOM using data-task-id attributes
    const parent = containerRef.current?.closest('[data-canvas-content]')
    if (!parent) return

    const parentRect = parent.getBoundingClientRect()

    const computed = arrowDefs
      .map((arrow) => {
        const fromEl = parent.querySelector(`[data-task-id="${arrow.fromId}"]`)
        const toEl = parent.querySelector(`[data-task-id="${arrow.toId}"]`)
        if (!fromEl || !toEl) return null

        const fromRect = fromEl.getBoundingClientRect()
        const toRect = toEl.getBoundingClientRect()

        return {
          ...arrow,
          from: {
            x: fromRect.right - parentRect.left,
            y: fromRect.top + fromRect.height / 2 - parentRect.top
          },
          to: {
            x: toRect.left - parentRect.left,
            y: toRect.top + toRect.height / 2 - parentRect.top
          }
        }
      })
      .filter((a): a is ComputedArrow => a !== null)

    setArrows(computed)
  }, [taskKey])

  if (arrows.length === 0) return null

  return (
    <div
      ref={containerRef}
      className="absolute inset-0 pointer-events-none"
      style={{ zIndex: 0 }}
    >
      <svg className="absolute inset-0 w-full h-full overflow-visible">
        <defs>
          <marker
            id="arrow-green"
            markerWidth="6"
            markerHeight="4"
            refX="5"
            refY="2"
            orient="auto"
          >
            <polygon points="0 0, 6 2, 0 4" fill="var(--color-accent-green)" opacity="0.6" />
          </marker>
          <marker
            id="arrow-amber"
            markerWidth="6"
            markerHeight="4"
            refX="5"
            refY="2"
            orient="auto"
          >
            <polygon points="0 0, 6 2, 0 4" fill="var(--color-accent-amber)" opacity="0.6" />
          </marker>
        </defs>
        {arrows.map((arrow) => {
          const midX = (arrow.from.x + arrow.to.x) / 2
          const color = arrow.satisfied ? 'var(--color-accent-green)' : 'var(--color-accent-amber)'
          const markerId = arrow.satisfied ? 'arrow-green' : 'arrow-amber'

          return (
            <path
              key={`${arrow.fromId}-${arrow.toId}`}
              d={`M ${arrow.from.x} ${arrow.from.y} C ${midX} ${arrow.from.y}, ${midX} ${arrow.to.y}, ${arrow.to.x} ${arrow.to.y}`}
              fill="none"
              stroke={color}
              strokeWidth="1.5"
              strokeOpacity="0.5"
              markerEnd={`url(#${markerId})`}
            />
          )
        })}
      </svg>
    </div>
  )
}
