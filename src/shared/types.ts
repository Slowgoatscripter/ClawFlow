// src/shared/types.ts

// --- Pipeline ---

export type Tier = 'L1' | 'L2' | 'L3'

export type Priority = 'low' | 'medium' | 'high' | 'critical'

export type TaskStatus =
  | 'backlog'
  | 'brainstorming'
  | 'design_review'
  | 'planning'
  | 'implementing'
  | 'code_review'
  | 'verifying'
  | 'done'
  | 'blocked'

export type PipelineStage =
  | 'brainstorm'
  | 'design_review'
  | 'plan'
  | 'implement'
  | 'code_review'
  | 'verify'
  | 'done'

export type HandoffStatus = 'completed' | 'blocked' | 'needs_intervention'

export interface Handoff {
  stage: PipelineStage
  agent: string
  model: string
  timestamp: string
  status: HandoffStatus
  summary: string
  keyDecisions: string
  openQuestions: string
  filesModified: string
  nextStageNeeds: string
  warnings: string
}

export interface ReviewScore {
  quality: number
  errorHandling: number
  types: number
  security: number
  performance: number
  coverage: number
  average: number
}

export interface TestResults {
  passed: boolean
  lintErrors: number
  buildErrors: number
  testsPassed: number
  testsFailed: number
  details: string
}

export interface AgentLogEntry {
  timestamp: string
  agent: string
  model: string
  action: string
  details: string
}

// --- Task ---

export interface Task {
  id: number
  title: string
  description: string
  tier: Tier
  status: TaskStatus
  priority: Priority
  autoMode: boolean
  createdAt: string
  startedAt: string | null
  completedAt: string | null
  currentAgent: string | null
  brainstormOutput: string | null
  designReview: object | null
  plan: object | null
  planReviewCount: number
  implementationNotes: object | null
  reviewComments: object | null
  reviewScore: number | null
  implReviewCount: number
  testResults: TestResults | null
  verifyResult: string | null
  commitHash: string | null
  handoffs: Handoff[]
  agentLog: AgentLogEntry[]
}

export interface CreateTaskInput {
  title: string
  description: string
  tier: Tier
  priority: Priority
  autoMode?: boolean
}

// --- Project ---

export interface Project {
  name: string
  path: string
  dbPath: string
  createdAt: string
  lastOpened: string
}

export interface ProjectStats {
  backlog: number
  inProgress: number
  done: number
  blocked: number
  completionRate: number
  avgReviewScore: number | null
  circuitBreakerTrips: number
}

// --- Pipeline Config ---

export interface StageConfig {
  stage: PipelineStage
  skill: string
  model: 'claude-opus-4-6' | 'claude-sonnet-4-6'
  maxTurns: number
  pauses: boolean
  autoApproveThreshold: number | null
  template: string
}

// --- IPC ---

export type IpcChannel =
  | 'projects:list'
  | 'projects:register'
  | 'projects:open'
  | 'projects:delete'
  | 'tasks:list'
  | 'tasks:create'
  | 'tasks:get'
  | 'tasks:update'
  | 'tasks:delete'
  | 'pipeline:start'
  | 'pipeline:step'
  | 'pipeline:approve'
  | 'pipeline:reject'
  | 'pipeline:intervene'
  | 'pipeline:stream'
  | 'pipeline:status'
  | 'pipeline:approval-request'

// --- SDK Streaming ---

export interface StreamEvent {
  taskId: number
  agent: string
  type: 'text' | 'tool_use' | 'tool_result' | 'status' | 'error' | 'complete'
  content: string
  timestamp: string
}

export interface ApprovalRequest {
  requestId: string
  taskId: number
  toolUseId: string
  toolName: string
  toolInput: Record<string, unknown>
}
