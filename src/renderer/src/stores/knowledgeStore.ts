import { create } from 'zustand'
import type { KnowledgeEntry } from '../../../shared/knowledge-types'

interface KnowledgeState {
  entries: KnowledgeEntry[]
  globalEntries: KnowledgeEntry[]
  candidates: KnowledgeEntry[]
  loading: boolean
  loadKnowledge: (dbPath: string) => Promise<void>
  loadCandidates: (dbPath: string, taskId?: string) => Promise<void>
  createEntry: (dbPath: string, entry: any) => Promise<KnowledgeEntry>
  updateEntry: (dbPath: string, id: string, updates: any) => Promise<void>
  deleteEntry: (dbPath: string, id: string) => Promise<void>
  promoteCandidate: (dbPath: string, id: string, global: boolean) => Promise<void>
  discardCandidate: (dbPath: string, id: string) => Promise<void>
}

export const useKnowledgeStore = create<KnowledgeState>((set) => ({
  entries: [],
  globalEntries: [],
  candidates: [],
  loading: false,

  loadKnowledge: async (dbPath) => {
    set({ loading: true })
    const [entries, globalEntries] = await Promise.all([
      window.api.knowledge.list(dbPath),
      window.api.knowledge.listGlobal()
    ])
    set({ entries, globalEntries, loading: false })
  },

  loadCandidates: async (dbPath, taskId?) => {
    const candidates = await window.api.knowledge.listCandidates(dbPath, taskId)
    set({ candidates })
  },

  createEntry: async (dbPath, entry) => {
    const created = await window.api.knowledge.create(dbPath, entry)
    set(state => ({ entries: [created, ...state.entries] }))
    return created
  },

  updateEntry: async (dbPath, id, updates) => {
    const updated = await window.api.knowledge.update(dbPath, id, updates)
    if (updated) {
      set(state => ({
        entries: state.entries.map(e => e.id === id ? updated : e)
      }))
    }
  },

  deleteEntry: async (dbPath, id) => {
    await window.api.knowledge.delete(dbPath, id)
    set(state => ({
      entries: state.entries.filter(e => e.id !== id)
    }))
  },

  promoteCandidate: async (dbPath, id, global) => {
    await window.api.knowledge.promote(dbPath, id, global)
    set(state => ({
      candidates: state.candidates.filter(c => c.id !== id)
    }))
  },

  discardCandidate: async (dbPath, id) => {
    await window.api.knowledge.discard(dbPath, id)
    set(state => ({
      candidates: state.candidates.filter(c => c.id !== id)
    }))
  }
}))
