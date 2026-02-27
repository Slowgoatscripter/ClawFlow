import { app, BrowserWindow, ipcMain, screen } from 'electron'
import path from 'path'
import fs from 'fs'
import { registerIpcHandlers } from './ipc-handlers'
import { closeAllDbs, listWorkshopMessages, listProjects, updateProjectBaseBranch, createWorkshopMessage, updateWorkshopSession } from './db'
import { PipelineEngine } from './pipeline-engine'
import type { PipelineStage } from '../shared/types'
import { WorkshopEngine } from './workshop-engine'
import { createSdkRunner, resolveApproval } from './sdk-manager'
import { GitEngine } from './git-engine'
import { UsageMonitor } from './usage-monitor'

let mainWindow: BrowserWindow | null = null
let currentEngine: PipelineEngine | null = null
let currentWorkshopEngine: WorkshopEngine | null = null
let currentGitEngine: GitEngine | null = null

// --- Window state persistence ---

interface WindowState {
  x?: number
  y?: number
  width: number
  height: number
  isMaximized: boolean
}

function getWindowStatePath(): string {
  const dir = path.join(app.getPath('home'), '.clawflow')
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  return path.join(dir, 'window-state.json')
}

function loadWindowState(): WindowState {
  try {
    const raw = fs.readFileSync(getWindowStatePath(), 'utf-8')
    return JSON.parse(raw)
  } catch {
    return { width: 1400, height: 900, isMaximized: false }
  }
}

function saveWindowState(win: BrowserWindow): void {
  try {
    const bounds = win.getBounds()
    const state: WindowState = {
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
      isMaximized: win.isMaximized()
    }
    fs.writeFileSync(getWindowStatePath(), JSON.stringify(state))
  } catch {
    // Silently ignore write errors
  }
}

function createWindow() {
  const state = loadWindowState()

  const opts: Electron.BrowserWindowConstructorOptions = {
    width: state.width,
    height: state.height,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false
    },
    backgroundColor: '#1a1b26',
    titleBarStyle: 'hiddenInset'
  }

  // Restore position if it was saved and is on a visible display
  if (state.x !== undefined && state.y !== undefined) {
    const displays = screen.getAllDisplays()
    const onScreen = displays.some((d) => {
      const b = d.bounds
      return state.x! >= b.x && state.x! < b.x + b.width && state.y! >= b.y && state.y! < b.y + b.height
    })
    if (onScreen) {
      opts.x = state.x
      opts.y = state.y
    }
  }

  mainWindow = new BrowserWindow(opts)

  if (state.isMaximized) mainWindow.maximize()

  // Save state on resize/move
  let saveTimeout: ReturnType<typeof setTimeout> | null = null
  const debouncedSave = () => {
    if (saveTimeout) clearTimeout(saveTimeout)
    saveTimeout = setTimeout(() => {
      if (mainWindow && !mainWindow.isDestroyed()) saveWindowState(mainWindow)
    }, 300)
  }

  mainWindow.on('resize', debouncedSave)
  mainWindow.on('move', debouncedSave)
  mainWindow.on('maximize', debouncedSave)
  mainWindow.on('unmaximize', debouncedSave)
  mainWindow.on('close', () => {
    if (mainWindow && !mainWindow.isDestroyed()) saveWindowState(mainWindow)
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
  }
}

function ensureGitEngine(dbPath: string, projectPath: string): GitEngine {
  if (!currentGitEngine || currentGitEngine['dbPath'] !== dbPath) {
    currentGitEngine = new GitEngine(dbPath, projectPath)
    // Load configured base branch from project settings
    const projects = listProjects()
    const project = projects.find(p => p.dbPath === dbPath)
    if (project?.defaultBaseBranch) {
      currentGitEngine.setBaseBranch(project.defaultBaseBranch)
    }
    // Bridge events to renderer
    currentGitEngine.on('branch:created', (data) =>
      mainWindow?.webContents.send('git:branch-created', data))
    currentGitEngine.on('commit:complete', (data) =>
      mainWindow?.webContents.send('git:commit-complete', data))
    currentGitEngine.on('push:complete', (data) =>
      mainWindow?.webContents.send('git:push-complete', data))
    currentGitEngine.on('merge:complete', (data) =>
      mainWindow?.webContents.send('git:merge-complete', data))
    currentGitEngine.on('git:error', (data) =>
      mainWindow?.webContents.send('git:error', data))
    // Init repo detection
    currentGitEngine.initRepo().catch(err =>
      console.warn('Git init failed:', err.message))
  }
  return currentGitEngine
}

