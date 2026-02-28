import { useCallback, useRef, useState } from 'react'
import { useCanvasStore } from '../../stores/canvasStore'
import { CanvasGroup } from './CanvasGroup'
import { CanvasTaskLane } from './CanvasTaskLane'
import { CanvasDependencyArrows } from './CanvasDependencyArrows'

export function Canvas() {
  const panX = useCanvasStore((s) => s.panX)
  const panY = useCanvasStore((s) => s.panY)
  const zoom = useCanvasStore((s) => s.zoom)
  const groups = useCanvasStore((s) => s.groups)
  const groupTasks = useCanvasStore((s) => s.groupTasks)
  const standaloneTasks = useCanvasStore((s) => s.standaloneTasks)
  const panTo = useCanvasStore((s) => s.panTo)
  const zoomTo = useCanvasStore((s) => s.zoomTo)

  const containerRef = useRef<HTMLDivElement>(null)
  const [isDragging, setIsDragging] = useState(false)
  const dragStart = useRef({ x: 0, y: 0, panX: 0, panY: 0 })

  const hasContent = groups.length > 0 || standaloneTasks.length > 0

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      // Only drag on empty space (not on child elements with their own click handlers)
      if (e.target !== e.currentTarget && (e.target as HTMLElement).closest('[data-canvas-content]')) {
        // Allow the event to pass through to content
      }
      // Always allow pan from the container background
      if (e.button === 0) {
        setIsDragging(true)
        dragStart.current = { x: e.clientX, y: e.clientY, panX, panY }
      }
    },
    [panX, panY]
  )

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (!isDragging) return
      const dx = e.clientX - dragStart.current.x
      const dy = e.clientY - dragStart.current.y
      panTo(dragStart.current.panX + dx, dragStart.current.panY + dy)
    },
    [isDragging, panTo]
  )

  const handleMouseUp = useCallback(() => {
    setIsDragging(false)
  }, [])

  const handleWheel = useCallback(
    (e: React.WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        // Zoom
        e.preventDefault()
        const delta = e.deltaY > 0 ? -0.1 : 0.1
        zoomTo(zoom + delta)
      } else {
        // Pan
        panTo(panX - e.deltaX, panY - e.deltaY)
      }
    },
    [zoom, panX, panY, zoomTo, panTo]
  )

  return (
    <div
      ref={containerRef}
      className="relative flex-1 overflow-hidden"
      style={{
        backgroundColor: 'var(--color-bg)',
        cursor: isDragging ? 'grabbing' : 'grab'
      }}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
      onWheel={handleWheel}
    >
      {/* Background orb swarm */}
      <div className="canvas-orb canvas-orb-1" />
      <div className="canvas-orb canvas-orb-2" />
      <div className="canvas-orb canvas-orb-3" />
      <div className="canvas-orb canvas-orb-4" />
      <div className="canvas-orb canvas-orb-5" />
      <div className="canvas-orb canvas-orb-6" />
      <div className="canvas-orb canvas-orb-7" />
      <div className="canvas-orb canvas-orb-8" />
      <div className="canvas-orb canvas-orb-9" />
      <div className="canvas-orb canvas-orb-10" />
      <div className="canvas-orb canvas-orb-11" />
      <div className="canvas-orb canvas-orb-12" />
      <div className="canvas-orb canvas-orb-13" />
      <div className="canvas-orb canvas-orb-14" />
      <div className="canvas-orb canvas-orb-15" />

      {/* Dot grid */}
      <div className="canvas-dot-grid" />

      {/* Vignette */}
      <div className="canvas-vignette" />

      {/* Transformed content layer */}
      <div
        data-canvas-content
        style={{
          transform: `translate(${panX}px, ${panY}px) scale(${zoom})`,
          transformOrigin: '0 0',
          willChange: 'transform'
        }}
      >
        <CanvasDependencyArrows />
        {hasContent ? (
          <div className="flex flex-col gap-4 p-6">
            {/* Groups */}
            {groups.map((group) => (
              <CanvasGroup
                key={group.id}
                group={group}
                tasks={groupTasks[group.id] ?? []}
              />
            ))}

            {/* Standalone tasks */}
            {standaloneTasks.length > 0 && (
              <div className="flex flex-wrap gap-3">
                {standaloneTasks.map((task) => (
                  <CanvasTaskLane key={task.id} task={task} standalone />
                ))}
              </div>
            )}
          </div>
        ) : (
          <div
            className="flex items-center justify-center"
            style={{ height: '100vh', width: '100vw' }}
          >
            <span
              className="text-sm"
              style={{ color: 'var(--color-text-muted)' }}
            >
              No tasks yet
            </span>
          </div>
        )}
      </div>

      {/* Zoom indicator */}
      <div
        className="absolute bottom-3 right-3 px-2 py-1 rounded text-xs"
        style={{
          backgroundColor: 'var(--color-elevated)',
          color: 'var(--color-text-secondary)',
          border: '1px solid var(--color-border)'
        }}
      >
        {Math.round(zoom * 100)}%
      </div>
    </div>
  )
}
