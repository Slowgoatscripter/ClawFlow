import { create } from 'zustand'
import type { Task, TaskGroup } from '../../../shared/types'

interface TimelineEvent {
  id: string
  taskId: number
  type: 'stage-complete' | 'file-change' | 'test-result' | 'agent-question' | 'error'
  summary: string
  timestamp: string
  agentId?: string
}

interface CanvasState {
  panX: number
  panY: number
  zoom: number

  groups: TaskGroup[]
  groupTasks: Record<number, Task[]>
  standaloneTasks: Task[]
  timelineEvents: Record<number, TimelineEvent[]>

  selectedGroupId: number | null
  selectedTaskId: number | null

  panTo: (x: number, y: number) => void
  zoomTo: (level: number) => void
  focusGroup: (groupId: number) => void
  focusTask: (taskId: number) => void
  clearSelection: () => void

  setGroups: (groups: TaskGroup[]) => void
  setGroupTasks: (groupId: number, tasks: Task[]) => void
  setStandaloneTasks: (tasks: Task[]) => void
  addTimelineEvent: (taskId: number, event: TimelineEvent) => void

  refreshAll: (dbPath: string) => Promise<void>
}

export const useCanvasStore = create<CanvasState>((set, get) => ({
  panX: 0,
  panY: 0,
  zoom: 1,

  groups: [],
  groupTasks: {},
  standaloneTasks: [],
  timelineEvents: {},

  selectedGroupId: null,
  selectedTaskId: null,

  panTo: (x, y) => set({ panX: x, panY: y }),
  zoomTo: (level) => set({ zoom: Math.max(0.3, Math.min(3, level)) }),
  focusGroup: (groupId) => set({ selectedGroupId: groupId, selectedTaskId: null }),
  focusTask: (taskId) => set({ selectedTaskId: taskId }),
  clearSelection: () => set({ selectedGroupId: null, selectedTaskId: null }),

  setGroups: (groups) => set({ groups }),
  setGroupTasks: (groupId, tasks) =>
    set((s) => ({ groupTasks: { ...s.groupTasks, [groupId]: tasks } })),
  setStandaloneTasks: (tasks) => set({ standaloneTasks: tasks }),
  addTimelineEvent: (taskId, event) =>
    set((s) => ({
      timelineEvents: {
        ...s.timelineEvents,
        [taskId]: [...(s.timelineEvents[taskId] || []), event],
      },
    })),

  refreshAll: async (dbPath: string) => {
    const allTasks = await window.api.tasks.list(dbPath)
    const tasks = allTasks.filter((t: Task) => !t.archivedAt)
    const standalone = tasks.filter((t: Task) => !t.groupId)
    const grouped = tasks.filter((t: Task) => t.groupId)

    const groupMap: Record<number, Task[]> = {}
    for (const t of grouped) {
      if (!groupMap[t.groupId!]) groupMap[t.groupId!] = []
      groupMap[t.groupId!].push(t)
    }

    set({ standaloneTasks: standalone, groupTasks: groupMap })
  },
}))
