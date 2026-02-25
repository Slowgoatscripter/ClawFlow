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
  addStreamEvent: (event: StreamEvent) => void
  setApprovalRequest: (request: ApprovalRequest | null) => void
  clearStream: () => void
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

  addStreamEvent: (event) => set(state => ({
    streamEvents: [...state.streamEvents, event]
  })),

  setApprovalRequest: (request) => set({ approvalRequest: request }),

  clearStream: () => set({ streamEvents: [], streaming: false, activeTaskId: null })
}))
