import { create } from 'zustand'
import type {
  WorkshopSession,
  WorkshopMessage,
  WorkshopArtifact,
  WorkshopSuggestedTask,
  WorkshopStreamEvent,
  PanelPersona,
  ToolCallData,
  MessageSegment
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
  streamingSegments: MessageSegment[]
  streamingToolCalls: ToolCallData[]
  isStalled: boolean
  pendingSuggestions: WorkshopSuggestedTask[] | null
  suggestionsSessionId: string | null
  pendingChoices: { question: string; options: { label: string; description: string }[]; sessionId: string } | null
  autoMode: boolean
  sessionTokens: { input: number; output: number }
  discussRound: number
  error: string | null

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
  selectChoice: (label: string) => void
  dismissChoices: () => void
  toggleAutoMode: () => void
  startPanelSession: (dbPath: string, projectPath: string, projectId: string, projectName: string, title: string, panelPersonas: PanelPersona[]) => Promise<void>
  sendPanelMessage: (sessionId: string, content: string) => Promise<void>
  triggerDiscuss: (sessionId: string) => Promise<void>
  setupListeners: () => () => void
  clearError: () => void
}

function groupConsecutiveTools(segments: MessageSegment[]): MessageSegment[] {
  const result: MessageSegment[] = []
  let i = 0
  while (i < segments.length) {
    const seg = segments[i]
    if (seg.type === 'tool_call') {
      const group: ToolCallData[] = [seg.tool]
      while (
        i + 1 < segments.length &&
        segments[i + 1].type === 'tool_call' &&
        (segments[i + 1] as any).tool.toolName === seg.tool.toolName
      ) {
        i++
        group.push((segments[i] as any).tool)
      }
      if (group.length > 1) {
        result.push({ type: 'tool_group', toolName: seg.tool.toolName, tools: group })
      } else {
        result.push(seg)
      }
    } else {
      result.push(seg)
    }
    i++
  }
  return result
}

