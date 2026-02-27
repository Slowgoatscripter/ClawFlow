import { LayoutDashboard, GitBranch, Settings, FolderOpen } from 'lucide-react'
import { useLayoutStore } from '../stores/layoutStore'

const NAV_ITEMS = [
  { id: 'projects' as const, icon: FolderOpen, label: 'Projects' },
  { id: 'dashboard' as const, icon: LayoutDashboard, label: 'Dashboard' },
  { id: 'git' as const, icon: GitBranch, label: 'Git' },
  { id: 'settings' as const, icon: Settings, label: 'Settings' },
]

export function NavRail() {
  const view = useLayoutStore((s) => s.view)
  const setView = useLayoutStore((s) => s.setView)

  return (
    <nav className="flex flex-col items-center w-12 bg-[var(--color-surface)] border-r border-[var(--color-border)] py-3 gap-2">
      {NAV_ITEMS.map((item) => {
        const Icon = item.icon
        const active = view === item.id
        return (
          <button
            key={item.id}
            onClick={() => setView(item.id)}
            title={item.label}
            className={`
              w-9 h-9 flex items-center justify-center rounded-lg transition-all
              ${active
                ? 'bg-[var(--color-elevated)] text-[var(--color-accent-cyan)] shadow-[0_0_8px_var(--color-accent-cyan)/30]'
                : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] hover:bg-[var(--color-elevated)]'
              }
            `}
          >
            <Icon size={18} />
          </button>
        )
      })}
    </nav>
  )
}
