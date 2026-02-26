import { create } from 'zustand'
import type {
  WorkshopSession,
  WorkshopMessage,
  WorkshopArtifact,
  WorkshopSuggestedTask,
  WorkshopStreamEvent,
  PanelPersona
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
  currentToolActivity: string | null
  toolActivityLog: string[]
  isStalled: boolean
  pendingSuggestions: WorkshopSuggestedTask[] | null
  suggestionsSessionId: string | null
  autoMode: boolean
  sessionTokens: { input: number; output: number }
  discussRound: number

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
  renameSession: (sessionId: string, title: string) => Promise<void>
  approveSuggestions: (sessionId: string, tasks: WorkshopSuggestedTask[], autoMode?: boolean) => Promise<void>
  dismissSuggestions: () => void
  toggleAutoMode: () => void
  startPanelSession: (dbPath: string, projectPath: string, projectId: string, projectName: string, title: string, panelPersonas: PanelPersona[]) => Promise<void>
  sendPanelMessage: (sessionId: string, content: string) => Promise<void>
  triggerDiscuss: (sessionId: string) => Promise<void>
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
  currentToolActivity: null,
  toolActivityLog: [],
  isStalled: false,
  pendingSuggestions: null,
  suggestionsSessionId: null,
  autoMode: false,
  sessionTokens: { input: 0, output: 0 },
  discussRound: 0,

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

  startPanelSession: async (dbPath, projectPath, projectId, projectName, title, panelPersonas) => {
    const session = await window.api.workshop.startPanelSession(dbPath, projectPath, projectId, projectName, title, panelPersonas)
    set((state) => ({
      sessions: [session, ...state.sessions],
      currentSessionId: session.id,
      currentSession: session,
      messages: [],
      streamingContent: '',
      sessionTokens: { input: 0, output: 0 },
      discussRound: 0
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

    // Recover pending content from interrupted streaming
    let recoveredMessages = messages
    if (session?.pendingContent) {
      recoveredMessages = [
        ...messages,
        {
          id: 'recovered-' + crypto.randomUUID(),
          sessionId,
          role: 'assistant' as const,
          content: session.pendingContent,
          messageType: 'text' as const,
          metadata: null,
          createdAt: new Date().toISOString()
        }
      ]
      // Clear pending content via IPC
      window.api.workshop.recoverSession(sessionId)
    }

    set({
      currentSessionId: sessionId,
      currentSession: session,
      messages: recoveredMessages,
      isStreaming: false,
      sessionTokens: { input: 0, output: 0 },
      discussRound: 0
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
      streamingContent: '',
      currentToolActivity: null,
      toolActivityLog: [],
      isStalled: false
    }))
    await window.api.workshop.sendMessage(sessionId, content)
  },

  sendPanelMessage: async (sessionId, content) => {
    const userMsg: WorkshopMessage = {
      id: crypto.randomUUID(),
      sessionId,
      role: 'user',
      content,
      messageType: 'text',
      metadata: null,
      createdAt: new Date().toISOString(),
      personaId: null,
      personaName: null,
      roundNumber: null
    }
    set((state) => ({
      messages: [...state.messages, userMsg],
      isStreaming: true,
      streamingContent: '',
      discussRound: 0
    }))
    await window.api.workshop.sendPanelMessage(sessionId, content)
  },

  triggerDiscuss: async (sessionId) => {
    set({ isStreaming: true, streamingContent: '' })
    await window.api.workshop.triggerDiscuss(sessionId)
  },

  stopSession: (sessionId) => {
    window.api.workshop.stopSession(sessionId)
    set({ isStreaming: false, streamingContent: '', currentToolActivity: null, toolActivityLog: [], isStalled: false })
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

  renameSession: async (sessionId, title) => {
    set((state) => ({
      sessions: state.sessions.map((s) =>
        s.id === sessionId ? { ...s, title } : s
      ),
      currentSession:
        state.currentSession?.id === sessionId
          ? { ...state.currentSession, title }
          : state.currentSession
    }))
    await window.api.workshop.renameSession(sessionId, title)
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
    let stallTimer: ReturnType<typeof setTimeout> | null = null

    const startStallTimer = (): void => {
      if (stallTimer) clearTimeout(stallTimer)
      stallTimer = setTimeout(() => {
        if (get().isStreaming) {
          set({ isStalled: true })
        }
      }, 60000)
    }

    const resetStallTimer = (): void => {
      set({ isStalled: false })
      startStallTimer()
    }

    const clearStallTimer = (): void => {
      if (stallTimer) clearTimeout(stallTimer)
      stallTimer = null
      set({ isStalled: false })
    }

    // Expose dismissStall so "Keep Waiting" can restart the timer
    const patchedDismissStall = () => {
      set({ isStalled: false })
      startStallTimer()
    }
    ;(useWorkshopStore as any)._dismissStall = patchedDismissStall

    const TOOL_VERBS: Record<string, string> = {
      Read: 'reading files',
      Grep: 'searching code',
      Glob: 'finding files',
      Write: 'writing files',
      Edit: 'editing files',
      Bash: 'running a command',
      WebFetch: 'fetching web content',
      WebSearch: 'searching the web',
      Task: 'delegating work',
      LS: 'listing directory'
    }

    const cleanupStream = window.api.workshop.onStream((event: WorkshopStreamEvent) => {
      const state = get()

      // Reset stall timer on any meaningful event
      if (state.isStreaming && (event.type === 'text' || event.type === 'tool_call')) {
        resetStallTimer()
      }

      if (event.type === 'text' && event.content) {
        set({ streamingContent: state.streamingContent + event.content })
      } else if (event.type === 'tool_call' && event.toolName) {
        const verb = TOOL_VERBS[event.toolName] ?? `using ${event.toolName}`
        set({
          currentToolActivity: verb,
          toolActivityLog: [...state.toolActivityLog, event.toolName]
        })
      } else if ((event as any).type === 'panel_message') {
        const panelMsg: WorkshopMessage = {
          id: crypto.randomUUID(),
          sessionId: event.sessionId || '',
          role: 'assistant',
          content: event.content || '',
          messageType: 'text',
          metadata: null,
          createdAt: new Date().toISOString(),
          personaId: (event as any).personaId || null,
          personaName: (event as any).personaName || null,
          roundNumber: null
        }
        set((state) => ({ messages: [...state.messages, panelMsg] }))
        return
      } else if ((event as any).type === 'token_update') {
        set({ sessionTokens: { input: (event as any).input, output: (event as any).output } })
        return
      } else if (event.type === 'done') {
        clearStallTimer()
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
          isStreaming: false,
          currentToolActivity: null,
          toolActivityLog: [],
          isStalled: false
        }))
      } else if (event.type === 'error') {
        clearStallTimer()
        set({ isStreaming: false, streamingContent: '', currentToolActivity: null, toolActivityLog: [], isStalled: false })
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

    const cleanupRenamed = window.api.workshop.onSessionRenamed((data: { sessionId: string; title: string }) => {
      set((state) => ({
        sessions: state.sessions.map((s) =>
          s.id === data.sessionId ? { ...s, title: data.title } : s
        ),
        currentSession:
          state.currentSession?.id === data.sessionId
            ? { ...state.currentSession, title: data.title }
            : state.currentSession
      }))
    })

    return () => {
      clearStallTimer()
      cleanupStream()
      cleanupToolEvent()
      cleanupRenamed()
    }
  }
}))