function registerGitIpc() {
  ipcMain.handle('git:get-branches', async (_e, dbPath, projectPath) => {
    const engine = ensureGitEngine(dbPath, projectPath)
    return engine.getBranches()
  })
  ipcMain.handle('git:get-branch-detail', async (_e, dbPath, projectPath, taskId) => {
    const engine = ensureGitEngine(dbPath, projectPath)
    return engine.getBranchDetail(taskId)
  })
  ipcMain.handle('git:push', async (_e, dbPath, projectPath, taskId) => {
    const engine = ensureGitEngine(dbPath, projectPath)
    return engine.push(taskId)
  })
  ipcMain.handle('git:merge', async (_e, dbPath, projectPath, taskId, targetBranch?) => {
    const engine = ensureGitEngine(dbPath, projectPath)
    return engine.merge(taskId, targetBranch)
  })
  ipcMain.handle('git:delete-branch', async (_e, dbPath, projectPath, taskId) => {
    const engine = ensureGitEngine(dbPath, projectPath)
    return engine.deleteBranch(taskId)
  })
  ipcMain.handle('git:commit', async (_e, dbPath, projectPath, taskId, message) => {
    const engine = ensureGitEngine(dbPath, projectPath)
    return engine.stageCommit(taskId, message)
  })
  ipcMain.handle('git:get-local-branches', async (_e, dbPath, projectPath) => {
    const engine = ensureGitEngine(dbPath, projectPath)
    return engine.listLocalBranches()
  })
  ipcMain.handle('git:set-base-branch', async (_e, dbPath, projectPath, projectName, branchName) => {
    const engine = ensureGitEngine(dbPath, projectPath)
    engine.setBaseBranch(branchName)
    updateProjectBaseBranch(projectName, branchName)
    return engine.getBaseBranch()
  })
  ipcMain.handle('git:get-working-tree-status', async (_e, dbPath, projectPath, taskId) => {
    const engine = ensureGitEngine(dbPath, projectPath)
    return engine.getWorkingTreeStatus(taskId)
  })
  ipcMain.handle('git:stage-all', async (_e, dbPath, projectPath, taskId) => {
    const engine = ensureGitEngine(dbPath, projectPath)
    return engine.stageAll(taskId)
  })
}

