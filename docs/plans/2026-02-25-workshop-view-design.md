# Workshop View — Design Document

**Date:** 2026-02-25
**Status:** Approved
**Scope:** New top-level view in ClawFlow for creative/collaborative work with Claude

---

## Problem

ClawFlow's pipeline is excellent for structured execution (brainstorm → plan → implement → review → verify → done), but it doesn't support the freeform, back-and-forth creative process that happens *before* work enters the pipeline. Users need a space to think collaboratively with Claude — exploring ideas, refining concepts, producing design artifacts — and then seamlessly push actionable tasks into the pipeline when ready.

## Solution

A **Workshop** view — a dedicated creative/collaborative space that lives alongside the existing Dashboard and TaskDetail views. It combines conversation, structured UI interactions, and a visual artifact system to support the full creative process.

---

## Architecture

### View Layout

Three-panel layout within the Workshop view:

| Left Sidebar | Center Panel | Right Panel |
|---|---|---|
| Session list | Conversation stream | Artifact viewer |
| New session button | Chat input + structured UI | Tabs for each artifact |
| Session search/filter | Claude's responses, choices, suggestions | Rendered docs, diagrams, task lists |

- **Left sidebar** — collapsible, lists past sessions with timestamps, preview snippets, and badge counts (tasks spawned, artifacts created/updated). Sessions have auto-generated titles (editable by user).
- **Center panel** — main conversation area. Messages flow top to bottom. Claude's structured interactions (choices, confirmations, artifact previews) render inline as interactive UI components.
- **Right panel** — currently selected artifact rendered visually. Tabs along the top when multiple artifacts exist. Stays in sync with conversation (auto-selects when Claude creates/updates an artifact) but can be browsed independently.

**Auto mode toggle** in the Workshop top bar controls whether task creation requires confirmation.

---

## Conversation & Interaction Model

### Message Types

| Type | Description |
|---|---|
| **User messages** | Plain text, markdown |
| **Claude messages** | Rich rendered text (markdown, code blocks, inline diagrams) |
| **Choice cards** | Multiple options presented as interactive cards |
| **Confirmation prompts** | Task creation batches with approve/edit/reject actions |
| **Artifact previews** | Inline thumbnails linking to full artifact in right panel |
| **System events** | "Claude updated Architecture Spec v3", "2 tasks created in pipeline", "Session resumed" |

### Claude's Workshop Tools

Claude has a set of Workshop-specific tools that let it drive the UI:

| Tool | Purpose |
|---|---|
| `create_artifact` | Creates a new versioned document or diagram |
| `update_artifact` | Updates an existing artifact (new version) |
| `suggest_tasks` | Presents a batch of tasks for confirmation (or auto-creates in auto mode) |
| `present_choices` | Renders a structured choice card in the conversation |
| `render_diagram` | Generates a visual diagram in the artifact panel |

These tools are what make the Workshop feel like active collaboration, not just a chatbot — Claude interacts through the UI itself.

### Context Management

When a session starts, Claude loads:

1. **Project artifacts** — latest versions of all Workshop artifacts
2. **Previous session summaries** — not full transcripts, just key decisions and outcomes
3. **Pipeline state** — current tasks, what's in progress, recent completions

This keeps context lean while maintaining continuity across sessions.

---

## Artifact System

### Artifact Types

| Type | Rendered As | Editable? | File Format |
|---|---|---|---|
| Design Doc | Rich markdown viewer | Yes, inline | `.md` |
| Diagram | Visual graph/flowchart | View + comment | `.mermaid` / `.dot` → rendered SVG |
| Task Breakdown | Interactive checklist | Yes, reorder/edit/check | `.md` with structured frontmatter |
| Spec / Requirements | Structured doc with sections | Yes, inline | `.md` |
| Architecture | Diagram + annotated doc | Diagram view-only, doc editable | `.md` + `.mermaid` |

### Versioning

- Artifacts live in `docs/workshop/` within the project directory
- **Single file per artifact**, versioned through git commits (not file copies)
- Claude commits updates with meaningful messages: `"Update auth-design: added OAuth flow per workshop session 4"`
- UI shows version history with diffs between versions in the artifact panel
- Claude always reads the latest version when pulling context

### Diagram Rendering

Diagrams are rendered using **Mermaid.js**:

- Claude knows Mermaid syntax natively
- Supports flowcharts, sequence diagrams, ER diagrams, architecture diagrams, and more
- Renders client-side in React — lightweight, no external dependencies
- Claude updates the Mermaid source → UI re-renders instantly in the artifact panel
- Users can zoom and pan rendered diagrams

This replaces ASCII art with actual visual diagrams that update live as the conversation evolves.

