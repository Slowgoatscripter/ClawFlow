import { create } from 'zustand'
import type { Task, CreateTaskInput, TaskStatus } from '../../../shared/types'

interface TaskState {
  tasks: Task[]
  selectedTaskId: number | null
  filter: TaskStatus | 'all'
  loading: boolean
  loadTasks: (dbPath: string) => Promise<void>
  createTask: (dbPath: string, input: CreateTaskInput) => Promise<Task>
  updateTask: (dbPath: string, taskId: number, updates: Record<string, any>) => Promise<void>
  deleteTask: (dbPath: string, taskId: number) => Promise<void>
  archiveTask: (dbPath: string, taskId: number) => Promise<void>
  unarchiveTask: (dbPath: string, taskId: number) => Promise<void>
  archiveAllDone: (dbPath: string) => Promise<void>
  selectTask: (taskId: number | null) => void
  setFilter: (filter: TaskStatus | 'all') => void
  getTasksByStatus: (status: TaskStatus) => Task[]
}

export const useTaskStore = create<TaskState>((set, get) => ({
  tasks: [],
  selectedTaskId: null,
  filter: 'all',
  loading: false,

  loadTasks: async (dbPath) => {
    set({ loading: true })
    const tasks = await window.api.tasks.list(dbPath)
    set({ tasks, loading: false })
  },

  createTask: async (dbPath, input) => {
    const task = await window.api.tasks.create(dbPath, input)
    await get().loadTasks(dbPath)
    return task
  },

  updateTask: async (dbPath, taskId, updates) => {
    await window.api.tasks.update(dbPath, taskId, updates)
    await get().loadTasks(dbPath)
  },

  deleteTask: async (dbPath, taskId) => {
    await window.api.tasks.delete(dbPath, taskId)
    const { selectedTaskId } = get()
    if (selectedTaskId === taskId) set({ selectedTaskId: null })
    await get().loadTasks(dbPath)
  },

  archiveTask: async (dbPath, taskId) => {
    await window.api.tasks.archiveTask(dbPath, taskId)
    await get().loadTasks(dbPath)
  },

  unarchiveTask: async (dbPath, taskId) => {
    await window.api.tasks.unarchiveTask(dbPath, taskId)
    await get().loadTasks(dbPath)
  },

  archiveAllDone: async (dbPath) => {
    await window.api.tasks.archiveAllDone(dbPath)
    await get().loadTasks(dbPath)
  },

  selectTask: (taskId) => set({ selectedTaskId: taskId }),
  setFilter: (filter) => set({ filter }),
  getTasksByStatus: (status) => get().tasks.filter(t => t.status === status)
}))
