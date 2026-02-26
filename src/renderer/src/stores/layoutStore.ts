import { create } from 'zustand'

type View = 'projects' | 'dashboard' | 'task-detail' | 'workshop' | 'git'

interface LayoutState {
  view: View
  activityFeedOpen: boolean
  archiveDrawerOpen: boolean
  setView: (view: View) => void
  toggleActivityFeed: () => void
  toggleArchiveDrawer: () => void
}

export const useLayoutStore = create<LayoutState>((set) => ({
  view: 'projects',
  activityFeedOpen: true,
  archiveDrawerOpen: false,
  setView: (view) => set({ view }),
  toggleActivityFeed: () => set(s => ({ activityFeedOpen: !s.activityFeedOpen })),
  toggleArchiveDrawer: () => set(s => ({ archiveDrawerOpen: !s.archiveDrawerOpen }))
}))
