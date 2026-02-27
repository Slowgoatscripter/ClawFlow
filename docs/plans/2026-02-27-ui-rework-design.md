# UI Rework: Layout, Canvas & Workshop Chat

**Date:** 2026-02-27
**Status:** Approved
**Depends on:** Workshop Orchestrator (implemented)

## Problem

ClawFlow's UI was built view-by-view as features were added. The result works but feels dated and disjointed:

1. **Views are islands.** Dashboard, Task Detail, Workshop, and Git are full-page swaps with no shared context. Switching between them loses your place.
2. **The Kanban doesn't reflect the new orchestrator model.** 10 status columns with task cards made sense for standalone tasks. With task groups, parallel sub-agents, and workshop-driven execution, the board needs to show relationships and timelines, not just status buckets.
3. **Workshop chat lacks sophistication.** Tool calls are large cards, thinking is a static divider, code blocks are basic markdown, mermaid diagrams can't be zoomed. It doesn't feel like a premium developer tool.
4. **Metrics are empty and misleading.** The 4-card MetricsRow shows data that's rarely populated, and the completion rate formula counts backlog tasks (showing 1% when it should be 95%).
5. **No UI for task groups.** The backend supports group launch/pause/resume/status, work orders, file ownership, and agent messaging — but zero frontend components exist.

## Solution

Replace the view-switching layout with a unified workspace: a persistent nav rail, a pannable canvas that replaces the Kanban, a persistent resizable workshop panel, and a modernized chat experience. Keep the cyberpunk theme — the visual identity is good, the layout and functionality need the rework.

## Design

### App Shell

Three-zone layout that stays consistent across all views:

```
┌──────┬─────────────────────────────────┬───────────────────┐
│ Nav  │         Canvas / View           │  Workshop Panel   │
│ Rail │    (pannable, zoomable)         │  (persistent,     │
│      │                                 │   resizable)      │
│ [◊]  │                                 │                   │
│ [⌥]  │                                 │                   │
│ [⚙]  │                                 │                   │
└──────┴─────────────────────────────────┴───────────────────┘
```

**Nav Rail** (left, ~48px wide):
- Icon-only vertical navigation: Projects, Canvas (dashboard), Git, Settings
- Active view highlighted with accent glow
- Compact — doesn't eat horizontal space

**Canvas Area** (center, flexible):
- Default view: pannable/zoomable task canvas (replaces Kanban)
- Switches to Git view or Settings when those nav items are active
- Takes all remaining horizontal space

**Workshop Panel** (right, resizable):
- Persistent — always visible, never requires a full-page switch
- Default width: ~350px
- Drag left edge to resize (min ~300px, max ~60% of screen)
- Maximize button expands to ~80% width (canvas shrinks to a mini-strip)
- Session switcher dropdown at the top
- Three sub-tabs: Chat, Artifacts, Group

### The Canvas

Replaces the Kanban board and activity feed with a swimlane timeline.

```
Canvas (pannable, zoomable)
═══════════════════════════════════════════════════════════════

  TIME ──────────────────────────────────────────────────────►

  ┌─ Task Group: "Auth System" ─────── [⏸ Pause] [⋮] ──────┐
  │                                                          │
  │  Task: Login API          Task: Auth Middleware           │
  │  (agent-1)                (agent-2)                      │
  │  ┌──────────┐             ┌──────────┐                   │
  │  │implement │             │implement │                   │
  │  │  ████████│             │  ██████░░│                   │
  │  ├──────────┤             └──────────┘                   │
  │  │code_rev  │                                            │
  │  │  ████░░░░│             (in progress...)               │
  │  └──────────┘                                            │
  │                                                          │
  │  · file saved  · test pass  · stage done  · question ▲  │
  │  ─────●────────●───────────●─────────────●──────────►    │
  │                                                          │
  └──────────────────────────────────────────────────────────┘

  ┌─ Standalone: "Fix typo in README" ───────────────────────┐
  │  ┌──────────┐                                            │
  │  │implement │                                            │
  │  │  Done ✓  │                                            │
  │  └──────────┘                                            │
  │  ──●───●───●─────────────────────────────────────────►   │
  └──────────────────────────────────────────────────────────┘

═══════════════════════════════════════════════════════════════
```

