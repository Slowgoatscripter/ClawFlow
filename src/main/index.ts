import { app, BrowserWindow, ipcMain } from 'electron'
import path from 'path'
import { registerIpcHandlers } from './ipc-handlers'
import { closeAllDbs } from './db'
import { PipelineEngine } from './pipeline-engine'
import { createSdkRunner, resolveApproval } from './sdk-manager'

let mainWindow: BrowserWindow | null = null
let currentEngine: PipelineEngine | null = null

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false
    },
    backgroundColor: '#1a1b26',
    titleBarStyle: 'hiddenInset'
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
  }
}

function registerPipelineIpc() {
  ipcMain.handle('pipeline:init', (_e, dbPath: string, projectPath: string) => {
    currentEngine = new PipelineEngine(dbPath, projectPath)
    const sdkRunner = createSdkRunner(mainWindow!)
    currentEngine.setSdkRunner(sdkRunner)

    currentEngine.on('stage:pause', (data) => mainWindow?.webContents.send('pipeline:status', { type: 'pause', ...data }))
    currentEngine.on('stage:complete', (data) => mainWindow?.webContents.send('pipeline:status', { type: 'complete', ...data }))
    currentEngine.on('stage:error', (data) => mainWindow?.webContents.send('pipeline:status', { type: 'error', ...data }))
    currentEngine.on('circuit-breaker', (data) => mainWindow?.webContents.send('pipeline:status', { type: 'circuit-breaker', ...data }))

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

  ipcMain.handle('pipeline:resolve-approval', (_e, requestId: string, approved: boolean, message?: string) => {
    resolveApproval(requestId, approved, message)
  })
}

app.whenReady().then(() => {
  registerIpcHandlers()
  registerPipelineIpc()
  createWindow()
})

app.on('window-all-closed', () => {
  closeAllDbs()
  if (process.platform !== 'darwin') app.quit()
})
