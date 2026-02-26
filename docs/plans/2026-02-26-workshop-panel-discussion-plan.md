# Workshop Panel Discussion Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a "Panel Discussion" session mode to Workshop where 2-4 AI personas discuss the user's topic in a unified timeline, with a cheap role-play R1 and optional user-triggered "Discuss" rounds using parallel SDK calls.

**Architecture:** Hybrid role-play/real-calls. R1 uses a single SDK call where Claude role-plays all personas (cheap). R2 "Discuss" fires separate parallel SDK calls per persona (expensive, user-triggered). Messages are stored with persona metadata in the existing workshop_messages table. The existing 3-panel layout is preserved — only the conversation panel changes.

**Tech Stack:** Electron IPC, Claude Agent SDK (Sonnet), React/Zustand, Tailwind CSS, SQLite (better-sqlite3)

**Design Doc:** `docs/plans/2026-02-26-workshop-panel-discussion-design.md`

---

## Task 1: Add Panel Discussion Types

**Files:**
- Modify: `src/shared/types.ts:157-260`

**Step 1: Add the new types after line 157**

```typescript
// After line 157 (after WorkshopSessionStatus)
export type WorkshopSessionType = 'solo' | 'panel'

export interface PanelPersona {
  id: string
  name: string
  color: string
  systemPrompt: string
  isBuiltIn: boolean
}
```

**Step 2: Add fields to WorkshopSession interface (lines 175-184)**

Add after the `updatedAt` field at line 183:

```typescript
  sessionType: WorkshopSessionType
  panelPersonas: PanelPersona[] | null
```

**Step 3: Add fields to WorkshopMessage interface (lines 186-194)**

Add after the `createdAt` field at line 193:

```typescript
  personaId: string | null
  personaName: string | null
  roundNumber: number | null
```

**Step 4: Add fields to WorkshopStreamEvent interface (lines 252-260)**

Add after the `error` field at line 259:

```typescript
  personaId?: string
  personaName?: string
```

**Step 5: Add new IPC channels to IpcChannel union (lines 298-313)**

Add after the existing workshop channels:

```typescript
  | 'workshop:start-panel-session'
  | 'workshop:send-panel-message'
  | 'workshop:trigger-discuss'
```

**Step 6: Commit**

```
git add src/shared/types.ts
git commit -m "feat(workshop): add panel discussion types and interfaces"
```

---

## Task 2: Add Built-in Personas Module

**Files:**
- Create: `src/shared/panel-personas.ts`

**Step 1: Create the personas file**