**Task Groups** are visual containers — bordered regions that cluster related tasks. Header shows feature name, link to workshop session, and group controls (pause/resume).

**Standalone tasks** get their own smaller container.

**Each task is a vertical lane** within its group. Stages stack as cards top-to-bottom as they complete. Active stage shows a progress bar or shimmer. Agent identity is labeled on each lane.

**Two visual modes based on task type:**

| Type | Stages | Visual |
|------|--------|--------|
| Grouped (from workshop) | implement → code_review → verify → done (4 stages) | Shorter lane, clustered with siblings |
| Standalone L1 | plan → implement → done | Short lane, independent container |
| Standalone L2 | brainstorm → plan → implement → verify → done | Medium lane |
| Standalone L3 | brainstorm → design_review → plan → implement → code_review → verify → done | Tall lane |

**Event timeline** runs horizontally at the bottom of each group/task. Live events (file changes, test results, stage transitions, agent questions) appear as dots. Hover for detail, click to jump. Events are grouped by task/agent so you can tell who did what.

**Canvas interactions:**
- Pan: click-drag on empty space, or scroll horizontally
- Zoom: ctrl+scroll, or pinch on trackpad
- Click task lane: opens task detail overlay
- Click group header: pans workshop panel to that session

**Replaces:** KanbanBoard, KanbanColumn, TaskCard, ActivityFeed, ActivityEntry, MetricsRow (moved to strip above canvas)

### Metrics Strip

Sits between the TopBar and canvas. Compact tiles with sparklines showing trends:

```
┌───────────┬───────────┬───────────┬────────────┬───────────┐
│ Active  3 │ Done  47  │ Rate 94%  │ Avg Time   │ Tokens    │
│ agents    │ tasks ▁▂▄ │      ▃▅▇▇ │ 12m  ▅▃▂▁ │ 842k ▁▃▅▆ │
│ ●●●○○    │ this week │ trending↑ │ per stage  │ this sess │
└───────────┴───────────┴───────────┴────────────┴───────────┘
```

| Metric | Category | Source | Sparkline |
|--------|----------|--------|-----------|
| Active Agents | Pipeline health | Count of running agents/tasks | Dot indicator |
| Tasks Done | Progress | Completed count, 7-day history | Weekly bar chart |
| Completion Rate | Progress | `done / (total - backlog)` — excludes backlog | Trend line |
| Avg Stage Time | Velocity | Mean duration per pipeline stage | Trend line (lower = better) |
| Token Usage | Agent performance | Total tokens this session | Cumulative area |

**Completion rate fix:** Current formula `done / total` includes backlog tasks, producing misleading numbers. New formula excludes backlog — only counts tasks that entered the pipeline.

Each tile is clickable for a detail popover with more context.

Scrolls or collapses on narrow windows.

### Workshop Panel — Chat

The chat is the primary interface for interacting with ClawFlow's intelligence layer. It needs to feel like Cursor or Warp Terminal — sophisticated, clean, and interactive.

#### Message Layout

```
┌─────────────────────────────────────────────────┐
│ Workshop: Auth System Session         [⤢] [⋮]  │
│ ┌──────┬──────────┬────────┐                    │
│ │ Chat │ Artifacts│ Group  │                    │
│ └──────┴──────────┴────────┘                    │
├─────────────────────────────────────────────────┤
│                                                 │
│  You                                   10:32 AM │
│  ┌─────────────────────────────────────────┐   │
│  │ I need a JWT auth system with refresh   │   │
│  │ tokens and role-based access.           │   │
│  └─────────────────────────────────────────┘   │
│                                                 │
│  ClawFlow                              10:32 AM │
│  ┌ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┐   │
│  │ ⚡ Thought for 12s                  [▾] │   │
│  └ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┘   │
│                                                 │
│  Here's how I'd structure the auth system:     │
│                                                 │
│  ┌──── typescript ──────────────────── [⎘] ─┐  │
│  │ interface AuthTokens {                    │  │
│  │   accessToken: string                     │  │
│  │   refreshToken: string                    │  │
│  │ }                                         │  │
│  └───────────────────────────────────────────┘  │
│                                                 │
│  [📄 Read: auth.ts] [🔍 Searched: "jwt"]       │
│                                                 │
│  ┌────────────────────────────────────────┐    │
│  │ 📋 3 tasks proposed — Review           │    │
│  └────────────────────────────────────────┘    │
│                                                 │
├─────────────────────────────────────────────────┤
│ ┌─────────────────────────────────────────────┐│
│ │ Message ClawFlow...                    [⏎] ││
│ └─────────────────────────────────────────────┘│
└─────────────────────────────────────────────────┘
```