// Wraps an IPC call: catches errors, surfaces them to the store's error state,
// and returns a safe fallback so callers don't need individual try/catch.
async function safeIpc<T>(
  fn: () => Promise<T>,
  fallback: T,
  errorMsg?: string
): Promise<T> {
  try {
    return await fn()
  } catch (err: any) {
    console.error('[Workshop IPC]', err)
    useWorkshopStore.setState({
      error: errorMsg ?? err?.message ?? 'Something went wrong'
    })
    return fallback
  }
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
  streamingSegments: [],
  streamingToolCalls: [],
  isStalled: false,
  pendingSuggestions: null,
  suggestionsSessionId: null,
  pendingChoices: null,
  autoMode: false,
  sessionTokens: { input: 0, output: 0 },
  discussRound: 0,
  error: null,

  clearError: () => set({ error: null }),

  loadSessions: async (dbPath, projectPath, projectId, projectName) => {
    const sessions = await safeIpc(
      () => window.api.workshop.listSessions(dbPath, projectPath, projectId, projectName),
      [] as any[],
      'Failed to load sessions'
    )
    set({ sessions })
  },

  startSession: async (dbPath, projectPath, projectId, projectName, title?) => {
    const session = await safeIpc(
      () => window.api.workshop.startSession(dbPath, projectPath, projectId, projectName, title),
      null as any,
      'Failed to start session'
    )
    if (!session) return
    set((state) => ({
      sessions: [session, ...state.sessions],
      currentSessionId: session.id,
      currentSession: session,
      messages: []
    }))
  },

  startPanelSession: async (dbPath, projectPath, projectId, projectName, title, panelPersonas) => {
    const session = await safeIpc(
      () => window.api.workshop.startPanelSession(dbPath, projectPath, projectId, projectName, title, panelPersonas),
      null as any,
      'Failed to start panel session'
    )
    if (!session) return
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
    await safeIpc(
      () => window.api.workshop.endSession(sessionId),
      undefined,
      'Failed to end session'
    )
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
    const [session, messages] = await safeIpc(
      () => Promise.all([
        window.api.workshop.getSession(sessionId),
        window.api.workshop.listMessages(dbPath, sessionId)
      ]),
      [null, []] as [any, any[]],
      'Failed to load session'
    )
    if (!session) return

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
      streamingContent: '',
      streamingSegments: [],
      streamingToolCalls: [],
      currentToolActivity: null,
      toolActivityLog: [],
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
      streamingSegments: [],
      streamingToolCalls: [],
      currentToolActivity: null,
      toolActivityLog: [],
      isStalled: false
    }))
    try {
      await window.api.workshop.sendMessage(sessionId, content)
    } catch (err: any) {
      console.error('[Workshop] sendMessage failed:', err)
      set({
        isStreaming: false,
        streamingContent: '',
        currentToolActivity: null,
        toolActivityLog: [],
        isStalled: false,
        error: err?.message ?? 'Failed to send message'
      })
    }
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
      streamingSegments: [],
      streamingToolCalls: [],
      discussRound: 0
    }))
    try {
      await window.api.workshop.sendPanelMessage(sessionId, content)
    } catch (err: any) {
      console.error('[Workshop] sendPanelMessage failed:', err)
      set({
        isStreaming: false,
        streamingContent: '',
        currentToolActivity: null,
        error: err?.message ?? 'Failed to send panel message'
      })
    }
  },

  triggerDiscuss: async (sessionId) => {
    set({ isStreaming: true, streamingContent: '' })
    try {
      await window.api.workshop.triggerDiscuss(sessionId)
    } catch (err: any) {
      console.error('[Workshop] triggerDiscuss failed:', err)
      set({
        isStreaming: false,
        streamingContent: '',
        error: err?.message ?? 'Failed to trigger discussion'
      })
    }
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
    await safeIpc(
      () => window.api.workshop.renameSession(sessionId, title),
      null,
      'Failed to rename session'
    )
  },

  loadArtifacts: async () => {
    const artifacts = await safeIpc(
      () => window.api.workshop.listArtifacts(),
      [] as any[],
      'Failed to load artifacts'
    )
    // Always update — don't preserve stale data when backend returns empty
    set({ artifacts })
  },

  selectArtifact: async (artifactId) => {
    set({ selectedArtifactId: artifactId, artifactLoading: true, artifactContent: null })
    const result = await safeIpc(
      () => window.api.workshop.getArtifact(artifactId),
      { artifact: null, content: null } as { artifact: any; content: string | null },
      'Failed to load artifact'
    )
    set({ artifactContent: result.content ?? null, artifactLoading: false })
  },

  clearArtifactSelection: () => set({ selectedArtifactId: null, artifactContent: null, artifactLoading: false }),

  approveSuggestions: async (sessionId, tasks, autoMode) => {
    await safeIpc(
      () => window.api.workshop.createTasks(sessionId, tasks.map((t) => ({ ...t, autoMode }))),
      undefined,
      'Failed to create tasks'
    )
    set({ pendingSuggestions: null, suggestionsSessionId: null })
  },

  dismissSuggestions: () => set({ pendingSuggestions: null, suggestionsSessionId: null }),

  selectChoice: (label: string) => {
    const { pendingChoices } = get()
    if (!pendingChoices) return
    const sessionId = pendingChoices.sessionId
    set({ pendingChoices: null })
    get().sendMessage(sessionId, label)
  },

  dismissChoices: () => set({ pendingChoices: null }),

  toggleAutoMode: () => set((state) => ({ autoMode: !state.autoMode })),

  setupListeners: () => {
    // Guard: IPC listeners should only be registered once to prevent
    // events being lost during Workshop unmount/remount cycles.
    // The stall timer is re-initialized each time, but IPC stays persistent.
    const store = useWorkshopStore as any
    if (store._ipcListenersActive) {
      // Listeners already live — just return a no-op cleanup
      // (stall timer from previous mount was already cleared by its cleanup)
      return () => {}
    }
    store._ipcListenersActive = true

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

      // Ignore events for sessions other than the one currently viewed
      if (event.sessionId && event.sessionId !== state.currentSessionId) {
        return
      }

      // Reset stall timer on any meaningful event
      if (state.isStreaming && (event.type === 'text' || event.type === 'tool_call')) {
        resetStallTimer()
      }

      if (event.type === 'text' && event.content) {
        const segments = [...state.streamingSegments]
        const last = segments[segments.length - 1]
        if (last && last.type === 'text') {
          segments[segments.length - 1] = { type: 'text', content: last.content + event.content }
        } else {
          segments.push({ type: 'text', content: event.content })
        }
        set({
          streamingContent: state.streamingContent + event.content,
          streamingSegments: segments
        })
      } else if (event.type === 'tool_call' && event.toolName === 'present_choices' && event.toolInput) {
        const input = event.toolInput as { question?: string; options?: { label: string; description: string }[] }
        if (input.question && input.options?.length) {
          set({
            pendingChoices: {
              question: input.question,
              options: input.options,
              sessionId: event.sessionId || state.currentSessionId || ''
            }
          })
        }
      } else if (event.type === 'tool_call' && event.toolName) {
        const verb = TOOL_VERBS[event.toolName] ?? `using ${event.toolName}`
        const toolData: ToolCallData = {
          id: crypto.randomUUID(),
          toolName: event.toolName,
          toolInput: event.toolInput,
          timestamp: new Date().toISOString()
        }
        set({
          currentToolActivity: verb,
          toolActivityLog: [...state.toolActivityLog, event.toolName],
          streamingToolCalls: [...state.streamingToolCalls, toolData],
          streamingSegments: [...state.streamingSegments, { type: 'tool_call', tool: toolData }]
        })
      } else if ((event as any).type === 'thinking') {
        set({
          streamingSegments: [...state.streamingSegments, { type: 'thinking' }]
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
        const groupedSegments = groupConsecutiveTools(state.streamingSegments)
        const assistantMsg: WorkshopMessage = {
          id: crypto.randomUUID(),
          sessionId: state.currentSessionId ?? event.sessionId ?? '',
          role: 'assistant',
          content: state.streamingContent,
          messageType: 'text',
          metadata: {
            segments: groupedSegments,
            toolCalls: state.streamingToolCalls
          },
          createdAt: new Date().toISOString()
        }
        set((s) => ({
          messages: [...s.messages, assistantMsg],
          streamingContent: '',
          streamingSegments: [],
          streamingToolCalls: [],
          isStreaming: false,
          currentToolActivity: null,
          toolActivityLog: [],
          isStalled: false
        }))
      } else if (event.type === 'error') {
        clearStallTimer()
        set({
          isStreaming: false,
          streamingContent: '',
          currentToolActivity: null,
          toolActivityLog: [],
          isStalled: false,
          error: event.error ?? 'An error occurred during streaming'
        })
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
      } else if (event.type === 'task_created') {
        // Task was created directly (e.g. via autoMode) — reload tasks
        // so the dashboard reflects the new task even without a modal
        get().loadArtifacts()
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
      // Only clear the stall timer on unmount — IPC listeners persist
      // across Workshop remounts to prevent event loss during the gap
      clearStallTimer()
    }
  }
}))
