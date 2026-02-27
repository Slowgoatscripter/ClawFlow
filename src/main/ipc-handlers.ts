import { ipcMain, dialog } from 'electron'
import {
  listProjects, registerProject, openProject, deleteProject,
  listTasks, createTask, getTask, updateTask, deleteTask,
  getProjectStats, archiveTask, unarchiveTask, archiveAllDone,
  getGlobalSetting, getAllGlobalSettings, setGlobalSetting, deleteGlobalSetting,
  getProjectSetting, getAllProjectSettings, setProjectSetting, deleteProjectSetting,
  addTaskDependencies, getTaskDependencies
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
  ipcMain.handle('tasks:get-dependencies', (_e, dbPath: string, taskId: number) => {
    return getTaskDependencies(dbPath, taskId)
  })
  ipcMain.handle('tasks:create-batch', (_e, dbPath: string, tasks: Array<{ title: string; description: string; tier: string; priority?: string; dependsOn?: number[] }>) => {
    const createdTasks: { id: number; index: number }[] = []
    for (let i = 0; i < tasks.length; i++) {
      const created = createTask(dbPath, {
        title: tasks[i].title,
        description: tasks[i].description,
        tier: tasks[i].tier,
        priority: tasks[i].priority ?? 'medium',
      })
      createdTasks.push({ id: created.id, index: i })
    }

    // Wire dependencies using index-to-ID mapping
    for (let i = 0; i < tasks.length; i++) {
      const depIndices = tasks[i].dependsOn ?? []
      if (depIndices.length > 0) {
        const depIds = depIndices
          .filter(idx => idx >= 0 && idx < createdTasks.length)
          .map(idx => createdTasks[idx].id)
        if (depIds.length > 0) {
          addTaskDependencies(dbPath, createdTasks[i].id, depIds)
        }
      }
    }

    return createdTasks.map(ct => getTask(dbPath, ct.id))
  })

  // --- Filesystem ---
  ipcMain.handle('fs:pick-directory', async () => {
    const result = await dialog.showOpenDialog({ properties: ['openDirectory'] })
    return result.canceled ? null : result.filePaths[0]
  })

  // --- Settings ---
  ipcMain.handle('settings:get-all-global', () => getAllGlobalSettings())
  ipcMain.handle('settings:get-global', (_e, key: string) => getGlobalSetting(key))
  ipcMain.handle('settings:set-global', (_e, key: string, value: string) => setGlobalSetting(key, value))
  ipcMain.handle('settings:delete-global', (_e, key: string) => deleteGlobalSetting(key))
  ipcMain.handle('settings:get-all-project', (_e, dbPath: string) => getAllProjectSettings(dbPath))
  ipcMain.handle('settings:get-project', (_e, dbPath: string, key: string) => getProjectSetting(dbPath, key))
  ipcMain.handle('settings:set-project', (_e, dbPath: string, key: string, value: string) => setProjectSetting(dbPath, key, value))
  ipcMain.handle('settings:delete-project', (_e, dbPath: string, key: string) => deleteProjectSetting(dbPath, key))
}