#### Message Bubbles

- **User messages:** slightly elevated surface background, right-aligned timestamp
- **Agent messages:** no bubble background (text on panel bg), cleaner visual flow
- **Timestamps:** muted text, shown on hover or at time intervals (not every message)
- Clear visual hierarchy — user input stands out, agent responses flow naturally

#### Thinking Indicator

- **While active:** shimmer animation with "Thinking..." text, subtle cyan glow pulse
- **After completion:** collapses to a pill — `⚡ Thought for 12s [▾]`
- **Click to expand:** full reasoning in a muted, indented block
- Streaming shimmer uses accent-cyan to match the cyberpunk theme

#### Tool Call Chips

Compact, pill-shaped, inline at the end of message blocks:

- Format: `[icon: action summary]` — e.g., `[📄 Read: auth.ts]` `[✅ Tests: 4 passed]`
- Click to expand: shows full output in a collapsible panel below the chip
- Grouped when many: `[6 actions ▾]` expands to show all chips
- Muted color (secondary text) — don't compete with message content

**Replaces:** ToolCallCard, ToolCallGroup (large always-visible cards)

#### Code Blocks

- Language label top-right (e.g., `typescript`)
- Copy button top-right (appears on hover)
- Syntax highlighting using the cyberpunk palette (cyan keywords, green strings, magenta types)
- Slightly elevated background, rounded corners, subtle border
- Horizontal scroll for long lines (no wrapping)

#### Streaming

- Token-by-token streaming with cursor-blink animation
- Smart auto-scroll: follows new content unless user has scrolled up to read
- Tool chips animate in with a subtle fade when streaming completes

#### Message Input

- Single line default, auto-expands up to ~5 lines as you type
- `Enter` sends, `Shift+Enter` for newline
- Subtle border with accent-cyan glow on focus
- Send button on the right
- Architecture supports `/` command prefix for future slash commands
- Contextual placeholder: "Message ClawFlow..." or "Respond to agent question..." when intervention is pending

**Replaces:** ThinkingDivider (static line), current basic MessageBubble

### Workshop Panel — Artifacts Tab

Design docs, mermaid diagrams, code snippets the agent produces. Key improvements:

- **Mermaid diagrams are zoomable and pannable** — rendered to a mini-canvas with mouse/touch zoom, not a static image
- **Code blocks** have syntax highlighting + copy button
- **Design docs** render full markdown with collapsible sections
- Artifacts list with thumbnails/previews for quick navigation

### Workshop Panel — Group Tab

Appears when the active session has a task group. Quick status overview and controls:

```
┌─────────────────────────────────────────┐
│ Group: Auth System              running │
│                                         │
│ ┌─────────────────────────────────────┐ │
│ │ Task: Login API        agent-1      │ │
│ │ Stage: code_review     ██████░░ 75% │ │
│ │ Context: ████░░░░ 52%  (67k/128k)  │ │
│ │ [Message Agent] [Peek Output]       │ │
│ ├─────────────────────────────────────┤ │
│ │ Task: Auth Middleware  agent-2      │ │
│ │ Stage: implement       ████░░░░ 50% │ │
│ │ Context: ██░░░░░░ 24%  (31k/128k)  │ │
│ │ [Message Agent] [Peek Output]       │ │
│ ├─────────────────────────────────────┤ │
│ │ Task: Token Refresh    agent-3      │ │
│ │ Stage: implement       ██░░░░░░ 30% │ │
│ │ Context: █░░░░░░░ 12%  (15k/128k)  │ │
│ │ [Message Agent] [Peek Output]       │ │
│ └─────────────────────────────────────┘ │
│                                         │
│ [Pause Group] [View on Canvas]          │
└─────────────────────────────────────────┘
```

