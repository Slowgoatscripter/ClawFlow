import { create } from 'zustand'
import type { GitBranch } from '../../../shared/types'
import { useProjectStore } from './projectStore'

interface GitState {
  branches: GitBranch[]
  selectedTaskId: number | null
  loading: boolean
  error: string | null

  loadBranches: () => Promise<void>
  selectBranch: (taskId: number | null) => void
  push: (taskId: number) => Promise<void>
  merge: (taskId: number) => Promise<void>
  deleteBranch: (taskId: number) => Promise<void>
  commit: (taskId: number, message: string) => Promise<void>
  setupListeners: () => () => void
}

export const useGitStore = create<GitState>((set, get) => ({
  branches: [],
  selectedTaskId: null,
  loading: false,
  error: null,

  loadBranches: async () => {
    const project = useProjectStore.getState().currentProject
    if (!project) return
    set({ loading: true, error: null })
    try {
      const branches = await window.api.git.getBranches(project.dbPath, project.path)
      set({ branches, loading: false })
    } catch (err: any) {
      set({ error: err.message, loading: false })
    }
  },

  selectBranch: (taskId) => set({ selectedTaskId: taskId }),

  push: async (taskId) => {
    const project = useProjectStore.getState().currentProject
    if (!project) return
    try {
      await window.api.git.push(project.dbPath, project.path, taskId)
      await get().loadBranches()
    } catch (err: any) {
      set({ error: err.message })
    }
  },

  merge: async (taskId) => {
    const project = useProjectStore.getState().currentProject
    if (!project) return
    try {
      const result = await window.api.git.merge(project.dbPath, project.path, taskId)
      if (result.conflicts) {
        set({ error: result.message })
      }
      await get().loadBranches()
    } catch (err: any) {
      set({ error: err.message })
    }
  },

  deleteBranch: async (taskId) => {
    const project = useProjectStore.getState().currentProject
    if (!project) return
    try {
      await window.api.git.deleteBranch(project.dbPath, project.path, taskId)
      set((s) => ({
        branches: s.branches.filter((b) => b.taskId !== taskId),
        selectedTaskId: s.selectedTaskId === taskId ? null : s.selectedTaskId
      }))
    } catch (err: any) {
      set({ error: err.message })
    }
  },

  commit: async (taskId, message) => {
    const project = useProjectStore.getState().currentProject
    if (!project) return
    try {
      await window.api.git.commit(project.dbPath, project.path, taskId, message)
      await get().loadBranches()
    } catch (err: any) {
      set({ error: err.message })
    }
  },

  setupListeners: () => {
    const cleanupBranch = window.api.git.onBranchCreated(() => {
      get().loadBranches()
    })
    const cleanupCommit = window.api.git.onCommitComplete(() => {
      get().loadBranches()
    })
    const cleanupPush = window.api.git.onPushComplete(() => {
      get().loadBranches()
    })
    const cleanupMerge = window.api.git.onMergeComplete(() => {
      get().loadBranches()
    })
    const cleanupError = window.api.git.onError((data: any) => {
      set({ error: data.message })
    })

    return () => {
      cleanupBranch()
      cleanupCommit()
      cleanupPush()
      cleanupMerge()
      cleanupError()
    }
  }
}))
