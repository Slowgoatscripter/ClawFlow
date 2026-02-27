import { useEffect } from 'react'
import { create } from 'zustand'

// --- Types ---

type ToastType = 'success' | 'error' | 'warning' | 'info'

interface ToastItem {
  id: string
  type: ToastType
  message: string
  createdAt: number
}

interface ToastStore {
  toasts: ToastItem[]
  addToast: (type: ToastType, message: string) => void
  removeToast: (id: string) => void
}

// --- Constants ---

const MAX_TOASTS = 5
const AUTO_DISMISS_MS = 5000

const TYPE_STYLES: Record<ToastType, { border: string; icon: string }> = {
  success: { border: 'border-l-accent-green', icon: '\u2713' },
  error: { border: 'border-l-accent-magenta', icon: '\u2717' },
  warning: { border: 'border-l-accent-amber', icon: '\u26A0' },
  info: { border: 'border-l-accent-cyan', icon: '\u2139' }
}

const TYPE_TEXT_COLOR: Record<ToastType, string> = {
  success: 'text-accent-green',
  error: 'text-accent-magenta',
  warning: 'text-accent-amber',
  info: 'text-accent-cyan'
}

// --- Store ---

let counter = 0

const useToastStore = create<ToastStore>((set) => ({
  toasts: [],
  addToast: (type, message) => {
    const id = `toast-${++counter}-${Date.now()}`
    set((state) => {
      const newToasts = [...state.toasts, { id, type, message, createdAt: Date.now() }]
      // Enforce max visible toasts — remove oldest when exceeded
      if (newToasts.length > MAX_TOASTS) {
        return { toasts: newToasts.slice(newToasts.length - MAX_TOASTS) }
      }
      return { toasts: newToasts }
    })
  },
  removeToast: (id) => {
    set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) }))
  }
}))

// --- Public toast API ---

export const toast = {
  success: (message: string) => useToastStore.getState().addToast('success', message),
  error: (message: string) => useToastStore.getState().addToast('error', message),
  warning: (message: string) => useToastStore.getState().addToast('warning', message),
  info: (message: string) => useToastStore.getState().addToast('info', message)
}

// --- Auto-dismiss hook ---

function ToastItem({ item, onDismiss }: { item: ToastItem; onDismiss: () => void }) {
  useEffect(() => {
    const timer = setTimeout(onDismiss, AUTO_DISMISS_MS)
    return () => clearTimeout(timer)
  }, [onDismiss])

  const styles = TYPE_STYLES[item.type]
  const textColor = TYPE_TEXT_COLOR[item.type]

  return (
    <div
      className={`flex items-start gap-3 bg-surface border border-border border-l-4 ${styles.border} rounded-md px-4 py-3 shadow-lg min-w-72 max-w-96 animate-in slide-in-from-right`}
    >
      <span className={`${textColor} text-sm font-bold mt-0.5 shrink-0`}>{styles.icon}</span>
      <p className="text-text-primary text-sm flex-1 break-words">{item.message}</p>
      <button
        onClick={onDismiss}
        className="text-text-muted hover:text-text-secondary text-sm shrink-0 cursor-pointer leading-none mt-0.5"
        aria-label="Dismiss"
      >
        &times;
      </button>
    </div>
  )
}

// --- Toast Container ---

export function ToastContainer() {
  const toasts = useToastStore((s) => s.toasts)
  const removeToast = useToastStore((s) => s.removeToast)

  if (toasts.length === 0) return null

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2">
      {toasts.map((item) => (
        <ToastItem key={item.id} item={item} onDismiss={() => removeToast(item.id)} />
      ))}
    </div>
  )
}