```typescript
import { PanelPersona } from './types'

export const BUILT_IN_PERSONAS: PanelPersona[] = [
  {
    id: 'architect',
    name: 'Architect',
    color: 'emerald',
    systemPrompt:
      'You are a Software Architect. Focus on technical feasibility, system design patterns, scalability, performance implications, and integration with existing architecture. Be specific about trade-offs between approaches. When disagreeing, ground your reasoning in concrete technical constraints.',
    isBuiltIn: true
  },
  {
    id: 'product-manager',
    name: 'Product Manager',
    color: 'blue',
    systemPrompt:
      'You are a Product Manager. Focus on user value, scope definition, MVP boundaries, priorities, and business impact. Push back on over-engineering. Ask "does the user actually need this?" Challenge technical complexity that doesn\'t serve the user.',
    isBuiltIn: true
  },
  {
    id: 'qa-engineer',
    name: 'QA Engineer',
    color: 'amber',
    systemPrompt:
      'You are a QA Engineer. Focus on edge cases, failure modes, testability, regression risk, and error handling gaps. Ask "what happens when this fails?" and "how do we test this?" Be specific about scenarios others might miss.',
    isBuiltIn: true
  },
  {
    id: 'security-reviewer',
    name: 'Security Reviewer',
    color: 'rose',
    systemPrompt:
      'You are a Security Reviewer. Focus on attack surface, authentication/authorization gaps, input validation, data exposure, and OWASP top 10 risks. Flag concrete vulnerabilities, not theoretical ones. Suggest specific mitigations.',
    isBuiltIn: true
  },
  {
    id: 'ux-designer',
    name: 'UX Designer',
    color: 'violet',
    systemPrompt:
      'You are a UX Designer. Focus on user experience, accessibility, interaction patterns, cognitive load, and information hierarchy. Challenge designs that are technically elegant but confusing to users. Advocate for simplicity.',
    isBuiltIn: true
  },
  {
    id: 'devils-advocate',
    name: "Devil's Advocate",
    color: 'red',
    systemPrompt:
      'You are the Devil\'s Advocate. Challenge every assumption. Find weaknesses in proposed approaches. Ask uncomfortable questions. Push the group to consider alternatives they\'re ignoring. Be constructively contrarian — don\'t just disagree, offer better alternatives.',
    isBuiltIn: true
  }
]

export const PERSONA_COLORS: Record<string, { dot: string; border: string; bg: string }> = {
  emerald: { dot: 'bg-emerald-400', border: 'border-emerald-500/30', bg: 'bg-emerald-500/10' },
  blue: { dot: 'bg-blue-400', border: 'border-blue-500/30', bg: 'bg-blue-500/10' },
  amber: { dot: 'bg-amber-400', border: 'border-amber-500/30', bg: 'bg-amber-500/10' },
  rose: { dot: 'bg-rose-400', border: 'border-rose-500/30', bg: 'bg-rose-500/10' },
  violet: { dot: 'bg-violet-400', border: 'border-violet-500/30', bg: 'bg-violet-500/10' },
  red: { dot: 'bg-red-400', border: 'border-red-500/30', bg: 'bg-red-500/10' },
  cyan: { dot: 'bg-cyan-400', border: 'border-cyan-500/30', bg: 'bg-cyan-500/10' },
  orange: { dot: 'bg-orange-400', border: 'border-orange-500/30', bg: 'bg-orange-500/10' }
}

export function createCustomPersona(
  name: string,
  description: string,
  color: string
): PanelPersona {
  return {
    id: `custom-${name.toLowerCase().replace(/\s+/g, '-')}-${Date.now()}`,
    name,
    color,
    systemPrompt: `You are ${name}. ${description}. Engage authentically in panel discussions — agree when ideas are strong, push back when you see issues, and always ground your perspective in your area of expertise.`,
    isBuiltIn: false
  }
}
```

**Step 2: Commit**

```
git add src/shared/panel-personas.ts
git commit -m "feat(workshop): add built-in panel personas and color system"
```

---

## Task 3: Update Database Schema for Panel Sessions

**Files:**
- Modify: `src/main/db.ts:135-157` (schema), `286-352` (query functions)

**Step 1: Add columns to workshop_sessions CREATE TABLE (line 135-145)**

Add after the `updated_at` column (before the closing `)`):

```sql
    session_type TEXT NOT NULL DEFAULT 'solo',
    panel_personas TEXT
```

**Step 2: Add columns to workshop_messages CREATE TABLE (lines 147-157)**

Add after the `metadata` column (before the closing `)`):

```sql
    persona_id TEXT,
    persona_name TEXT,
    round_number INTEGER
```

**Step 3: Update createWorkshopSession function (line 286-294)**

Modify to accept and store sessionType and panelPersonas parameters:

```typescript
export function createWorkshopSession(
  dbPath: string,
  projectId: string,
  title?: string,
  sessionType: WorkshopSessionType = 'solo',
  panelPersonas: PanelPersona[] | null = null
): WorkshopSession {
  const db = getProjectDb(dbPath)
  const id = crypto.randomUUID()
  const stmt = db.prepare(`
    INSERT INTO workshop_sessions (id, project_id, title, session_type, panel_personas)
    VALUES (?, ?, ?, ?, ?)
  `)
  stmt.run(
    id, projectId, title || 'New Session', sessionType,
    panelPersonas ? JSON.stringify(panelPersonas) : null
  )
  return getWorkshopSession(dbPath, id)!
}
```

