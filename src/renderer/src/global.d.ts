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
    start: (taskId: number) => Promise<void>
    step: (taskId: number) => Promise<void>
    approve: (taskId: number) => Promise<void>
    reject: (taskId: number, feedback: string) => Promise<void>
    resolveApproval: (requestId: string, approved: boolean, message?: string) => Promise<void>
    onStream: (callback: (event: any) => void) => () => void
    onApprovalRequest: (callback: (event: any) => void) => () => void
    onStatusChange: (callback: (event: any) => void) => () => void
  }
  fs: {
    pickDirectory: () => Promise<string | null>
  }
}

declare global {
  interface Window {
    api: WindowApi
  }
}

export {}
