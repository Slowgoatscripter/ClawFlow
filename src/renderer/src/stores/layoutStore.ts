import { create } from 'zustand'

type View = 'projects' | 'dashboard' | 'git' | 'settings'

interface LayoutState {
  view: View
  workshopPanelWidth: number
  workshopPanelCollapsed: boolean
  workshopPanelMaximized: boolean
  archiveDrawerOpen: boolean
  taskDetailOverlayId: number | null

  setView: (v: View) => void
  setWorkshopWidth: (width: number) => void
  toggleWorkshopPanel: () => void
  setWorkshopMaximized: (max: boolean) => void
  toggleArchiveDrawer: () => void
  openTaskDetail: (taskId: number) => void
  closeTaskDetail: () => void
}

export const useLayoutStore = create<LayoutState>((set) => ({
  view: 'projects',
  workshopPanelWidth: 350,
  workshopPanelCollapsed: false,
  workshopPanelMaximized: false,
  archiveDrawerOpen: false,
  taskDetailOverlayId: null,

  setView: (view) => set({ view }),
  setWorkshopWidth: (width) => set({ workshopPanelWidth: Math.max(300, Math.min(800, width)) }),
  toggleWorkshopPanel: () => set((s) => ({ workshopPanelCollapsed: !s.workshopPanelCollapsed })),
  setWorkshopMaximized: (max) => set({ workshopPanelMaximized: max }),
  toggleArchiveDrawer: () => set((s) => ({ archiveDrawerOpen: !s.archiveDrawerOpen })),
  openTaskDetail: (taskId) => set({ taskDetailOverlayId: taskId }),
  closeTaskDetail: () => set({ taskDetailOverlayId: null }),
}))