**Step 4: Update getWorkshopSession / listWorkshopSessions to parse panelPersonas JSON**

In any function that reads sessions, parse the panel_personas column:

```typescript
// In the row mapping:
sessionType: row.session_type as WorkshopSessionType,
panelPersonas: row.panel_personas ? JSON.parse(row.panel_personas) : null,
```

**Step 5: Update createWorkshopMessage to accept persona fields (line 337-346)**

```typescript
export function createWorkshopMessage(
  dbPath: string,
  sessionId: string,
  role: WorkshopMessageRole,
  content: string,
  messageType?: WorkshopMessageType,
  metadata?: Record<string, unknown> | null,
  personaId?: string | null,
  personaName?: string | null,
  roundNumber?: number | null
): WorkshopMessage {
  const db = getProjectDb(dbPath)
  const id = crypto.randomUUID()
  const stmt = db.prepare(`
    INSERT INTO workshop_messages
      (id, session_id, role, content, message_type, metadata, persona_id, persona_name, round_number)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  stmt.run(
    id, sessionId, role, content, messageType || 'text',
    metadata ? JSON.stringify(metadata) : null,
    personaId || null, personaName || null, roundNumber || null
  )
  return {
    id, sessionId, role, content,
    messageType: (messageType || 'text') as WorkshopMessageType,
    metadata: metadata || null,
    createdAt: new Date().toISOString(),
    personaId: personaId || null,
    personaName: personaName || null,
    roundNumber: roundNumber || null
  }
}
```

**Step 6: Update listWorkshopMessages to return new fields (line 348-352)**

Map the new columns in the row result:

```typescript
personaId: row.persona_id || null,
personaName: row.persona_name || null,
roundNumber: row.round_number || null,
```

**Step 7: Commit**

```
git add src/main/db.ts
git commit -m "feat(workshop): extend DB schema for panel sessions and persona messages"
```

---

## Task 4: Add Panel Methods to WorkshopEngine

**Files:**
- Modify: `src/main/workshop-engine.ts:32-350`

**Step 1: Add token tracking state to the class (after line 39)**

```typescript
  private tokenUsage = new Map<string, { input: number; output: number }>()
```

**Step 2: Add a helper to accumulate and emit token usage (after constructor)**

```typescript
  private trackTokens(
    sessionId: string,
    usage: { input_tokens?: number; output_tokens?: number } | undefined
  ): void {
    if (!usage) return
    const current = this.tokenUsage.get(sessionId) || { input: 0, output: 0 }
    current.input += usage.input_tokens || 0
    current.output += usage.output_tokens || 0
    this.tokenUsage.set(sessionId, current)
    this.emit('stream', {
      type: 'token_update', sessionId, ...current
    } as any)
  }
```

**Step 3: Call trackTokens in existing sendMessage**

After the SDK runner resolves (after `const result = await this.sdkRunner(...)`, around line 200):

```typescript
    this.trackTokens(sessionId, result.usage)
```

**Step 4: Update startSession to accept panel parameters (line 59-63)**

```typescript
  startSession(
    title?: string,
    sessionType: WorkshopSessionType = 'solo',
    panelPersonas: PanelPersona[] | null = null
  ): WorkshopSession {
    const session = createWorkshopSession(
      this.dbPath, this.projectId, title, sessionType, panelPersonas
    )
    this.emit('session:started', session)
    return session
  }
