import type { ReactNode, MouseEvent } from 'react'

interface ModalProps {
  onClose: () => void
  children: ReactNode
}

export function Modal({ onClose, children }: ModalProps) {
  const handleOverlay = (e: MouseEvent) => {
    if (e.target === e.currentTarget) onClose()
  }

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
      onClick={handleOverlay}
    >
      <div className="bg-surface rounded-lg p-6 max-w-lg w-full mx-4">
        {children}
      </div>
    </div>
  )
}
