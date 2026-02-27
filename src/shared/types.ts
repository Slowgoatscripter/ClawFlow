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
  | 'paused'

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

export interface TodoItem {
  id: string
  subject: string
  status: 'pending' | 'in_progress' | 'completed'
  createdAt: string
  updatedAt: string
}

// --- Task ---

export interface TaskArtifacts {
  filesCreated: string[]
  filesModified: string[]
  exportsAdded: string[]
  typesAdded: string[]
  summary: string
}

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
  branchName: string | null
  worktreePath: string | null
  prUrl: string | null
  handoffs: Handoff[]
  agentLog: AgentLogEntry[]
  todos: Record<string, TodoItem[]> | null
  archivedAt: string | null
  pausedFromStatus: TaskStatus | null
  pauseReason: 'manual' | 'usage_limit' | null
  activeSessionId: string | null
  richHandoff: string | null
  dependencyIds: number[]
  artifacts: TaskArtifacts | null
}

export interface CreateTaskInput {
  title: string
  description: string
  tier: Tier
  priority: Priority
  autoMode?: boolean
  dependencyIds?: number[]
}

// --- Project ---

export interface Project {
  name: string
  path: string
  dbPath: string
  createdAt: string
  lastOpened: string
  defaultBaseBranch: string
  gitEnabled: boolean
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
  timeoutMs: number
  pauses: boolean
  autoApproveThreshold: number | null
  template: string
}

// --- Workshop ---

export type WorkshopSessionStatus = 'active' | 'ended'

export type WorkshopSessionType = 'solo' | 'panel'

export interface PanelPersona {
  id: string
  name: string
  color: string
  systemPrompt: string
  isBuiltIn: boolean
}

export type WorkshopMessageType =
  | 'text'
  | 'choice'
  | 'confirmation'
  | 'artifact_preview'
  | 'system_event'

export type WorkshopMessageRole = 'user' | 'assistant' | 'system'

export type WorkshopArtifactType =
  | 'design_doc'
  | 'diagram'
  | 'task_breakdown'
  | 'spec'
  | 'architecture'

export interface WorkshopSession {
  id: string
  projectId: string
  title: string
  summary: string | null
  pendingContent: string | null
  status: WorkshopSessionStatus
  createdAt: string
  updatedAt: string
  sessionType: WorkshopSessionType
  panelPersonas: PanelPersona[] | null
}

export interface WorkshopMessage {
  id: string
  sessionId: string
  role: WorkshopMessageRole
  content: string
  messageType: WorkshopMessageType
  metadata: Record<string, unknown> | null
  createdAt: string
  personaId: string | null
  personaName: string | null
  roundNumber: number | null
}

export interface WorkshopArtifact {
  id: string
  projectId: string
  name: string
  type: WorkshopArtifactType
  filePath: string
  currentVersion: number
  createdAt: string
  updatedAt: string
}

// Git types
export interface FileStatus {
  path: string
  status: 'modified' | 'added' | 'deleted' | 'untracked' | 'renamed'
  staged: boolean
}

export interface GitBranch {
  taskId: number
  taskTitle: string
  branchName: string
  status: 'active' | 'completed' | 'stale' | 'merged'
  commitCount: number
  lastCommitMessage: string
  lastCommitDate: string
  aheadOfBase: number
  behindBase: number
  worktreeActive: boolean
  pushed: boolean
  dirtyFileCount: number
}

export interface GitCommitResult {
  hash: string
  message: string
  taskId: number
  stage: string
}

export interface GitMergeResult {
  success: boolean
  conflicts: boolean
  message: string
}

export type GitBranchStatus = 'active' | 'completed' | 'stale' | 'merged'

export interface WorkshopTaskLink {
  id: string
  taskId: number
  sessionId: string | null
  artifactId: string | null
  createdAt: string
}

export interface WorkshopStreamEvent {
  type: 'text' | 'tool_call' | 'tool_result' | 'done' | 'error'
  content?: string
  toolName?: string
  toolInput?: Record<string, unknown>
  toolResult?: unknown
  sessionId?: string
  error?: string
  personaId?: string
  personaName?: string
}

export interface WorkshopToolCall {
  name: string
  input: Record<string, unknown>
}

export interface ToolCallData {
  id: string
  toolName: string
  toolInput?: Record<string, unknown>
  toolResult?: unknown
  timestamp: string
}

export type MessageSegment =
  | { type: 'text'; content: string }
  | { type: 'thinking' }
  | { type: 'tool_call'; tool: ToolCallData }
  | { type: 'tool_group'; toolName: string; tools: ToolCallData[] }

export interface WorkshopSuggestedTask {
  title: string
  description: string
  tier: 'L1' | 'L2' | 'L3'
  priority?: Priority
  linkedArtifactIds?: string[]
  dependsOn?: number[]
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
  | 'tasks:stats'
  | 'tasks:archive'
  | 'tasks:unarchive'
  | 'tasks:archive-all-done'
  | 'pipeline:init'
  | 'pipeline:start'
  | 'pipeline:step'
  | 'pipeline:approve'
  | 'pipeline:reject'
  | 'pipeline:respond'
  | 'pipeline:resolve-approval'
  | 'pipeline:stream'
  | 'pipeline:status'
  | 'pipeline:approval-request'
  | 'workshop:start-session'
  | 'workshop:end-session'
  | 'workshop:list-sessions'
  | 'workshop:get-session'
  | 'workshop:send-message'
  | 'workshop:list-messages'
  | 'workshop:list-artifacts'
  | 'workshop:get-artifact'
  | 'workshop:create-tasks'
  | 'workshop:stop-session'
  | 'workshop:delete-session'
  | 'workshop:recover-session'
  | 'workshop:rename-session'
  | 'workshop:session-renamed'
  | 'workshop:start-panel-session'
  | 'workshop:send-panel-message'
  | 'workshop:trigger-discuss'
  | 'workshop:stream'
  | 'workshop:tool-event'
  | 'git:get-branches' | 'git:get-branch-detail' | 'git:push'
  | 'git:merge' | 'git:delete-branch' | 'git:commit'
  | 'git:get-local-branches' | 'git:set-base-branch'
  | 'git:branch-created' | 'git:commit-complete'
  | 'git:push-complete' | 'git:merge-complete' | 'git:error'
  | 'git:get-working-tree-status' | 'git:stage-all'
  | 'pipeline:pause'
  | 'pipeline:resume'
  | 'pipeline:pause-all'
  | 'pipeline:context-update'
  | 'tasks:get-dependencies'
  | 'pipeline:task-unblocked'
  | 'usage:get-snapshot'
  | 'usage:snapshot'
  | 'fs:pick-directory'
  | 'window:minimize'
  | 'window:maximize'
  | 'window:close'

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