function registerPipelineIpc() {
  let usageMonitor: UsageMonitor | null = null

  ipcMain.handle('pipeline:init', (_e, dbPath: string, projectPath: string) => {
    currentEngine = new PipelineEngine(dbPath, projectPath)
    const sdkRunner = createSdkRunner(mainWindow!)
    currentEngine.setSdkRunner(sdkRunner)

    currentEngine.on('stage:start', (data) => mainWindow?.webContents.send('pipeline:status', { type: 'start', ...data }))
    currentEngine.on('stage:pause', (data) => mainWindow?.webContents.send('pipeline:status', { type: 'pause', ...data }))
    currentEngine.on('stage:complete', (data) => mainWindow?.webContents.send('pipeline:status', { type: 'complete', ...data }))
    currentEngine.on('stage:error', (data) => mainWindow?.webContents.send('pipeline:status', { type: 'error', ...data }))
    currentEngine.on('circuit-breaker', (data) => mainWindow?.webContents.send('pipeline:status', { type: 'circuit-breaker', ...data }))
    currentEngine.on('stage:awaiting-review', (data) => mainWindow?.webContents.send('pipeline:status', { type: 'awaiting-review', ...data }))
    currentEngine.on('stage:paused', (data) =>
      mainWindow?.webContents.send('pipeline:status', { type: 'paused', ...data }))
    currentEngine.on('context-update', (data) =>
      mainWindow?.webContents.send('pipeline:context-update', data))
    currentEngine.on('stage:context_handoff', (data) =>
      mainWindow?.webContents.send('pipeline:contextHandoff', data))
    currentEngine.on('task:unblocked', ({ taskId }: { taskId: number }) => {
      mainWindow?.webContents.send('pipeline:task-unblocked', { taskId })
    })

    const gitEngine = ensureGitEngine(dbPath, projectPath)
    currentEngine.setGitEngine(gitEngine)

    // Usage monitoring
    usageMonitor = new UsageMonitor()

    usageMonitor.on('snapshot', (snapshot) => {
      mainWindow?.webContents.send('usage:snapshot', snapshot)
    })

    usageMonitor.on('limit-approaching', async (data) => {
      if (!currentEngine) return
      const count = await currentEngine.pauseAllTasks('usage_limit')
      mainWindow?.webContents.send('pipeline:status', {
        type: 'usage-paused',
        pausedCount: count,
        utilization: data.utilization,
        countdown: data.countdown
      })
    })

    usageMonitor.start()

    return true
  })

  ipcMain.handle('pipeline:start', async (_e, taskId: number) => {
    if (!currentEngine) throw new Error('Pipeline not initialized')
    await currentEngine.runFullPipeline(taskId)
  })

  ipcMain.handle('pipeline:step', async (_e, taskId: number) => {
    if (!currentEngine) throw new Error('Pipeline not initialized')
    await currentEngine.stepTask(taskId)
  })

  ipcMain.handle('pipeline:approve', async (_e, taskId: number) => {
    if (!currentEngine) throw new Error('Pipeline not initialized')
    await currentEngine.approveStage(taskId)
  })

  ipcMain.handle('pipeline:reject', async (_e, taskId: number, feedback: string) => {
    if (!currentEngine) throw new Error('Pipeline not initialized')
    await currentEngine.rejectStage(taskId, feedback)
  })

  ipcMain.handle('pipeline:respond', async (_e, taskId: number, response: string) => {
    if (!currentEngine) throw new Error('Pipeline not initialized')
    await currentEngine.respondToQuestions(taskId, response)
  })

  ipcMain.handle('pipeline:resolve-approval', (_e, requestId: string, approved: boolean, message?: string) => {
    resolveApproval(requestId, approved, message)
  })

  ipcMain.handle('pipeline:pause', async (_e, taskId: number) => {
    if (!currentEngine) throw new Error('Pipeline not initialized')
    return currentEngine.pauseTask(taskId, 'manual')
  })

  ipcMain.handle('pipeline:resume', async (_e, taskId: number) => {
    if (!currentEngine) throw new Error('Pipeline not initialized')
    return currentEngine.resumeTask(taskId)
  })

  ipcMain.handle('pipeline:pause-all', async () => {
    if (!currentEngine) throw new Error('Pipeline not initialized')
    return currentEngine.pauseAllTasks('manual')
  })

  ipcMain.handle('pipeline:approveContextHandoff', async (_e, taskId: number) => {
    if (!currentEngine) throw new Error('Pipeline not initialized')
    await currentEngine.approveContextHandoff(taskId)
  })

  ipcMain.handle('pipeline:restartToStage', async (_e, taskId: number, targetStage: string) => {
    if (!currentEngine) throw new Error('Pipeline not initialized')
    await currentEngine.restartToStage(taskId, targetStage as PipelineStage)
  })

  ipcMain.handle('usage:get-snapshot', () => {
    return usageMonitor?.getSnapshot() ?? null
  })
}

function ensureWorkshopEngine(dbPath: string, projectPath: string, projectId: string, projectName: string): WorkshopEngine {
  if (!currentWorkshopEngine || currentWorkshopEngine['dbPath'] !== dbPath) {
    currentWorkshopEngine = new WorkshopEngine(dbPath, projectPath, projectId, projectName)
    const sdkRunner = createSdkRunner(mainWindow!)
    currentWorkshopEngine.setSdkRunner(sdkRunner)

    currentWorkshopEngine.on('stream', (event) => {
      mainWindow?.webContents.send('workshop:stream', event)
    })
    currentWorkshopEngine.on('artifact:created', (artifact) => {
      mainWindow?.webContents.send('workshop:tool-event', { type: 'artifact_created', artifact })
    })
    currentWorkshopEngine.on('artifact:updated', (data) => {
      mainWindow?.webContents.send('workshop:tool-event', { type: 'artifact_updated', ...data })
    })
    currentWorkshopEngine.on('tasks:suggested', (data) => {
      mainWindow?.webContents.send('workshop:tool-event', { type: 'tasks_suggested', ...data })
    })
    currentWorkshopEngine.on('task:created', (data) => {
      mainWindow?.webContents.send('workshop:tool-event', { type: 'task_created', ...data })
    })
    currentWorkshopEngine.on('session:renamed', (data) => {
      mainWindow?.webContents.send('workshop:session-renamed', data)
    })
  }
  return currentWorkshopEngine
}

