import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('api', {
  projects: {
    list: () => ipcRenderer.invoke('projects:list'),
    register: (name: string, path: string) => ipcRenderer.invoke('projects:register', name, path),
    open: (name: string) => ipcRenderer.invoke('projects:open', name),
    delete: (name: string) => ipcRenderer.invoke('projects:delete', name)
  },
  tasks: {
    list: (dbPath: string) => ipcRenderer.invoke('tasks:list', dbPath),
    create: (dbPath: string, input: any) => ipcRenderer.invoke('tasks:create', dbPath, input),
    get: (dbPath: string, taskId: number) => ipcRenderer.invoke('tasks:get', dbPath, taskId),
    update: (dbPath: string, taskId: number, updates: Record<string, any>) => ipcRenderer.invoke('tasks:update', dbPath, taskId, updates),
    delete: (dbPath: string, taskId: number) => ipcRenderer.invoke('tasks:delete', dbPath, taskId),
    stats: (dbPath: string) => ipcRenderer.invoke('tasks:stats', dbPath)
  },
  pipeline: {
    start: (taskId: number) => ipcRenderer.invoke('pipeline:start', taskId),
    step: (taskId: number) => ipcRenderer.invoke('pipeline:step', taskId),
    approve: (taskId: number) => ipcRenderer.invoke('pipeline:approve', taskId),
    reject: (taskId: number, feedback: string) => ipcRenderer.invoke('pipeline:reject', taskId, feedback),
    resolveApproval: (requestId: string, approved: boolean, message?: string) =>
      ipcRenderer.invoke('pipeline:resolve-approval', requestId, approved, message),
    onStream: (callback: (event: any) => void) => {
      ipcRenderer.on('pipeline:stream', (_e, data) => callback(data))
      return () => ipcRenderer.removeAllListeners('pipeline:stream')
    },
    onApprovalRequest: (callback: (event: any) => void) => {
      ipcRenderer.on('pipeline:approval-request', (_e, data) => callback(data))
      return () => ipcRenderer.removeAllListeners('pipeline:approval-request')
    },
    onStatusChange: (callback: (event: any) => void) => {
      ipcRenderer.on('pipeline:status', (_e, data) => callback(data))
      return () => ipcRenderer.removeAllListeners('pipeline:status')
    }
  },
  fs: {
    pickDirectory: () => ipcRenderer.invoke('fs:pick-directory')
  }
})
