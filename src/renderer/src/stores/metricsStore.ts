import { create } from 'zustand'

interface MetricsState {
  activeAgents: number
  tasksDone: number
  tasksDoneHistory: number[]
  completionRate: number
  completionRateHistory: number[]
  avgStageTime: number
  avgStageTimeHistory: number[]
  tokenUsage: number
  tokenUsageHistory: number[]

  refresh: (dbPath: string) => Promise<void>
  recordTokenUsage: (tokens: number) => void
}

export const useMetricsStore = create<MetricsState>((set, get) => ({
  activeAgents: 0,
  tasksDone: 0,
  tasksDoneHistory: [],
  completionRate: 0,
  completionRateHistory: [],
  avgStageTime: 0,
  avgStageTimeHistory: [],
  tokenUsage: 0,
  tokenUsageHistory: [],

  refresh: async (dbPath: string) => {
    const stats = await window.api.tasks.stats(dbPath)
    const prev = get()
    set({
      activeAgents: stats.inProgress,
      tasksDone: stats.done,
      tasksDoneHistory: [...prev.tasksDoneHistory.slice(-6), stats.done],
      completionRate: Math.round(stats.completionRate * 100),
      completionRateHistory: [
        ...prev.completionRateHistory.slice(-6),
        Math.round(stats.completionRate * 100),
      ],
    })
  },

  recordTokenUsage: (tokens: number) => {
    const prev = get()
    const total = prev.tokenUsage + tokens
    set({
      tokenUsage: total,
      tokenUsageHistory: [...prev.tokenUsageHistory.slice(-19), total],
    })
  },
}))