function registerWorkshopIpc() {
  ipcMain.handle('workshop:start-session', (_e, dbPath, projectPath, projectId, projectName, title?) => {
    const engine = ensureWorkshopEngine(dbPath, projectPath, projectId, projectName)
    return engine.startSession(title)
  })

  ipcMain.handle('workshop:end-session', async (_e, sessionId) => {
    await currentWorkshopEngine?.endSession(sessionId)
  })

  ipcMain.handle('workshop:stop-session', (_e, sessionId) => {
    currentWorkshopEngine?.stopSession(sessionId)
  })

  ipcMain.handle('workshop:delete-session', (_e, sessionId) => {
    currentWorkshopEngine?.deleteSession(sessionId)
  })

  ipcMain.handle('workshop:list-sessions', (_e, dbPath, projectPath, projectId, projectName) => {
    const engine = ensureWorkshopEngine(dbPath, projectPath, projectId, projectName)
    return engine.listSessions()
  })

  ipcMain.handle('workshop:get-session', (_e, sessionId) => {
    return currentWorkshopEngine?.getSession(sessionId) ?? null
  })

  ipcMain.handle('workshop:send-message', async (_e, sessionId, content) => {
    await currentWorkshopEngine?.sendMessage(sessionId, content)
  })

  ipcMain.handle('workshop:list-messages', (_e, dbPath, sessionId) => {
    return listWorkshopMessages(dbPath, sessionId)
  })

  ipcMain.handle('workshop:list-artifacts', (_e) => {
    return currentWorkshopEngine?.listArtifacts() ?? []
  })

  ipcMain.handle('workshop:get-artifact', (_e, artifactId) => {
    const content = currentWorkshopEngine?.getArtifactContent(artifactId) ?? null
    const artifacts = currentWorkshopEngine?.listArtifacts() ?? []
    const artifact = artifacts.find(a => a.id === artifactId) ?? null
    return { artifact, content }
  })

  ipcMain.handle('workshop:create-tasks', async (_e, sessionId, tasks) => {
    if (!currentWorkshopEngine) return
    for (const task of tasks) {
      await currentWorkshopEngine.createPipelineTask(sessionId, task)
    }
  })

  ipcMain.handle('workshop:recover-session', (_e, sessionId) => {
    if (!currentWorkshopEngine) return
    const session = currentWorkshopEngine.getSession(sessionId)
    if (session?.pendingContent) {
      createWorkshopMessage(currentWorkshopEngine['dbPath'], sessionId, 'assistant', session.pendingContent)
      updateWorkshopSession(currentWorkshopEngine['dbPath'], sessionId, { pendingContent: null })
    }
  })

  ipcMain.handle('workshop:rename-session', (_e, sessionId, title) => {
    return currentWorkshopEngine?.renameSession(sessionId, title) ?? null
  })

  ipcMain.handle(
    'workshop:start-panel-session',
    (_e, dbPath, projectPath, projectId, projectName, title, panelPersonas) => {
      const engine = ensureWorkshopEngine(dbPath, projectPath, projectId, projectName)
      return engine.startSession(title, 'panel', panelPersonas)
    }
  )

  ipcMain.handle(
    'workshop:send-panel-message',
    async (_e, sessionId, content) => {
      await currentWorkshopEngine?.sendPanelMessage(sessionId, content)
    }
  )

  ipcMain.handle(
    'workshop:trigger-discuss',
    async (_e, sessionId) => {
      await currentWorkshopEngine?.triggerDiscuss(sessionId)
    }
  )
}

function registerWindowIpc() {
  ipcMain.handle('window:minimize', () => {
    mainWindow?.minimize()
  })
  ipcMain.handle('window:maximize', () => {
    if (mainWindow?.isMaximized()) {
      mainWindow.unmaximize()
    } else {
      mainWindow?.maximize()
    }
  })
  ipcMain.handle('window:close', () => {
    mainWindow?.close()
  })
}

app.whenReady().then(() => {
  registerIpcHandlers()
  registerPipelineIpc()
  registerWorkshopIpc()
  registerGitIpc()
  registerWindowIpc()
  createWindow()
})

app.on('window-all-closed', () => {
  closeAllDbs()
  if (process.platform !== 'darwin') app.quit()
})
