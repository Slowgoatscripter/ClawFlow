import { ipcMain, dialog } from 'electron'
import {
  listProjects, registerProject, openProject, deleteProject,
  listTasks, createTask, getTask, updateTask, deleteTask,
  getProjectStats, archiveTask, unarchiveTask, archiveAllDone
} from './db'
import type { CreateTaskInput } from '../shared/types'

export function registerIpcHandlers() {
  // --- Projects ---
  ipcMain.handle('projects:list', () => listProjects())
  ipcMain.handle('projects:register', (_e, name: string, projectPath: string) => registerProject(name, projectPath))
  ipcMain.handle('projects:open', (_e, name: string) => { openProject(name); return true })
  ipcMain.handle('projects:delete', (_e, name: string) => { deleteProject(name); return true })

  // --- Tasks ---
  ipcMain.handle('tasks:list', (_e, dbPath: string) => listTasks(dbPath))
  ipcMain.handle('tasks:create', (_e, dbPath: string, input: CreateTaskInput) => createTask(dbPath, input))
  ipcMain.handle('tasks:get', (_e, dbPath: string, taskId: number) => getTask(dbPath, taskId))
  ipcMain.handle('tasks:update', (_e, dbPath: string, taskId: number, updates: Record<string, any>) => updateTask(dbPath, taskId, updates))
  ipcMain.handle('tasks:delete', (_e, dbPath: string, taskId: number) => { deleteTask(dbPath, taskId); return true })
  ipcMain.handle('tasks:stats', (_e, dbPath: string) => getProjectStats(dbPath))
  ipcMain.handle('tasks:archive', (_e, dbPath: string, taskId: number) => archiveTask(dbPath, taskId))
  ipcMain.handle('tasks:unarchive', (_e, dbPath: string, taskId: number) => unarchiveTask(dbPath, taskId))
  ipcMain.handle('tasks:archive-all-done', (_e, dbPath: string) => { archiveAllDone(dbPath); return true })

  // --- Filesystem ---
  ipcMain.handle('fs:pick-directory', async () => {
    const result = await dialog.showOpenDialog({ properties: ['openDirectory'] })
    return result.canceled ? null : result.filePaths[0]
  })
}
