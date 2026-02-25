import { create } from 'zustand'

type View = 'projects' | 'dashboard' | 'task-detail' | 'workshop' | 'git'

interface LayoutState {
  view: View
  activityFeedOpen: boolean
  setView: (view: View) => void
  toggleActivityFeed: () => void
}

export const useLayoutStore = create<LayoutState>((set) => ({
  view: 'projects',
  activityFeedOpen: true,
  setView: (view) => set({ view }),
  toggleActivityFeed: () => set(s => ({ activityFeedOpen: !s.activityFeedOpen }))
}))
