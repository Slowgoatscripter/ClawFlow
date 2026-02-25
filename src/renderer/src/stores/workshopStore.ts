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
  approveSuggestions: (sessionId: string, tasks: WorkshopSuggestedTask[]) => Promise<void>
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

  loadArtifacts: async () => {
    const artifacts = await window.api.workshop.listArtifacts()
    set({ artifacts })
  },

  selectArtifact: async (artifactId) => {
    const artifact = await window.api.workshop.getArtifact(artifactId)
    set({ selectedArtifactId: artifactId, artifactContent: artifact.content ?? null })
  },

  clearArtifactSelection: () => set({ selectedArtifactId: null, artifactContent: null }),

  approveSuggestions: async (sessionId, tasks) => {
    await window.api.workshop.createTasks(sessionId, tasks)
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
