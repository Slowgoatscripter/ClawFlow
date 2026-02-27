import { create } from 'zustand'
import type { StreamEvent, ApprovalRequest } from '../../../shared/types'

interface PipelineState {
  activeTaskId: number | null
  streaming: boolean
  streamEvents: StreamEvent[]
  approvalRequest: ApprovalRequest | null
  awaitingReview: Record<number, boolean>
  todosByTaskId: Record<number, Record<string, any[]>>
  contextByTaskId: Record<number, { tokens: number; max: number }>
  contextHandoff: { taskId: number; currentStage: string; nextStage: string; usagePercent: number; remainingTokens: number; estimatedNeed: number } | null
  usageSnapshot: { connected: boolean; error: string | null; fiveHour: { utilization: number; countdown: string } | null; sevenDay: { utilization: number; countdown: string } | null; sevenDayOpus: { utilization: number; countdown: string } | null; sevenDaySonnet: { utilization: number; countdown: string } | null } | null
  usagePausedToast: { pausedCount: number; utilization: number; countdown: string } | null
  startPipeline: (taskId: number) => Promise<void>
  stepPipeline: (taskId: number) => Promise<void>
  approveStage: (taskId: number) => Promise<void>
  rejectStage: (taskId: number, feedback: string) => Promise<void>
  respondToQuestions: (taskId: number, response: string) => Promise<void>
  resolveApproval: (requestId: string, approved: boolean, message?: string) => Promise<void>
  addStreamEvent: (event: StreamEvent) => void
  setApprovalRequest: (request: ApprovalRequest | null) => void
  clearStream: () => void
  setupListeners: () => () => void
  pauseTask: (taskId: number) => Promise<void>
  resumeTask: (taskId: number) => Promise<void>
  pauseAll: () => Promise<void>
  approveContextHandoff: (taskId: number) => Promise<void>
  dismissContextHandoff: () => void
  dismissUsagePausedToast: () => void
}

export const usePipelineStore = create<PipelineState>((set) => ({
  activeTaskId: null,
  streaming: false,
  streamEvents: [],
  approvalRequest: null,
  awaitingReview: {},
  todosByTaskId: {},
  contextByTaskId: {},
  contextHandoff: null,
  usageSnapshot: null,
  usagePausedToast: null,

  startPipeline: async (taskId) => {
    set(state => ({
      activeTaskId: taskId,
      streaming: true,
      streamEvents: [],
      awaitingReview: { ...state.awaitingReview, [taskId]: false }
    }))
    await window.api.pipeline.start(taskId)
  },

  stepPipeline: async (taskId) => {
    set(state => ({
      activeTaskId: taskId,
      streaming: true,
      awaitingReview: { ...state.awaitingReview, [taskId]: false }
    }))
    await window.api.pipeline.step(taskId)
  },

  approveStage: async (taskId) => {
    set(state => ({
      awaitingReview: { ...state.awaitingReview, [taskId]: false }
    }))
    await window.api.pipeline.approve(taskId)
  },

  rejectStage: async (taskId, feedback) => {
    set(state => ({
      awaitingReview: { ...state.awaitingReview, [taskId]: false }
    }))
    await window.api.pipeline.reject(taskId, feedback)
  },

  respondToQuestions: async (taskId, response) => {
    set({ activeTaskId: taskId, streaming: true })
    await window.api.pipeline.respond(taskId, response)
  },

  addStreamEvent: (event) => set(state => ({
    streamEvents: [...state.streamEvents, event]
  })),

  resolveApproval: async (requestId, approved, message?) => {
    await window.api.pipeline.resolveApproval(requestId, approved, message)
    set({ approvalRequest: null })
  },

  setApprovalRequest: (request) => set({ approvalRequest: request }),

  clearStream: () => set({ streamEvents: [], streaming: false, activeTaskId: null, awaitingReview: {} }),

  pauseTask: async (taskId) => {
    await window.api.pipeline.pause(taskId)
  },
  resumeTask: async (taskId) => {
    set({ streaming: true, activeTaskId: taskId })
    await window.api.pipeline.resume(taskId)
  },
  pauseAll: async () => {
    await window.api.pipeline.pauseAll()
  },
  approveContextHandoff: async (taskId) => {
    set({ contextHandoff: null, streaming: true })
    await window.api.pipeline.approveContextHandoff(taskId)
  },
  dismissContextHandoff: () => set({ contextHandoff: null }),
  dismissUsagePausedToast: () => set({ usagePausedToast: null }),

  setupListeners: () => {
    const cleanupStream = window.api.pipeline.onStream((event) => {
      set(state => ({
        streamEvents: [...state.streamEvents, event]
      }))
    })
    const cleanupApproval = window.api.pipeline.onApprovalRequest((request) => {
      set({ approvalRequest: request })
    })
    const cleanupStatus = window.api.pipeline.onStatusChange((event) => {
      if (event.type === 'complete' || event.type === 'error' || event.type === 'pause' || event.type === 'circuit-breaker') {
        set({ streaming: false })
      }
      if (event.type === 'awaiting-review' && event.taskId) {
        set(state => ({
          awaitingReview: { ...state.awaitingReview, [event.taskId]: true }
        }))
      }
      if (event.type === 'paused') {
        set({ streaming: false })
      }
      if (event.type === 'usage-paused') {
        set({
          streaming: false,
          usagePausedToast: {
            pausedCount: (event as any).pausedCount,
            utilization: (event as any).utilization,
            countdown: (event as any).countdown
          }
        })
      }
    })
    const cleanupTodos = window.api.pipeline.onTodosUpdated((event: any) => {
      set(state => ({
        todosByTaskId: {
          ...state.todosByTaskId,
          [event.taskId]: {
            ...(state.todosByTaskId[event.taskId] || {}),
            [event.stage]: event.todos
          }
        }
      }))
    })
    const cleanupContext = window.api.pipeline.onContextUpdate((data) => {
      set((state) => ({
        contextByTaskId: {
          ...state.contextByTaskId,
          [data.taskId]: { tokens: data.contextTokens, max: data.contextMax }
        }
      }))
    })
    const cleanupContextHandoff = window.api.pipeline.onContextHandoff((data) => {
      set({ contextHandoff: data, streaming: false })
    })
    const cleanupUsage = window.api.usage.onSnapshot((snapshot) => {
      set({ usageSnapshot: snapshot })
    })
    window.api.usage.getSnapshot().then((snapshot) => {
      if (snapshot) set({ usageSnapshot: snapshot })
    })
    return () => {
      cleanupStream()
      cleanupApproval()
      cleanupStatus()
      cleanupTodos()
      cleanupContext()
      cleanupContextHandoff()
      cleanupUsage()
    }
  }
}))
