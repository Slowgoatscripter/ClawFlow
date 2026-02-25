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
