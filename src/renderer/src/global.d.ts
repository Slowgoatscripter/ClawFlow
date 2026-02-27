interface WindowApi {
  projects: {
    list: () => Promise<import('../../../shared/types').Project[]>
    register: (name: string, path: string) => Promise<import('../../../shared/types').Project>
    open: (name: string) => Promise<boolean>
    delete: (name: string) => Promise<boolean>
  }
  tasks: {
    list: (dbPath: string) => Promise<import('../../../shared/types').Task[]>
    create: (dbPath: string, input: import('../../../shared/types').CreateTaskInput) => Promise<import('../../../shared/types').Task>
    get: (dbPath: string, taskId: number) => Promise<import('../../../shared/types').Task | null>
    update: (dbPath: string, taskId: number, updates: Record<string, any>) => Promise<import('../../../shared/types').Task | null>
    delete: (dbPath: string, taskId: number) => Promise<boolean>
    stats: (dbPath: string) => Promise<import('../../../shared/types').ProjectStats>
    getDependencies: (dbPath: string, taskId: number) => Promise<number[]>
    createBatch: (dbPath: string, tasks: any[]) => Promise<import('../../../shared/types').Task[]>
  }
  pipeline: {
    init: (dbPath: string, projectPath: string) => Promise<boolean>
    start: (taskId: number) => Promise<void>
    step: (taskId: number) => Promise<void>
    approve: (taskId: number) => Promise<void>
    reject: (taskId: number, feedback: string) => Promise<void>
    respond: (taskId: number, response: string) => Promise<void>
    resolveApproval: (requestId: string, approved: boolean, message?: string) => Promise<void>
    onStream: (callback: (event: any) => void) => () => void
    onApprovalRequest: (callback: (event: any) => void) => () => void
    onStatusChange: (callback: (event: any) => void) => () => void
    pause: (taskId: number) => Promise<any>
    resume: (taskId: number) => Promise<any>
    pauseAll: () => Promise<number>
    onContextUpdate: (cb: (data: { taskId: number; contextTokens: number; contextMax: number }) => void) => () => void
    approveContextHandoff: (taskId: number) => Promise<void>
    onContextHandoff: (callback: (data: { taskId: number; currentStage: string; nextStage: string; usagePercent: number; remainingTokens: number; estimatedNeed: number }) => void) => () => void
    onTaskUnblocked: (callback: (data: { taskId: number }) => void) => () => void
  }
  usage: {
    getSnapshot: () => Promise<any>
    onSnapshot: (cb: (data: any) => void) => () => void
  }
  workshop: {
    startSession: (dbPath: string, projectPath: string, projectId: string, projectName: string, title?: string) => Promise<any>
    endSession: (sessionId: string) => Promise<void>
    listSessions: (dbPath: string, projectPath: string, projectId: string, projectName: string) => Promise<any[]>
    getSession: (sessionId: string) => Promise<any>
    sendMessage: (sessionId: string, content: string) => Promise<void>
    listMessages: (dbPath: string, sessionId: string) => Promise<any[]>
    listArtifacts: () => Promise<any[]>
    getArtifact: (artifactId: string) => Promise<{ artifact: any; content: string | null }>
    createTasks: (sessionId: string, tasks: any[]) => Promise<void>
    onStream: (callback: (event: any) => void) => () => void
    onToolEvent: (callback: (event: any) => void) => () => void
  }
  knowledge: {
    list: (dbPath: string, options?: { category?: string; status?: string; includeArchived?: boolean }) => Promise<import('../../../shared/knowledge-types').KnowledgeEntry[]>
    get: (dbPath: string, id: string) => Promise<import('../../../shared/knowledge-types').KnowledgeEntry | null>
    getByKey: (dbPath: string, key: string) => Promise<import('../../../shared/knowledge-types').KnowledgeEntry | null>
    create: (dbPath: string, entry: any) => Promise<import('../../../shared/knowledge-types').KnowledgeEntry>
    update: (dbPath: string, id: string, updates: any) => Promise<import('../../../shared/knowledge-types').KnowledgeEntry | null>
    delete: (dbPath: string, id: string) => Promise<void>
    listCandidates: (dbPath: string, taskId?: string) => Promise<import('../../../shared/knowledge-types').KnowledgeEntry[]>
    promote: (dbPath: string, id: string, global: boolean) => Promise<import('../../../shared/knowledge-types').KnowledgeEntry | null>
    discard: (dbPath: string, id: string) => Promise<import('../../../shared/knowledge-types').KnowledgeEntry | null>
    listGlobal: () => Promise<import('../../../shared/knowledge-types').KnowledgeEntry[]>
    createGlobal: (entry: any) => Promise<import('../../../shared/knowledge-types').KnowledgeEntry>
  }
  skills: {
    list: () => Promise<import('../../../shared/skill-types').SkillInfo[]>
    view: (name: string, tier?: 'core' | 'extended') => Promise<{ core?: string; extended?: string }>
    edit: (name: string, tier: 'core' | 'extended', content: string) => Promise<void>
    fetchExtended: (name: string) => Promise<string>
  }
  settings: {
    getAllGlobal: () => Promise<Record<string, string>>
    getGlobal: (key: string) => Promise<string | null>
    setGlobal: (key: string, value: string) => Promise<void>
    deleteGlobal: (key: string) => Promise<void>
    getAllProject: (dbPath: string) => Promise<Record<string, string>>
    getProject: (dbPath: string, key: string) => Promise<string | null>
    setProject: (dbPath: string, key: string, value: string) => Promise<void>
    deleteProject: (dbPath: string, key: string) => Promise<void>
  }
  fs: {
    pickDirectory: () => Promise<string | null>
  }
  window: {
    minimize: () => Promise<void>
    maximize: () => Promise<void>
    close: () => Promise<void>
  }
}

declare global {
  interface Window {
    api: WindowApi
  }
}

export {}