Per task:
- Current stage + progress bar
- **Context window usage** — visual bar showing tokens consumed vs max (green < 50%, amber 50-80%, red > 80%)
- Agent identity
- **Message Agent** button — opens inline input to send instruction to the sub-agent (uses `message_agent` tool)
- **Peek Output** button — shows recent agent output in a popover (uses `peek_agent`)
- Click task name to pan canvas to that task

Group-level controls:
- Pause/Resume group
- View on Canvas (pans canvas to the group cluster)

Data source: `window.api.pipeline.getGroupStatus(groupId)` + `pipeline:status` events for real-time updates.

### Task Suggestion — Floating Review Panel

When the workshop agent proposes tasks, they don't block the conversation. Instead:

1. A chip appears inline in chat: `[📋 3 tasks proposed — Review]`
2. Clicking opens a **floating panel** (not a modal — no backdrop, doesn't block chat)
3. Panel shows each proposed task with:
   - Task name and objective
   - File assignments (paths + create/modify action)
   - Assigned skill
   - File conflict warnings (if two tasks share a file)
4. Actions: **Launch Group**, **Edit Tasks**, **Queue** (for later)
5. Close with `✕` — chip stays in chat, reopen anytime
6. If the agent revises tasks later, a new chip appears with the updated proposal
7. Multiple proposals can coexist

```
┌──────────────────────────────────┐
│ Task Proposals                [✕]│
├──────────────────────────────────┤
│ Group: Auth System               │
│                                  │
│ 1. Login API endpoint            │
│    Objective: Implement JWT...   │
│    Files:                        │
│      src/auth/login.ts (create)  │
│      src/auth/types.ts (modify)  │
│    Skill: test-driven-development│
│                                  │
│ 2. Auth middleware               │
│    Objective: Express middleware  │
│    Files:                        │
│      src/middleware/auth.ts (new) │
│    Skill: test-driven-development│
│                                  │
│ 3. Token refresh endpoint        │
│    Objective: Refresh token...   │
│    Files:                        │
│      src/auth/refresh.ts (new)   │
│    Skill: test-driven-development│
│                                  │
│ ✅ No file conflicts detected    │
│                                  │
│ [Launch Group] [Edit] [Queue]    │
└──────────────────────────────────┘
```

### Task Detail — Slide-Over Overlay

Clicking a task on the canvas opens a slide-over panel from the right (over or alongside the workshop panel):

```
┌──────────────────────────────────────────┐
│ ← Close          Task: Login API    [⋮] │
├──────────────────────────────────────────┤
│ Status: code_review   Agent: agent-1     │
│ Context: ████████░░░░ 67% (86k/128k)    │
│ Group: Auth System    Priority: High     │
├──────────────────────────────────────────┤
│ Work Order                               │
│ ┌──────────────────────────────────────┐ │
│ │ Objective: Implement JWT login...    │ │
│ │ Files: src/auth/login.ts (create)    │ │
│ │        src/auth/types.ts (modify)    │ │
│ │ Patterns: Express middleware...      │ │
│ │ Tests: Unit tests for token gen...   │ │
│ └──────────────────────────────────────┘ │
├──────────────────────────────────────────┤
│ [Pause] [Message Agent] [Restart] [⟳]   │
├──────────────────────────────────────────┤
│ Intervention (if pending)                │
│ ┌──────────────────────────────────────┐ │
│ │ Agent asks: "Should I use bcrypt or  │ │
│ │ argon2 for password hashing?"        │ │
│ │ [Respond]                            │ │
│ └──────────────────────────────────────┘ │
├──────────────────────────────────────────┤
│ ┌────────┬──────────┬──────────┐        │
│ │implement│code_rev  │verify    │        │
│ └────────┴──────────┴──────────┘        │
│ [Live output stream / stage output]      │
├──────────────────────────────────────────┤
│ Agent Log (collapsible)                  │
│  10:32 — Started implement stage         │
│  10:33 — Created auth/login.ts           │
│  10:35 — Tests passing (4/4)             │
└──────────────────────────────────────────┘
```

Key elements:
- **Context window visual** — progress bar with color coding (green/amber/red)
- **Work order display** — structured view of the implementation instructions (grouped tasks only)
- **Stage tabs** — switch between stage outputs
- **Intervention panel** — surfaces agent questions, approval gates
- **Agent log** — collapsible timeline of actions

For standalone tasks, the work order section is replaced with the task description.

### Git View

Replaces the current full-page Git view with a modernized two-panel layout that uses the same app shell:

```
┌──────┬──────────────────────────────────────────────────┐
│ Nav  │ Git                                              │
│ Rail │ ┌────────────────────┬───────────────────────────┤
│      │ │ Branches           │ Branch: feature/auth      │
│ [◊]  │ │                    │                           │
│ [⌥]← │ │ ● master           │ Diff Viewer               │
│ [⚙]  │ │   feature/auth ←   │ (syntax highlighted)      │
│      │ │   fix/typo          │                           │
│      │ │                    │ src/auth/login.ts          │
│      │ │ Linked Tasks:      │ + import jwt from 'jwt'   │
│      │ │  Auth System (3)   │ + export async function    │
│      │ │                    │                           │
│      │ │                    │ Commit History:            │
│      │ │                    │ ● abc123 - Add login       │
│      │ │                    │ ● def456 - Add tests       │
│      │ └────────────────────┴───────────────────────────┤
│      │ Status: 3 modified, 1 untracked   [Commit] [Push]│
└──────┴──────────────────────────────────────────────────┘
```

Improvements:
- **Syntax-highlighted diff viewer** (not raw text)
- **Linked tasks** — shows which tasks/groups are associated with each branch (worktree connections)
- **Inline actions** — commit and push buttons in the status bar
- **Cleaner two-panel layout** — branches left, details right
- Workshop panel can stay open or collapse when in Git view

### Project Selector

Entry view with refreshed cards:

```
┌─────────────────────────────────────────────┐
│                                             │
│              C L A W F L O W                │
│           ─── autonomous dev ───            │
│                                             │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐    │
│  │ Project │  │ Project │  │   +     │    │
│  │ Alpha   │  │ Beta    │  │  New    │    │
│  │ 3 tasks │  │ 1 task  │  │ Project │    │
│  │ ████░░  │  │ █░░░░░  │  │         │    │
│  └─────────┘  └─────────┘  └─────────┘    │
│                                             │
└─────────────────────────────────────────────┘
```

Cards include: project name, active task count, progress bar, last activity timestamp.

## Component Mapping

### New Components

| Component | Purpose |
|-----------|---------|
| `NavRail` | Icon-only left sidebar navigation |
| `AppShell` | Three-zone layout container (rail + canvas + workshop panel) |
| `Canvas` | Pannable/zoomable workspace with task lanes |
| `CanvasGroup` | Visual container for a task group on the canvas |
| `CanvasTaskLane` | Vertical lane for a single task with stacking stage cards |
| `CanvasStageCard` | Individual stage card within a task lane |
| `CanvasTimeline` | Horizontal event timeline at the bottom of groups/tasks |
| `MetricsStrip` | Compact metrics bar with sparklines |
| `MetricTile` | Individual metric with sparkline chart |
| `WorkshopPanel` | Persistent right panel with tab system |
| `ChatMessage` | Differentiated user/agent message rendering |
| `ThinkingPill` | Shimmer → collapsible thinking indicator |
| `ToolCallChip` | Compact inline pill for tool call display |
| `CodeBlock` | Syntax-highlighted code with language label + copy |
| `ArtifactViewer` | Zoomable/pannable artifact display (mermaid, code, docs) |
| `GroupStatusPanel` | Per-task status cards with context window + agent controls |
| `TaskProposalPanel` | Floating non-blocking panel for reviewing proposed tasks |
| `TaskDetailOverlay` | Slide-over panel with full task detail |
| `DiffViewer` | Syntax-highlighted git diff display |

### Replaced Components

| Old | New Replacement |
|-----|-----------------|
| `KanbanBoard` | `Canvas` |
| `KanbanColumn` | `CanvasGroup` + `CanvasTaskLane` |
| `TaskCard` | `CanvasStageCard` (stages are the cards now) |
| `ActivityFeed` | `CanvasTimeline` (integrated into canvas) |
| `ActivityEntry` | Timeline event dots |
| `MetricsRow` | `MetricsStrip` |
| `ToolCallCard` | `ToolCallChip` |
| `ToolCallGroup` | Chip grouping (`[6 actions ▾]`) |
| `ThinkingDivider` | `ThinkingPill` |
| `MessageBubble` | `ChatMessage` (differentiated styling) |
| `MermaidDiagram` | `ArtifactViewer` (zoomable) |
| `Dashboard` | `AppShell` + `Canvas` + `MetricsStrip` |

### Kept (Modified)

| Component | Changes |
|-----------|---------|
| `TitleBar` | Simplified — nav moves to rail |
| `TopBar` | Becomes thinner, breadcrumb-style |
| `TaskDetail` | Refactored into `TaskDetailOverlay` (slide-over instead of full page) |
| `StageTabs` | Moved into task detail overlay |
| `InterventionPanel` | Moved into task detail overlay |
| `AgentLog` | Moved into task detail overlay (collapsible) |
| `Workshop` | Replaced by `WorkshopPanel` (persistent, not a full view) |
| `SessionList` | Becomes a dropdown in workshop panel header |
| `ConversationPanel` | Rebuilt as Chat tab with new message components |
| `ArtifactPanel` | Rebuilt as Artifacts tab with zoom support |
| `Git` | Restyled with syntax-highlighted diff viewer |
| `BranchList` | Kept, adds linked task display |
| `ProjectSelector` | Refreshed card design |
| `SettingsModal` | Kept as-is |

## Data Requirements

### New Store: `canvasStore.ts`

```typescript
interface CanvasState {
  // Viewport
  panX: number
  panY: number
  zoom: number

  // Task groups (fetched from backend)
  groups: TaskGroup[]
  groupTasks: Record<number, Task[]>  // groupId -> tasks

  // Standalone tasks
  standaloneTasks: Task[]

  // Timeline events
  timelineEvents: Record<number, TimelineEvent[]>  // taskId -> events

  // Actions
  panTo: (x: number, y: number) => void
  zoomTo: (level: number) => void
  focusTask: (taskId: number) => void
  focusGroup: (groupId: number) => void
  refreshGroups: () => Promise<void>
}
```

### New Store: `metricsStore.ts`

```typescript
interface MetricsState {
  activeAgents: number
  tasksDone: number
  tasksDoneHistory: number[]       // 7-day history for sparkline
  completionRate: number           // done / (total - backlog)
  completionRateHistory: number[]  // trend data
  avgStageTime: number             // seconds
  avgStageTimeHistory: number[]    // trend data
  tokenUsage: number               // total tokens this session
  tokenUsageHistory: number[]      // cumulative over time
  refresh: () => Promise<void>
}
```

### Modified: `pipelineStore.ts`

Add group event handling:
- Listen for `group-launched`, `group-paused`, `group-resumed`, `group-completed`, `group-task-stage-complete` events
- Forward to canvasStore for real-time canvas updates

### Backend: Fix `getProjectStats()`

Change completion rate formula:
```
// Before (broken)
completionRate = done / total

// After (correct)
const started = total - backlog
completionRate = started > 0 ? done / started : 0
```

Add new stats: active agent count, stage time tracking, token usage aggregation.

## What Changes vs. What Stays

### Changes

| Area | Change |
|------|--------|
| App shell | View-switching → three-zone persistent layout |
| Dashboard | Kanban board → pannable canvas with swimlane timeline |
| Activity feed | Sidebar list → integrated canvas timeline |
| Metrics | 4 static cards → 5-tile strip with sparklines, fixed formula |
| Workshop | Full-page view → persistent resizable right panel |
| Workshop chat | Basic bubbles → sophisticated message components (chips, thinking pills, code blocks) |
| Artifacts | Static display → zoomable/pannable viewer |
| Task detail | Full-page view → slide-over overlay |
| Task suggestions | Inline cards → floating non-blocking panel |
| Git | Separate view → modernized two-panel in app shell |
| Project selector | Basic grid → refreshed cards with progress |

### Stays the Same

| Area | Why |
|------|-----|
| Cyberpunk theme | Colors, fonts, animations, accents — visual identity is good |
| Zustand stores | Architecture pattern works, just add new stores |
| IPC communication | All wiring is correct and complete |
| Pipeline engine | Fully implemented, no changes needed |
| Workshop engine | Fully implemented with orchestration tools |
| Settings modal | Works fine as-is |
| Error handling | ErrorBoundary, Toast, ApprovalDialog stay |
| Electron shell | TitleBar and window management unchanged |
