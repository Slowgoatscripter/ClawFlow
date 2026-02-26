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
    init: (dbPath: string, projectPath: string) => ipcRenderer.invoke('pipeline:init', dbPath, projectPath),
    start: (taskId: number) => ipcRenderer.invoke('pipeline:start', taskId),
    step: (taskId: number) => ipcRenderer.invoke('pipeline:step', taskId),
    approve: (taskId: number) => ipcRenderer.invoke('pipeline:approve', taskId),
    reject: (taskId: number, feedback: string) => ipcRenderer.invoke('pipeline:reject', taskId, feedback),
    respond: (taskId: number, response: string) => ipcRenderer.invoke('pipeline:respond', taskId, response),
    resolveApproval: (requestId: string, approved: boolean, message?: string) =>
      ipcRenderer.invoke('pipeline:resolve-approval', requestId, approved, message),
    onStream: (callback: (event: any) => void) => {
      const handler = (_e: any, data: any) => callback(data)
      ipcRenderer.on('pipeline:stream', handler)
      return () => { ipcRenderer.removeListener('pipeline:stream', handler) }
    },
    onApprovalRequest: (callback: (event: any) => void) => {
      const handler = (_e: any, data: any) => callback(data)
      ipcRenderer.on('pipeline:approval-request', handler)
      return () => { ipcRenderer.removeListener('pipeline:approval-request', handler) }
    },
    onStatusChange: (callback: (event: any) => void) => {
      const handler = (_e: any, data: any) => callback(data)
      ipcRenderer.on('pipeline:status', handler)
      return () => { ipcRenderer.removeListener('pipeline:status', handler) }
    },
    onTodosUpdated: (callback: (event: any) => void) => {
      const handler = (_e: any, data: any) => callback(data)
      ipcRenderer.on('pipeline:todos-updated', handler)
      return () => { ipcRenderer.removeListener('pipeline:todos-updated', handler) }
    }
  },
  workshop: {
    startSession: (dbPath: string, projectPath: string, projectId: string, projectName: string, title?: string) =>
      ipcRenderer.invoke('workshop:start-session', dbPath, projectPath, projectId, projectName, title),
    endSession: (sessionId: string) =>
      ipcRenderer.invoke('workshop:end-session', sessionId),
    stopSession: (sessionId: string) =>
      ipcRenderer.invoke('workshop:stop-session', sessionId),
    deleteSession: (sessionId: string) =>
      ipcRenderer.invoke('workshop:delete-session', sessionId),
    listSessions: (dbPath: string, projectPath: string, projectId: string, projectName: string) =>
      ipcRenderer.invoke('workshop:list-sessions', dbPath, projectPath, projectId, projectName),
    getSession: (sessionId: string) =>
      ipcRenderer.invoke('workshop:get-session', sessionId),
    sendMessage: (sessionId: string, content: string) =>
      ipcRenderer.invoke('workshop:send-message', sessionId, content),
    listMessages: (dbPath: string, sessionId: string) =>
      ipcRenderer.invoke('workshop:list-messages', dbPath, sessionId),
    listArtifacts: () =>
      ipcRenderer.invoke('workshop:list-artifacts'),
    getArtifact: (artifactId: string) =>
      ipcRenderer.invoke('workshop:get-artifact', artifactId),
    createTasks: (sessionId: string, tasks: any[]) =>
      ipcRenderer.invoke('workshop:create-tasks', sessionId, tasks),
    recoverSession: (sessionId: string) =>
      ipcRenderer.invoke('workshop:recover-session', sessionId),
    renameSession: (sessionId: string, title: string) =>
      ipcRenderer.invoke('workshop:rename-session', sessionId, title),
    startPanelSession: (
      dbPath: string, projectPath: string,
      projectId: string, projectName: string,
      title: string, panelPersonas: any[]
    ) => ipcRenderer.invoke(
      'workshop:start-panel-session',
      dbPath, projectPath, projectId, projectName, title, panelPersonas
    ),
    sendPanelMessage: (sessionId: string, content: string) =>
      ipcRenderer.invoke('workshop:send-panel-message', sessionId, content),
    triggerDiscuss: (sessionId: string) =>
      ipcRenderer.invoke('workshop:trigger-discuss', sessionId),
    onSessionRenamed: (callback: (data: { sessionId: string; title: string }) => void) => {
      const handler = (_e: any, data: any) => callback(data)
      ipcRenderer.on('workshop:session-renamed', handler)
      return () => { ipcRenderer.removeListener('workshop:session-renamed', handler) }
    },
    onStream: (callback: (event: any) => void) => {
      const handler = (_e: any, data: any) => callback(data)
      ipcRenderer.on('workshop:stream', handler)
      return () => { ipcRenderer.removeListener('workshop:stream', handler) }
    },
    onToolEvent: (callback: (event: any) => void) => {
      const handler = (_e: any, data: any) => callback(data)
      ipcRenderer.on('workshop:tool-event', handler)
      return () => { ipcRenderer.removeListener('workshop:tool-event', handler) }
    }
  },
  git: {
    getBranches: (dbPath: string, projectPath: string) =>
      ipcRenderer.invoke('git:get-branches', dbPath, projectPath),
    getBranchDetail: (dbPath: string, projectPath: string, taskId: number) =>
      ipcRenderer.invoke('git:get-branch-detail', dbPath, projectPath, taskId),
    push: (dbPath: string, projectPath: string, taskId: number) =>
      ipcRenderer.invoke('git:push', dbPath, projectPath, taskId),
    merge: (dbPath: string, projectPath: string, taskId: number, targetBranch?: string) =>
      ipcRenderer.invoke('git:merge', dbPath, projectPath, taskId, targetBranch),
    deleteBranch: (dbPath: string, projectPath: string, taskId: number) =>
      ipcRenderer.invoke('git:delete-branch', dbPath, projectPath, taskId),
    commit: (dbPath: string, projectPath: string, taskId: number, message: string) =>
      ipcRenderer.invoke('git:commit', dbPath, projectPath, taskId, message),
    getLocalBranches: (dbPath: string, projectPath: string) =>
      ipcRenderer.invoke('git:get-local-branches', dbPath, projectPath),
    setBaseBranch: (dbPath: string, projectPath: string, projectName: string, branchName: string) =>
      ipcRenderer.invoke('git:set-base-branch', dbPath, projectPath, projectName, branchName),
    getWorkingTreeStatus: (dbPath: string, projectPath: string, taskId: number) =>
      ipcRenderer.invoke('git:get-working-tree-status', dbPath, projectPath, taskId),
    stageAll: (dbPath: string, projectPath: string, taskId: number) =>
      ipcRenderer.invoke('git:stage-all', dbPath, projectPath, taskId),
    onBranchCreated: (callback: (data: any) => void) => {
      const handler = (_e: any, data: any) => callback(data)
      ipcRenderer.on('git:branch-created', handler)
      return () => { ipcRenderer.removeListener('git:branch-created', handler) }
    },
    onCommitComplete: (callback: (data: any) => void) => {
      const handler = (_e: any, data: any) => callback(data)
      ipcRenderer.on('git:commit-complete', handler)
      return () => { ipcRenderer.removeListener('git:commit-complete', handler) }
    },
    onPushComplete: (callback: (data: any) => void) => {
      const handler = (_e: any, data: any) => callback(data)
      ipcRenderer.on('git:push-complete', handler)
      return () => { ipcRenderer.removeListener('git:push-complete', handler) }
    },
    onMergeComplete: (callback: (data: any) => void) => {
      const handler = (_e: any, data: any) => callback(data)
      ipcRenderer.on('git:merge-complete', handler)
      return () => { ipcRenderer.removeListener('git:merge-complete', handler) }
    },
    onError: (callback: (data: any) => void) => {
      const handler = (_e: any, data: any) => callback(data)
      ipcRenderer.on('git:error', handler)
      return () => { ipcRenderer.removeListener('git:error', handler) }
    }
  },
  fs: {
    pickDirectory: () => ipcRenderer.invoke('fs:pick-directory')
  },
  window: {
    minimize: () => ipcRenderer.invoke('window:minimize'),
    maximize: () => ipcRenderer.invoke('window:maximize'),
    close: () => ipcRenderer.invoke('window:close')
  }
})
