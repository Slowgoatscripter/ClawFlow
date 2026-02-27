import { useLayoutStore } from '../stores/layoutStore'
import { NavRail } from './NavRail'

interface AppShellProps {
  children: React.ReactNode
  workshopPanel?: React.ReactNode
}

export function AppShell({ children, workshopPanel }: AppShellProps) {
  const collapsed = useLayoutStore((s) => s.workshopPanelCollapsed)
  const maximized = useLayoutStore((s) => s.workshopPanelMaximized)
  const width = useLayoutStore((s) => s.workshopPanelWidth)
  const setWidth = useLayoutStore((s) => s.setWorkshopWidth)

  const panelWidth = collapsed ? 0 : maximized ? '80%' : `${width}px`

  const handleDragStart = (e: React.MouseEvent) => {
    e.preventDefault()
    const startX = e.clientX
    const startWidth = width

    const onMove = (ev: MouseEvent) => {
      const delta = startX - ev.clientX
      setWidth(startWidth + delta)
    }

    const onUp = () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }

    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }

  return (
    <div className="flex h-full w-full overflow-hidden">
      <NavRail />

      <div className="flex-1 min-w-0 overflow-hidden">
        {children}
      </div>

      {workshopPanel && !collapsed && (
        <>
          <div
            onMouseDown={handleDragStart}
            className="w-1 cursor-col-resize bg-[var(--color-border)] hover:bg-[var(--color-accent-cyan)] transition-colors flex-shrink-0"
          />
          <div
            className="flex-shrink-0 overflow-hidden bg-[var(--color-surface)] border-l border-[var(--color-border)]"
            style={{ width: panelWidth }}
          >
            {workshopPanel}
          </div>
        </>
      )}
    </div>
  )
}