---

## Task Creation & Pipeline Integration

### Task Creation Triggers

| Trigger | Behavior |
|---|---|
| **User-initiated** | "Let's make that a task" → Claude drafts, user confirms |
| **Claude-suggested** | Claude identifies actionable items → presents batch card with titles, descriptions, suggested complexity tier |
| **Auto mode** | Claude creates tasks automatically → system event appears in conversation |

### Task Payload

Tasks created from the Workshop carry:

- **Description** — written by Claude based on conversation context
- **Linked artifacts** — references to relevant design docs, diagrams, specs (latest version at time of creation)
- **Workshop session ID** — traceability back to the originating conversation
- **Suggested complexity tier** — L1/L2/L3 based on discussed complexity

### Pipeline Entry Point

Workshop-spawned tasks **skip the brainstorming pipeline stage** since that work already happened collaboratively. They enter at:

- **Planning** for L1/L2 tasks
- **Design Review** for L3 tasks

### Pipeline Awareness

The Workshop maintains awareness of the pipeline:

- **Reference existing tasks** — "We already have a task for auth, want to update it?"
- **Flag conflicts** — "This new idea might affect the task currently implementing"
- **Pull in results** — "The code review on task #5 flagged issues — want to discuss them here?"

---

## Session Management

### Session Lifecycle

| Action | Behavior |
|---|---|
| **Start new** | Fresh conversation. Claude loads project context (artifacts, pipeline state, previous session summaries) |
| **Resume** | Picks up where you left off, full conversation history restored |
| **End** | Claude auto-generates a session summary (key decisions, artifacts created/updated, tasks spawned) |

### Session List (Left Sidebar)

Each session displays:

- **Title** — auto-generated by Claude based on discussion topics, editable by user
- **Date/time**
- **Preview snippet** — last message or key topic
- **Badge counts** — tasks spawned, artifacts created/updated

### Cross-Session Context Strategy

| Scope | What Claude Sees |
|---|---|
| **Current session** | Full conversation history |
| **Previous sessions** | Summaries only (not full transcripts) |
| **Artifacts** | Always latest version, regardless of which session created them |
| **On-demand recall** | User can open a past session and Claude can pull specific details from it |

### Session Templates (Nice-to-Have)

Pre-built starting points:

- **Feature brainstorm** — Claude starts with structured discovery questions
- **Architecture review** — Claude loads all current artifacts and asks what needs revisiting
- **Sprint planning** — Claude reviews pipeline state and helps prioritize backlog

---

## Data Model (High Level)

### New Database Tables

```
workshop_sessions
  id              TEXT PRIMARY KEY
  project_id      TEXT NOT NULL (FK → projects)
  title           TEXT
  summary         TEXT
  status          TEXT (active | ended)
  created_at      DATETIME
  updated_at      DATETIME

workshop_messages
  id              TEXT PRIMARY KEY
  session_id      TEXT NOT NULL (FK → workshop_sessions)
  role            TEXT (user | assistant | system)
  content         TEXT
  message_type    TEXT (text | choice | confirmation | artifact_preview | system_event)
  metadata        JSON
  created_at      DATETIME

workshop_artifacts
  id              TEXT PRIMARY KEY
  project_id      TEXT NOT NULL (FK → projects)
  name            TEXT
  type            TEXT (design_doc | diagram | task_breakdown | spec | architecture)
  file_path       TEXT (relative path in docs/workshop/)
  current_version INTEGER
  created_at      DATETIME
  updated_at      DATETIME

workshop_task_links
  id              TEXT PRIMARY KEY
  task_id         TEXT NOT NULL (FK → tasks)
  session_id      TEXT (FK → workshop_sessions)
  artifact_id     TEXT (FK → workshop_artifacts)
  created_at      DATETIME
```

### New Zustand Store

`workshopStore` — manages session state, messages, artifacts, and streaming for the Workshop view. Follows the same patterns as the existing `taskStore` and `pipelineStore`.

---

## Technical Notes

- **Mermaid.js** for diagram rendering — add `mermaid` npm package, render in a React component
- **Claude Agent SDK** sessions for the Workshop conversation — same SDK integration as pipeline, different prompt template and tool set
- **IPC channels** for Workshop follow existing patterns: `workshop:start-session`, `workshop:send-message`, `workshop:create-artifact`, `workshop:suggest-tasks`, etc.
- **Git integration** for artifact versioning — leverage existing project git context

---

## Out of Scope (For Now)

- Multi-user collaboration (real-time co-editing)
- Voice input
- Image/screenshot input as conversation messages
- Export/share Workshop sessions
- Workshop templates marketplace
