import { useState } from 'react'
import { Maximize2, Minimize2, PanelRightClose, MessageSquare, Layers, Users } from 'lucide-react'
import { useLayoutStore } from '../../stores/layoutStore'
import { useWorkshopStore } from '../../stores/workshopStore'
import { ChatTab } from './ChatTab'
import { ArtifactsTab } from './ArtifactsTab'
import { GroupTab } from './GroupTab'

type TabId = 'chat' | 'artifacts' | 'group'

const TABS: { id: TabId; label: string; icon: React.ElementType }[] = [
  { id: 'chat', label: 'Chat', icon: MessageSquare },
  { id: 'artifacts', label: 'Artifacts', icon: Layers },
  { id: 'group', label: 'Group', icon: Users },
]

export function WorkshopPanel() {
  const [activeTab, setActiveTab] = useState<TabId>('chat')

  // Layout state
  const maximized = useLayoutStore((s) => s.workshopPanelMaximized)
  const setMaximized = useLayoutStore((s) => s.setWorkshopMaximized)
  const toggleCollapse = useLayoutStore((s) => s.toggleWorkshopPanel)

  // Workshop state
  const sessions = useWorkshopStore((s) => s.sessions)
  const currentSessionId = useWorkshopStore((s) => s.currentSessionId)
  const selectSession = useWorkshopStore((s) => s.selectSession)

  const handleSessionChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const sessionId = e.target.value
    if (sessionId && sessionId !== currentSessionId) {
      // selectSession needs dbPath — use empty string as fallback for now
      // (full wiring will happen when ChatTab is connected)
      selectSession('', sessionId)
    }
  }

  return (
    <div className="flex flex-col h-full bg-[var(--color-surface)] overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-[var(--color-border)] flex-shrink-0">
        {/* Workshop label */}
        <span
          className="text-[10px] font-semibold tracking-[0.15em] uppercase"
          style={{ color: 'var(--color-accent-cyan)' }}
        >
          Workshop
        </span>

        {/* Session dropdown */}
        <div className="flex-1 min-w-0">
          <select
            value={currentSessionId ?? ''}
            onChange={handleSessionChange}
            className="w-full text-xs bg-[var(--color-elevated)] border border-[var(--color-border)] rounded px-2 py-1 text-[var(--color-text-secondary)] focus:outline-none focus:border-[var(--color-accent-cyan)] transition-colors cursor-pointer truncate"
            style={{ maxWidth: '100%' }}
          >
            {sessions.length === 0 ? (
              <option value="">No sessions</option>
            ) : (
              <>
                {!currentSessionId && <option value="">Select session...</option>}
                {sessions.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.title || `Session ${s.id.slice(0, 8)}`}
                  </option>
                ))}
              </>
            )}
          </select>
        </div>

        {/* Control buttons */}
        <div className="flex items-center gap-0.5 flex-shrink-0">
          {maximized ? (
            <button
              onClick={() => setMaximized(false)}
              title="Restore panel"
              className="w-6 h-6 flex items-center justify-center rounded text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] hover:bg-[var(--color-elevated)] transition-all"
            >
              <Minimize2 size={13} />
            </button>
          ) : (
            <button
              onClick={() => setMaximized(true)}
              title="Maximize panel"
              className="w-6 h-6 flex items-center justify-center rounded text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] hover:bg-[var(--color-elevated)] transition-all"
            >
              <Maximize2 size={13} />
            </button>
          )}
          <button
            onClick={toggleCollapse}
            title="Collapse panel"
            className="w-6 h-6 flex items-center justify-center rounded text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] hover:bg-[var(--color-elevated)] transition-all"
          >
            <PanelRightClose size={13} />
          </button>
        </div>
      </div>

      {/* Tab bar */}
      <div className="flex items-center border-b border-[var(--color-border)] flex-shrink-0 px-1">
        {TABS.map(({ id, label, icon: Icon }) => {
          const isActive = activeTab === id
          return (
            <button
              key={id}
              onClick={() => setActiveTab(id)}
              className={`
                flex items-center gap-1.5 px-3 py-2 text-xs font-medium transition-all relative
                ${
                  isActive
                    ? 'text-[var(--color-accent-cyan)]'
                    : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]'
                }
              `}
            >
              <Icon size={13} />
              <span>{label}</span>
              {/* Active indicator bar */}
              {isActive && (
                <span
                  className="absolute bottom-0 left-0 right-0 h-[2px] rounded-t-full"
                  style={{ background: 'var(--color-accent-cyan)' }}
                />
              )}
            </button>
          )
        })}
      </div>

      {/* Tab content */}
      <div className="flex-1 min-h-0 overflow-hidden">
        {activeTab === 'chat' && <ChatTab />}
        {activeTab === 'artifacts' && <ArtifactsTab />}
        {activeTab === 'group' && <GroupTab />}
      </div>
    </div>
  )
}
