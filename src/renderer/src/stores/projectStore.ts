import { create } from 'zustand'
import type { Project, ProjectStats } from '../../../shared/types'

interface ProjectState {
  projects: Project[]
  currentProject: Project | null
  stats: ProjectStats | null
  loading: boolean
  loadProjects: () => Promise<void>
  registerProject: (name: string, path: string) => Promise<Project>
  openProject: (project: Project) => Promise<void>
  deleteProject: (name: string) => Promise<void>
  clearCurrentProject: () => void
}

export const useProjectStore = create<ProjectState>((set, get) => ({
  projects: [],
  currentProject: null,
  stats: null,
  loading: false,

  loadProjects: async () => {
    set({ loading: true })
    const projects = await window.api.projects.list()
    set({ projects, loading: false })
  },

  registerProject: async (name, path) => {
    const project = await window.api.projects.register(name, path)
    await get().loadProjects()
    return project
  },

  openProject: async (project) => {
    await window.api.projects.open(project.name)
    await window.api.pipeline.init(project.dbPath, project.path)
    const stats = await window.api.tasks.stats(project.dbPath)
    set({ currentProject: project, stats })
  },

  deleteProject: async (name) => {
    await window.api.projects.delete(name)
    const { currentProject } = get()
    if (currentProject?.name === name) set({ currentProject: null, stats: null })
    await get().loadProjects()
  },

  clearCurrentProject: () => set({ currentProject: null, stats: null })
}))
