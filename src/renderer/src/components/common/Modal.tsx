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
      className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50"
      onClick={handleOverlay}
    >
      <div className="bg-overlay/80 backdrop-blur-xl rounded-lg p-6 max-w-lg w-full mx-4 border border-border-bright animate-[fade-scale-in_0.25s_ease-out]">
        {children}
      </div>
    </div>
  )
}
