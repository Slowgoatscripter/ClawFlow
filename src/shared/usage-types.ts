export interface UsageBucket {
  utilization: number
  resetsAt: string
}

export interface UsageSnapshot {
  connected: boolean
  error: string | null
  fiveHour: { utilization: number; countdown: string } | null
  sevenDay: { utilization: number; countdown: string } | null
  sevenDayOpus: { utilization: number; countdown: string } | null
  sevenDaySonnet: { utilization: number; countdown: string } | null
}

export interface ContextUpdate {
  taskId: number
  stage: string
  contextTokens: number
  contextMax: number
}