```

**Step 5: Add sendPanelMessage method (after sendMessage)**

```typescript
  async sendPanelMessage(sessionId: string, content: string): Promise<void> {
    if (!this.sdkRunner) throw new Error('SDK runner not set')

    const session = getWorkshopSession(this.dbPath, sessionId)
    if (!session || session.sessionType !== 'panel' || !session.panelPersonas) {
      throw new Error('Not a panel session')
    }

    // Write user message to DB
    createWorkshopMessage(this.dbPath, sessionId, 'user', content)

    // Build role-play prompt
    const prompt = this.buildPanelPrompt(sessionId, content, session.panelPersonas)
    const resumeSessionId = this.sessionIds.get(sessionId)

    this.emit('stream', { type: 'text', content: '', sessionId })

    try {
      const result = await this.sdkRunner({
        prompt,
        model: 'claude-sonnet-4-20250514',
        maxTurns: 10,
        autoMode: true,
        resumeSessionId,
        sessionKey: sessionId,
        onStream: (event: any) => {
          if (event.type === 'tool_use') {
            this.emit('stream', {
              type: 'tool_call', toolName: event.name, sessionId
            })
          } else {
            this.emit('stream', {
              type: 'text', content: event.text || '', sessionId
            })
          }
        },
        onApprovalRequest: async () => ({ behavior: 'allow' as const })
      })

      if (result.sessionId) this.sessionIds.set(sessionId, result.sessionId)
      this.trackTokens(sessionId, result.usage)

      // Handle tool calls from R1 (artifacts, tasks, etc.)
      await this.handleToolCalls(sessionId, result)

      // Parse persona blocks from output
      const personaMessages = this.parsePanelResponse(
        result.output, session.panelPersonas
      )

      // Write each persona's message to DB and emit individually
      for (const pm of personaMessages) {
        createWorkshopMessage(
          this.dbPath, sessionId, 'assistant', pm.content,
          'text', null, pm.personaId, pm.personaName, 1
        )
        this.emit('stream', {
          type: 'panel_message',
          content: pm.content,
          personaId: pm.personaId,
          personaName: pm.personaName,
          sessionId
        } as any)
      }

      this.emit('stream', { type: 'done', sessionId })
    } catch (err: any) {
      this.emit('stream', { type: 'error', error: err.message, sessionId })
    }
  }
```

**Step 6: Add triggerDiscuss method (after sendPanelMessage)**

```typescript
  async triggerDiscuss(sessionId: string): Promise<void> {
    if (!this.sdkRunner) throw new Error('SDK runner not set')

    const session = getWorkshopSession(this.dbPath, sessionId)
    if (!session || session.sessionType !== 'panel' || !session.panelPersonas) {
      throw new Error('Not a panel session')
    }

    // Determine current round number
    const messages = listWorkshopMessages(this.dbPath, sessionId)
    const maxRound = messages.reduce(
      (max, m) => Math.max(max, m.roundNumber || 0), 0
    )
    const nextRound = maxRound + 1

    if (nextRound > 3) {
      this.emit('stream', {
        type: 'error',
        error: 'Maximum discussion rounds (2) reached',
        sessionId
      })
      return
    }

    this.emit('stream', { type: 'text', content: '', sessionId })

    // Build conversation history for context
    const history = messages.map((m) => {
      const prefix = m.personaName
        ? `[${m.personaName}]`
        : m.role === 'user' ? '[User]' : ''
      return `${prefix} ${m.content}`
    }).join('\n\n')

    // Fire parallel SDK calls for each persona
    const promises = session.panelPersonas.map(async (persona) => {
      const prompt = [
        `You are ${persona.name} in a panel discussion.`,
        '',
        persona.systemPrompt,
        '',
        'Here is the discussion so far:',
        '',
        history,
        '',
        'Respond to the other panelists\' points. Be specific, reference what',
        'they said, agree or disagree with reasoning. Keep your response',
        'focused and concise (2-4 paragraphs max).',
        'Do NOT use any tool calls — this is a pure discussion response.'
      ].join('\n')

      try {
        const result = await this.sdkRunner!({
          prompt,
          model: 'claude-sonnet-4-20250514',
          maxTurns: 1,
          autoMode: true,
          sessionKey: `${sessionId}-discuss-${persona.id}-${nextRound}`,
          onStream: () => {},
          onApprovalRequest: async () => ({ behavior: 'allow' as const })
        })

        this.trackTokens(sessionId, result.usage)
        return {
          personaId: persona.id,
          personaName: persona.name,
          content: result.output || ''
        }
      } catch (err: any) {
        return {
          personaId: persona.id,
          personaName: persona.name,
          content: `[Error: ${err.message}]`
        }
      }
    })

    const responses = await Promise.all(promises)

    for (const resp of responses) {
      createWorkshopMessage(
        this.dbPath, sessionId, 'assistant', resp.content,
        'text', null, resp.personaId, resp.personaName, nextRound
      )
      this.emit('stream', {
        type: 'panel_message',
        content: resp.content,
        personaId: resp.personaId,
        personaName: resp.personaName,
        sessionId
      } as any)
    }

    this.emit('stream', { type: 'done', sessionId })
  }
