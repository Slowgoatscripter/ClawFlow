import { create } from 'zustand'
import type { StreamEvent, ApprovalRequest } from '../../../shared/types'

interface PipelineState {
  activeTaskId: number | null
  streaming: boolean
  streamEvents: StreamEvent[]
  approvalRequest: ApprovalRequest | null
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
}

export const usePipelineStore = create<PipelineState>((set) => ({
  activeTaskId: null,
  streaming: false,
  streamEvents: [],
  approvalRequest: null,

  startPipeline: async (taskId) => {
    set({ activeTaskId: taskId, streaming: true, streamEvents: [] })
    await window.api.pipeline.start(taskId)
  },

  stepPipeline: async (taskId) => {
    set({ activeTaskId: taskId, streaming: true })
    await window.api.pipeline.step(taskId)
  },

  approveStage: async (taskId) => {
    await window.api.pipeline.approve(taskId)
  },

  rejectStage: async (taskId, feedback) => {
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

  clearStream: () => set({ streamEvents: [], streaming: false, activeTaskId: null }),

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
    })
    return () => {
      cleanupStream()
      cleanupApproval()
      cleanupStatus()
    }
  }
}))
