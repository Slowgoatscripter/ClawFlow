import { create } from 'zustand'
import type {
  WorkshopSession,
  WorkshopMessage,
  WorkshopArtifact,
  WorkshopSuggestedTask,
  WorkshopStreamEvent
} from '../../../shared/types'

interface WorkshopState {
  sessions: WorkshopSession[]
  currentSessionId: string | null
  currentSession: WorkshopSession | null
  messages: WorkshopMessage[]
  artifacts: WorkshopArtifact[]
  selectedArtifactId: string | null
  artifactContent: string | null
  artifactLoading: boolean
  streamingContent: string
  isStreaming: boolean
  pendingSuggestions: WorkshopSuggestedTask[] | null
  suggestionsSessionId: string | null
  autoMode: boolean

  loadSessions: (dbPath: string, projectPath: string, projectId: string, projectName: string) => Promise<void>
  startSession: (dbPath: string, projectPath: string, projectId: string, projectName: string, title?: string) => Promise<void>
  endSession: (sessionId: string) => void
  selectSession: (dbPath: string, sessionId: string) => Promise<void>
  sendMessage: (sessionId: string, content: string) => Promise<void>
  loadArtifacts: () => Promise<void>
  selectArtifact: (artifactId: string) => Promise<void>
  clearArtifactSelection: () => void
  stopSession: (sessionId: string) => void
  deleteSession: (sessionId: string) => void
  approveSuggestions: (sessionId: string, tasks: WorkshopSuggestedTask[], autoMode?: boolean) => Promise<void>
  dismissSuggestions: () => void
  toggleAutoMode: () => void
  setupListeners: () => () => void
}

export const useWorkshopStore = create<WorkshopState>((set, get) => ({
  sessions: [],
  currentSessionId: null,
  currentSession: null,
  messages: [],
  artifacts: [],
  selectedArtifactId: null,
  artifactContent: null,
  artifactLoading: false,
  streamingContent: '',
  isStreaming: false,
  pendingSuggestions: null,
  suggestionsSessionId: null,
  autoMode: false,

  loadSessions: async (dbPath, projectPath, projectId, projectName) => {
    const sessions = await window.api.workshop.listSessions(dbPath, projectPath, projectId, projectName)
    set({ sessions })
  },

  startSession: async (dbPath, projectPath, projectId, projectName, title?) => {
    const session = await window.api.workshop.startSession(dbPath, projectPath, projectId, projectName, title)
    set((state) => ({
      sessions: [session, ...state.sessions],
      currentSessionId: session.id,
      currentSession: session,
      messages: []
    }))
  },

  endSession: async (sessionId) => {
    await window.api.workshop.endSession(sessionId)
    set((state) => ({
      sessions: state.sessions.map((s) =>
        s.id === sessionId ? { ...s, status: 'ended' as const } : s
      ),
      currentSession:
        state.currentSession?.id === sessionId
          ? { ...state.currentSession, status: 'ended' as const }
          : state.currentSession
    }))
  },

  selectSession: async (dbPath, sessionId) => {
    const [session, messages] = await Promise.all([
      window.api.workshop.getSession(sessionId),
      window.api.workshop.listMessages(dbPath, sessionId)
    ])
    set({
      currentSessionId: sessionId,
      currentSession: session,
      messages
    })
  },

  sendMessage: async (sessionId, content) => {
    const userMsg: WorkshopMessage = {
      id: crypto.randomUUID(),
      sessionId,
      role: 'user',
      content,
      messageType: 'text',
      metadata: null,
      createdAt: new Date().toISOString()
    }
    set((state) => ({
      messages: [...state.messages, userMsg],
      isStreaming: true,
      streamingContent: ''
    }))
    await window.api.workshop.sendMessage(sessionId, content)
  },

  stopSession: (sessionId) => {
    window.api.workshop.stopSession(sessionId)
    set({ isStreaming: false, streamingContent: '' })
  },

  deleteSession: (sessionId) => {
    window.api.workshop.deleteSession(sessionId)
    set((state) => {
      const sessions = state.sessions.filter((s) => s.id !== sessionId)
      const isCurrentDeleted = state.currentSessionId === sessionId
      return {
        sessions,
        currentSessionId: isCurrentDeleted ? null : state.currentSessionId,
        currentSession: isCurrentDeleted ? null : state.currentSession,
        messages: isCurrentDeleted ? [] : state.messages,
        isStreaming: isCurrentDeleted ? false : state.isStreaming,
        streamingContent: isCurrentDeleted ? '' : state.streamingContent,
      }
    })
  },

  loadArtifacts: async () => {
    const prev = get().artifacts
    const artifacts = await window.api.workshop.listArtifacts()
    if (artifacts.length === 0 && prev.length > 0) {
      return
    }
    set({ artifacts })
  },

  selectArtifact: async (artifactId) => {
    set({ selectedArtifactId: artifactId, artifactLoading: true, artifactContent: null })
    try {
      const result = await window.api.workshop.getArtifact(artifactId)
      set({ artifactContent: result.content ?? null, artifactLoading: false })
    } catch {
      set({ artifactLoading: false })
    }
  },

  clearArtifactSelection: () => set({ selectedArtifactId: null, artifactContent: null, artifactLoading: false }),

  approveSuggestions: async (sessionId, tasks, autoMode) => {
    await window.api.workshop.createTasks(sessionId, tasks.map((t) => ({ ...t, autoMode })))
    set({ pendingSuggestions: null, suggestionsSessionId: null })
  },

  dismissSuggestions: () => set({ pendingSuggestions: null, suggestionsSessionId: null }),

  toggleAutoMode: () => set((state) => ({ autoMode: !state.autoMode })),

  setupListeners: () => {
    const cleanupStream = window.api.workshop.onStream((event: WorkshopStreamEvent) => {
      const state = get()
      if (event.type === 'text' && event.content) {
        set({ streamingContent: state.streamingContent + event.content })
      } else if (event.type === 'done') {
        const assistantMsg: WorkshopMessage = {
          id: crypto.randomUUID(),
          sessionId: event.sessionId ?? state.currentSessionId ?? '',
          role: 'assistant',
          content: state.streamingContent,
          messageType: 'text',
          metadata: null,
          createdAt: new Date().toISOString()
        }
        set((s) => ({
          messages: [...s.messages, assistantMsg],
          streamingContent: '',
          isStreaming: false
        }))
      } else if (event.type === 'error') {
        set({ isStreaming: false, streamingContent: '' })
      }
    })

    const cleanupToolEvent = window.api.workshop.onToolEvent((event: any) => {
      if (event.type === 'artifact_created' || event.type === 'artifact_updated') {
        get().loadArtifacts()
      } else if (event.type === 'tasks_suggested') {
        set({
          pendingSuggestions: event.tasks,
          suggestionsSessionId: event.sessionId
        })
      }
    })

    return () => {
      cleanupStream()
      cleanupToolEvent()
    }
  }
}))