```

**Step 7: Add buildPanelPrompt helper (after buildPrompt)**

```typescript
  private buildPanelPrompt(
    sessionId: string,
    userMessage: string,
    personas: PanelPersona[]
  ): string {
    const personaInstructions = personas
      .map((p) => `- **${p.name}**: ${p.systemPrompt}`)
      .join('\n')

    const conversationHistory = this.getConversationHistory(sessionId)

    return [
      'You are moderating a panel discussion with these participants:',
      '',
      personaInstructions,
      '',
      'Respond as EACH persona in turn. Wrap each response in XML tags:',
      '',
      '<persona name="PersonaName">',
      'Their response here...',
      '</persona>',
      '',
      'Each persona should:',
      '- Respond from their unique perspective',
      '- Be specific and actionable, not generic',
      '- Keep responses to 2-4 paragraphs each',
      '- Engage authentically based on their role',
      '',
      'You have access to workshop tools (create_artifact, suggest_tasks,',
      'render_diagram, present_choices). Use them when appropriate —',
      'attribute tool use to the persona who would naturally trigger it.',
      '',
      conversationHistory,
      '',
      `**User:** ${userMessage}`
    ].join('\n')
  }
```

**Step 8: Add parsePanelResponse helper**

```typescript
  private parsePanelResponse(
    output: string,
    personas: PanelPersona[]
  ): Array<{ personaId: string; personaName: string; content: string }> {
    const results: Array<{
      personaId: string; personaName: string; content: string
    }> = []

    const regex = /<persona name="([^"]+)">([\s\S]*?)<\/persona>/g
    let match: RegExpExecArray | null

    while ((match = regex.exec(output)) !== null) {
      const name = match[1].trim()
      const content = match[2].trim()
      const persona = personas.find(
        (p) => p.name.toLowerCase() === name.toLowerCase()
      )
      if (persona && content) {
        results.push({
          personaId: persona.id,
          personaName: persona.name,
          content
        })
      }
    }

    // Fallback: if parsing fails, attribute all output to first persona
    if (results.length === 0 && output.trim()) {
      const cleanOutput = output
        .replace(/<tool_call[\s\S]*?<\/tool_call>/g, '')
        .trim()
      if (cleanOutput) {
        results.push({
          personaId: personas[0].id,
          personaName: personas[0].name,
          content: cleanOutput
        })
      }
    }

    return results
  }
```

**Step 9: Add getConversationHistory helper**

```typescript
  private getConversationHistory(sessionId: string): string {
    const messages = listWorkshopMessages(this.dbPath, sessionId)
    if (messages.length === 0) return ''

    const lines = messages.map((m) => {
      if (m.role === 'user') return `**User:** ${m.content}`
      if (m.personaName) return `**${m.personaName}:** ${m.content}`
      return `**Assistant:** ${m.content}`
    })

    return `Previous conversation:\n\n${lines.join('\n\n')}`
  }
