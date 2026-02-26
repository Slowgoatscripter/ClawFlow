# Workshop Panel Discussion Mode

**Date:** 2026-02-26
**Status:** Approved
**Branch:** feature/workshop-panel-discussion

## Overview

A new session type in Workshop where the user converses with a panel of 2-4 AI personas. Round 1 uses a single role-play SDK call (cheap). The user can optionally trigger a "Discuss" round where each agent gets its own SDK call to cross-reply (expensive but authentic). The conversation appears in a unified timeline with color-coded agent labels. A live token counter tracks session cost.

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Trigger | Session-level choice | Solo vs Panel at creation time. Clean separation, no mid-session state transitions |
| Panel composition | Custom (2-4 personas) | User picks from built-in list or creates custom personas |
| Turn flow | Round-robin + optional cross-replies | 2-round cap prevents token runaway |
| Architecture | Hybrid role-play/real calls | R1 is one role-play SDK call (cheap). R2 "Discuss" fires separate parallel SDK calls (user-triggered) |
| Layout | Unified timeline with agent labels | Keeps existing 3-panel layout. Messages color-coded by persona |
| Token tracking | Per-session counter in header | Shows cumulative input + output tokens |
| Tool access | R1 only | Role-play call gets Workshop tools. R2 cross-replies are pure text |

## Session Creation Flow

When clicking "New Session," the user sees a modal with two choices:

- **Solo** — current behavior, unchanged
- **Panel Discussion** — opens a persona picker

The persona picker shows built-in personas (Architect, PM, QA Engineer, Security Reviewer, UX Designer, Devil's Advocate, etc.) and a "Custom" option where the user types a name + description. User selects 2-4, confirms, session starts.

Each persona is stored as:

```typescript
{ id: string, name: string, color: string, systemPrompt: string, isBuiltIn: boolean }
```

Built-in personas ship with curated system prompts. Custom ones get a generic template with the user's description injected.

## Conversation Mechanics

### Round 1 — Role-play (1 SDK call)

The user sends a message. The engine makes a single SDK call with a system prompt that instructs Claude to respond as each persona in turn, using `<persona name="...">` XML tags to separate responses. The engine parses the output into individual messages per persona.

- This call has access to Workshop tools (create_artifact, suggest_tasks, render_diagram)
- Token cost: ~1x a normal solo message

### Round 2 — Discuss (N SDK calls, user-triggered)

After Round 1 completes, a "Discuss" button appears below the last message. If clicked:

- Each agent gets its own SDK call with its persona system prompt + the full conversation history
- Calls run in parallel (each agent sees R1 but not other R2 responses)
- Responses are pure text — no tool calls
- Token cost: ~Nx additional (where N = number of agents)

The user can click "Discuss" multiple times, but the 2-round cap applies (R1 + at most 2 Discuss rounds).

## UI Layout

Keeps the existing 3-panel layout (Sessions | Conversation | Artifacts). Changes only in the conversation panel:

- Message bubbles gain an **agent badge**: colored dot + persona name, left-aligned
- User messages remain right-aligned, unchanged
- System messages (artifact created, etc.) remain centered pills
- During streaming, the "thinking..." indicator shows which persona is being generated
- A **"Discuss" button** appears after each completed round as a subtle action bar
- **Token counter** in the session header bar: `Tokens: 12,450 in / 3,200 out`

```
+----------------------------------------------------------+
| Sessions |  Panel Discussion              | Artifacts     |
|          |                                |               |
| > Sess 1 |  [You]: How should we...      | [Doc v2]      |
|   Sess 2 |                                | [Diagram]     |
|          |  * Architect:                  |               |
|          |  I think we should use...      |               |
|          |                                |               |
|          |  * Advocate:                   |               |
|          |  But consider the edge...      |               |
|          |                                |               |
|          |  [Discuss]                     |               |
|          |                                |               |
|          |  * Architect (re: Advocate):   |               |
|          |  Good point, let me...         |               |
|          |                                |               |
|          |--------------------------------|               |
|          |  [Type your message...]        |               |
+----------------------------------------------------------+
```

## Data Model Changes

### New Types

```typescript
export type WorkshopSessionType = 'solo' | 'panel'

export interface PanelPersona {
  id: string
  name: string
  color: string           // tailwind color key: 'emerald', 'purple', 'amber', 'rose', etc.
  systemPrompt: string
  isBuiltIn: boolean
}
```

### WorkshopSession Changes

```typescript
export interface WorkshopSession {
  // ...existing fields
  sessionType: WorkshopSessionType        // default 'solo'
  panelPersonas: PanelPersona[] | null    // null for solo sessions
}
```

### WorkshopMessage Changes

```typescript
export interface WorkshopMessage {
  // ...existing fields
  personaId: string | null    // null for user/system messages
  personaName: string | null  // denormalized for display
  roundNumber: number | null  // 1 for R1, 2+ for Discuss rounds
}
```

### WorkshopStreamEvent Changes

```typescript
export interface WorkshopStreamEvent {
  // ...existing fields
  personaId?: string
  personaName?: string
}
```

### Database Schema

`workshop_sessions` table gains:
- `session_type TEXT DEFAULT 'solo'`
- `panel_personas TEXT` (JSON string, nullable)

`workshop_messages` table gains:
- `persona_id TEXT`
- `persona_name TEXT`
- `round_number INTEGER`

## Engine Changes

### `WorkshopEngine` New Methods

**`sendPanelMessage(sessionId, content)`:**

1. Write user message to DB
2. Build role-play prompt with all personas' instructions
3. Make one SDK call (Sonnet) with Workshop tools enabled
4. Parse `<persona name="...">` blocks from the response
5. Write each block as a separate WorkshopMessage with personaId and roundNumber: 1
6. Emit stream events per-persona so UI renders them sequentially with labels

**`triggerDiscuss(sessionId, roundNumber)`:**

1. Load conversation history
2. For each persona, in parallel:
   - Build prompt with persona's system prompt + full history
   - Make SDK call (Sonnet, maxTurns: 1, no tools)
   - Write response as WorkshopMessage with roundNumber
3. Emit stream events per-persona

### Token Tracking

The SDK runner returns usage data (input_tokens, output_tokens). The engine:

1. Accumulates tokens per session in memory: `Map<sessionId, { input: number, output: number }>`
2. Emits `stream: { type: 'token_update', input: number, output: number }` after each SDK call
3. The store tracks cumulative tokens; the UI displays them in the header

## IPC Changes

New channels:
- `workshop:trigger-discuss` — triggers a Discuss round for a panel session

Modified channels:
- `workshop:start-session` — gains `sessionType` and `panelPersonas` parameters
- `workshop:stream` — events gain `personaId` and `personaName` fields

## Built-in Personas

| Name | Color | Focus |
|------|-------|-------|
| Architect | emerald | Feasibility, patterns, scalability, technical approach |
| Product Manager | blue | User value, scope, priorities, MVP definition |
| QA Engineer | amber | Edge cases, testability, failure modes, regression risk |
| Security Reviewer | rose | Attack surface, auth, input validation, data exposure |
| UX Designer | violet | User experience, accessibility, interaction patterns |
| Devil's Advocate | red | Challenges assumptions, finds weaknesses, stress-tests ideas |

## What Stays Unchanged

- Solo sessions — completely untouched
- Artifact panel — works the same (R1 can create artifacts)
- Task suggestion modal — works the same (R1 can suggest tasks)
- Session list — shows both types, panel sessions get a small group icon
- Session summaries (Haiku auto-summary on end) — works for both types