```

**Step 10: Commit**

```
git add src/main/workshop-engine.ts
git commit -m "feat(workshop): add panel message, discuss, and token tracking to engine"
```

---

## Task 5: Register Panel IPC Handlers

**Files:**
- Modify: `src/main/index.ts:261-326`
- Modify: `src/preload/index.ts:48-90`

**Step 1: Add IPC handlers in registerWorkshopIpc (after line 325 in index.ts)**

```typescript
  ipcMain.handle(
    'workshop:start-panel-session',
    (_e, dbPath, projectPath, projectId, projectName, title, panelPersonas) => {
      const engine = ensureWorkshopEngine(
        dbPath, projectPath, projectId, projectName
      )
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
```

**Step 2: Add preload API methods (after line 88 in preload/index.ts)**

```typescript
  startPanelSession: (
    dbPath: string, projectPath: string,
    projectId: string, projectName: string,
    title: string, panelPersonas: any[]
  ) => ipcRenderer.invoke(
    'workshop:start-panel-session',
    dbPath, projectPath, projectId, projectName, title, panelPersonas
  ),
  sendPanelMessage: (sessionId: string, content: string) =>
    ipcRenderer.invoke('workshop:send-panel-message', sessionId, content),
  triggerDiscuss: (sessionId: string) =>
    ipcRenderer.invoke('workshop:trigger-discuss', sessionId),
```

**Step 3: Commit**

```
git add src/main/index.ts src/preload/index.ts
git commit -m "feat(workshop): register panel discussion IPC handlers and preload API"
```

---

## Task 6: Update Workshop Store for Panel State

**Files:**
- Modify: `src/renderer/src/stores/workshopStore.ts:10-322`

**Step 1: Add panel state fields to WorkshopState interface (after line 26)**

```typescript
  // Panel discussion state
  sessionTokens: { input: number; output: number }
  discussRound: number
```

**Step 2: Add initial values (in the initial state, after line 60)**

```typescript
  sessionTokens: { input: 0, output: 0 },
  discussRound: 0,
```

**Step 3: Add startPanelSession action (after startSession action)**

```typescript
  startPanelSession: async (
    dbPath: string, projectPath: string,
    projectId: string, projectName: string,
    title: string, panelPersonas: PanelPersona[]
  ) => {
    const session = await window.api.workshop.startPanelSession(
      dbPath, projectPath, projectId, projectName, title, panelPersonas
    )
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
```

**Step 4: Add sendPanelMessage action (after sendMessage action)**

```typescript
  sendPanelMessage: async (sessionId: string, content: string) => {
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
```

**Step 5: Add triggerDiscuss action**

```typescript
  triggerDiscuss: async (sessionId: string) => {
    set({ isStreaming: true, streamingContent: '' })
    await window.api.workshop.triggerDiscuss(sessionId)
  },
```

**Step 6: Update setupListeners to handle panel_message and token_update events**

In the onStream callback (around line 252), add before the 'done' case:

```typescript
  if (event.type === 'panel_message') {
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
  }

  if ((event as any).type === 'token_update') {
    set({
      sessionTokens: {
        input: (event as any).input,
        output: (event as any).output
      }
    })
  }
```

**Step 7: Reset token counter when switching sessions (in selectSession action)**

Add to the selectSession reset:

```typescript
  sessionTokens: { input: 0, output: 0 },
  discussRound: 0,
```

**Step 8: Commit**

```
git add src/renderer/src/stores/workshopStore.ts
git commit -m "feat(workshop): add panel discussion state and actions to store"
```

---

## Task 7: Create PanelSessionModal Component

**Files:**
- Create: `src/renderer/src/components/Workshop/PanelSessionModal.tsx`

**Step 1: Create the modal component**

Build a modal that lets the user:
- Enter an optional session title
- Select 2-4 personas from a grid of built-in personas (each shown as a card with colored dot, name, and prompt preview)
- Add custom personas via an inline form (name + description)
- Confirm with a "Start Panel" button (disabled until 2+ selected)

Use the same styling patterns as the existing `TaskSuggestionModal.tsx`:
- Fixed inset-0 overlay with bg-black/60
- bg-bg-secondary card with border-border
- accent-teal for primary actions
- text-text / text-text-muted color tokens

Import `BUILT_IN_PERSONAS`, `PERSONA_COLORS`, and `createCustomPersona` from `shared/panel-personas`.

Props: `onConfirm(title: string, personas: PanelPersona[])` and `onCancel()`

**Step 2: Commit**

```
git add src/renderer/src/components/Workshop/PanelSessionModal.tsx
git commit -m "feat(workshop): create PanelSessionModal for persona selection"
```

---

## Task 8: Update SessionList with Panel Discussion Button

**Files:**
- Modify: `src/renderer/src/components/Workshop/SessionList.tsx:12-64`

**Step 1: Add state and imports**

```typescript
import { useState } from 'react'
import { PanelPersona } from '../../../../shared/types'
import { PanelSessionModal } from './PanelSessionModal'
```

**Step 2: Add modal state and handler (after line 19)**

```typescript
  const [showPanelModal, setShowPanelModal] = useState(false)

  const handleNewPanelSession = async (
    title: string, personas: PanelPersona[]
  ) => {
    if (!currentProject) return
    setShowPanelModal(false)
    await useWorkshopStore.getState().startPanelSession(
      currentProject.dbPath,
      currentProject.path,
      currentProject.name,
      currentProject.name,
      title,
      personas
    )
  }
```

**Step 3: Add the button after "New Session" (after line 45)**

```tsx
  <button
    onClick={() => setShowPanelModal(true)}
    className="w-full px-3 py-2 rounded-md bg-surface border border-border
      text-text text-sm font-medium hover:border-accent-teal/50 transition-colors"
  >
    Panel Discussion
  </button>

  {showPanelModal && (
    <PanelSessionModal
      onConfirm={handleNewPanelSession}
      onCancel={() => setShowPanelModal(false)}
    />
  )}
```

**Step 4: Add panel indicator to SessionItem**

In the SessionItem component (line 69-190), when `session.sessionType === 'panel'`, show a small group icon or "[Panel]" label next to the title.

**Step 5: Commit**

```
git add src/renderer/src/components/Workshop/SessionList.tsx
git commit -m "feat(workshop): add Panel Discussion button to session list"
```

---

## Task 9: Update MessageBubble for Persona Display

**Files:**
- Modify: `src/renderer/src/components/Workshop/MessageBubble.tsx:1-52`

**Step 1: Import persona colors**

```typescript
import { PERSONA_COLORS } from '../../../../shared/panel-personas'
```

**Step 2: Accept personaColor prop**

```typescript
interface MessageBubbleProps {
  message: WorkshopMessage
  isStreaming?: boolean
  personaColor?: string
}

export function MessageBubble({
  message, isStreaming = false, personaColor
}: MessageBubbleProps) {
```

**Step 3: Add persona-aware styling to the assistant bubble**

Look up colors via `PERSONA_COLORS[personaColor]`. When a persona is present:
- Use the persona's bg/border colors instead of the default surface bg
- Render a header row inside the bubble: colored dot + persona name + optional round number
- Separate the header from content with a subtle border-b

When no persona (solo mode), render exactly as before — no visual changes.

**Step 4: Commit**

```
git add src/renderer/src/components/Workshop/MessageBubble.tsx
git commit -m "feat(workshop): add persona badge and color styling to MessageBubble"
```

---

## Task 10: Update ConversationPanel for Panel Mode

**Files:**
- Modify: `src/renderer/src/components/Workshop/ConversationPanel.tsx:50-131`

**Step 1: Pull panel state from the store**

```typescript
  const {
    currentSession, sessionTokens, triggerDiscuss, sendPanelMessage
  } = useWorkshopStore()
  const isPanelSession = currentSession?.sessionType === 'panel'
  const personas = currentSession?.panelPersonas || []
```

**Step 2: Create a persona color lookup**

```typescript
  const personaColorMap = new Map<string, string>()
  personas.forEach((p) => personaColorMap.set(p.id, p.color))
```

**Step 3: Pass personaColor to MessageBubble (line 50-53)**

```tsx
  {messages.map((msg) => (
    <MessageBubble
      key={msg.id}
      message={msg}
      personaColor={
        msg.personaId
          ? personaColorMap.get(msg.personaId)
          : undefined
      }
    />
  ))}
```

**Step 4: Add "Discuss further" button between messages and input**

Only visible for panel sessions when not streaming:

```tsx
  {isPanelSession && !isStreaming && messages.length > 0 && (
    <div className="flex justify-center py-3">
      <button
        onClick={() => currentSession && triggerDiscuss(currentSession.id)}
        className="px-4 py-1.5 text-xs font-medium text-text-muted
          border border-border rounded-full
          hover:border-accent-teal/50 hover:text-text transition-colors"
      >
        Discuss further
      </button>
    </div>
  )}
```

**Step 5: Route send to panel or solo**

```typescript
  const handleSend = () => {
    if (!currentSessionId || !input.trim() || isStreaming) return
    if (isPanelSession) {
      sendPanelMessage(currentSessionId, input.trim())
    } else {
      sendMessage(currentSessionId, input.trim())
    }
    setInput('')
  }
```

**Step 6: Add panel header bar with persona legend and token counter**

Above the messages area, for panel sessions only:

```tsx
  {isPanelSession && (
    <div className="flex items-center justify-between px-4 py-2
      border-b border-border text-xs text-text-muted">
      <div className="flex items-center gap-3">
        {personas.map((p) => {
          const colors = PERSONA_COLORS[p.color] || PERSONA_COLORS.emerald
          return (
            <span key={p.id} className="flex items-center gap-1.5">
              <span className={`w-2 h-2 rounded-full ${colors.dot}`} />
              {p.name}
            </span>
          )
        })}
      </div>
      <span>
        Tokens: {sessionTokens.input.toLocaleString()} in
        {' / '}
        {sessionTokens.output.toLocaleString()} out
      </span>
    </div>
  )}
```

**Step 7: Commit**

```
git add src/renderer/src/components/Workshop/ConversationPanel.tsx
git commit -m "feat(workshop): add panel rendering, discuss button, and token counter"
```

---

## Task 11: TypeScript Compilation Check

**Files:**
- All modified files

**Step 1: Run TypeScript type check**

```
npx tsc --noEmit
```

Expected: No errors. Fix any type mismatches.

**Step 2: Run the dev build**

```
npm run build
```

Expected: Successful build with no errors.

**Step 3: Fix any issues found and commit**

```
git add -A
git commit -m "fix(workshop): resolve type and integration issues for panel discussion"
```

---

## Task 12: Manual Smoke Test

**Step 1: Start the dev server**

```
npm run dev
```

**Step 2: Test solo session (regression)**

- Create a new solo session, send a message, verify streaming works
- Verify artifacts work, end session, verify summary

**Step 3: Test panel session creation**

- Click "Panel Discussion" button
- Select 2-3 personas from the modal
- Verify minimum 2 requirement enforced
- Create a custom persona
- Start the panel

**Step 4: Test panel conversation**

- Send a message, verify each persona responds with color-coded labels
- Verify token counter updates
- Click "Discuss" button, verify cross-replies appear with round labels
- Verify 2-round cap is enforced

**Step 5: Fix any bugs found and commit**

```
git add -A
git commit -m "fix(workshop): resolve issues found during panel discussion smoke test"
```
