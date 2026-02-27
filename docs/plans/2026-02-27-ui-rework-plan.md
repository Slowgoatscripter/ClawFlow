# UI Rework Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace ClawFlow's view-switching layout with a unified workspace: nav rail + pannable canvas + persistent workshop panel, with modernized chat and new metrics.

**Architecture:** Three-zone app shell (NavRail | Canvas | WorkshopPanel) replaces view-switching in App.tsx. Canvas replaces KanbanBoard with swimlane timelines. Workshop becomes a persistent resizable right panel instead of a full-page view. Task detail becomes a slide-over overlay. New stores (canvasStore, metricsStore) manage the new UI state.

**Tech Stack:** React 19, Zustand 5, Tailwind CSS 4, Electron 40, Lucide React icons, Mermaid 11, react-markdown 10

---

## Phase 1: Foundation

### Task 1: Fix completion rate formula in getProjectStats

**Files:**
- Modify: `src/main/db.ts` (getProjectStats function, ~line 350-368)

**Step 1: Fix the completion rate calculation**

In `src/main/db.ts`, find the `getProjectStats` function. Change:

```typescript
const completionRate = total > 0 ? done / total : 0
```

To:

```typescript
const started = total - backlog
const completionRate = started > 0 ? done / started : 0
```

This excludes backlog tasks from the denominator so the rate reflects tasks that actually entered the pipeline.

**Step 2: Build to verify no type errors**

Run: `npm run build`
Expected: Clean build, no errors.

**Step 3: Commit**

```bash
git add src/main/db.ts
git commit -m "fix: exclude backlog from completion rate denominator"
```

---

### Task 2: Update layoutStore for new app shell

**Files:**
- Modify: `src/renderer/src/stores/layoutStore.ts`

**Step 1: Read the current layoutStore**

Current state has: `view`, `activityFeedOpen`, `archiveDrawerOpen`, `setView`, `toggleActivityFeed`, `toggleArchiveDrawer`.

**Step 2: Update the store**

Replace the entire store contents with:

```typescript
import { create } from 'zustand'

type View = 'projects' | 'dashboard' | 'git' | 'settings'

interface LayoutState {
  view: View
  workshopPanelWidth: number
  workshopPanelCollapsed: boolean
  workshopPanelMaximized: boolean
  archiveDrawerOpen: boolean
  taskDetailOverlayId: number | null

  setView: (v: View) => void
  setWorkshopWidth: (width: number) => void
  toggleWorkshopPanel: () => void
  setWorkshopMaximized: (max: boolean) => void
  toggleArchiveDrawer: () => void
  openTaskDetail: (taskId: number) => void
  closeTaskDetail: () => void
}

export const useLayoutStore = create<LayoutState>((set) => ({
  view: 'projects',
  workshopPanelWidth: 350,
  workshopPanelCollapsed: false,
  workshopPanelMaximized: false,
  archiveDrawerOpen: false,
  taskDetailOverlayId: null,

  setView: (view) => set({ view }),
  setWorkshopWidth: (width) => set({ workshopPanelWidth: Math.max(300, Math.min(800, width)) }),
  toggleWorkshopPanel: () => set((s) => ({ workshopPanelCollapsed: !s.workshopPanelCollapsed })),
  setWorkshopMaximized: (max) => set({ workshopPanelMaximized: max }),
  toggleArchiveDrawer: () => set((s) => ({ archiveDrawerOpen: !s.archiveDrawerOpen })),
  openTaskDetail: (taskId) => set({ taskDetailOverlayId: taskId }),
  closeTaskDetail: () => set({ taskDetailOverlayId: null }),
}))
```

Note: `activityFeedOpen` is removed (activity feed replaced by canvas timeline). `view` no longer includes `'task-detail'` or `'workshop'` -- those are now overlays/panels. `taskDetailOverlayId` controls the slide-over overlay.

**Step 3: Fix all references to removed state**

Search the codebase for `activityFeedOpen`, `toggleActivityFeed`, `view === 'task-detail'`, and `view === 'workshop'`. Update each reference:
- `activityFeedOpen` / `toggleActivityFeed` -- remove (activity feed replaced by canvas timeline)
- `setView('task-detail')` -- replace with `openTaskDetail(taskId)`
- `setView('workshop')` -- replace with `setView('dashboard')` (workshop is now always visible as a panel)

Key files to update: `App.tsx`, `TopBar.tsx`, `Dashboard.tsx`, `TaskCard.tsx` (any component that navigates to task-detail or workshop views).

**Step 4: Build to verify**

Run: `npm run build`
Expected: Clean build. Some components may have temporary type errors if they reference removed fields -- fix them by commenting out or stubbing.

**Step 5: Commit**

```bash
git add src/renderer/src/stores/layoutStore.ts
git add -A
git commit -m "refactor: update layoutStore for three-zone app shell"
```

---

### Task 3: Create metricsStore

**Files:**
- Create: `src/renderer/src/stores/metricsStore.ts`

**Step 1: Create the store**

```typescript
import { create } from 'zustand'

interface MetricsState {
  activeAgents: number
  tasksDone: number
  tasksDoneHistory: number[]
  completionRate: number
  completionRateHistory: number[]
  avgStageTime: number
  avgStageTimeHistory: number[]
  tokenUsage: number
  tokenUsageHistory: number[]

  refresh: (dbPath: string) => Promise<void>
  recordTokenUsage: (tokens: number) => void
}

export const useMetricsStore = create<MetricsState>((set, get) => ({
  activeAgents: 0,
  tasksDone: 0,
  tasksDoneHistory: [],
  completionRate: 0,
  completionRateHistory: [],
  avgStageTime: 0,
  avgStageTimeHistory: [],
  tokenUsage: 0,
  tokenUsageHistory: [],

  refresh: async (dbPath: string) => {
    const stats = await window.api.tasks.stats(dbPath)
    const prev = get()
    set({
      activeAgents: stats.inProgress,
      tasksDone: stats.done,
      tasksDoneHistory: [...prev.tasksDoneHistory.slice(-6), stats.done],
      completionRate: Math.round(stats.completionRate * 100),
      completionRateHistory: [...prev.completionRateHistory.slice(-6), Math.round(stats.completionRate * 100)],
    })
  },

  recordTokenUsage: (tokens: number) => {
    const prev = get()
    const total = prev.tokenUsage + tokens
    set({
      tokenUsage: total,
      tokenUsageHistory: [...prev.tokenUsageHistory.slice(-19), total],
    })
  },
}))
```

**Step 2: Build to verify**

Run: `npm run build`
Expected: Clean build.

**Step 3: Commit**

```bash
git add src/renderer/src/stores/metricsStore.ts
git commit -m "feat: add metricsStore with sparkline history tracking"
```

---

### Task 4: Create canvasStore

**Files:**
- Create: `src/renderer/src/stores/canvasStore.ts`

**Step 1: Create the store**

```typescript
import { create } from 'zustand'
import type { Task, TaskGroup } from '../../../shared/types'

interface TimelineEvent {
  id: string
  taskId: number
  type: 'stage-complete' | 'file-change' | 'test-result' | 'agent-question' | 'error'
  summary: string
  timestamp: string
  agentId?: string
}

interface CanvasState {
  panX: number
  panY: number
  zoom: number

  groups: TaskGroup[]
  groupTasks: Record<number, Task[]>
  standaloneTasks: Task[]
  timelineEvents: Record<number, TimelineEvent[]>

  selectedGroupId: number | null
  selectedTaskId: number | null

  panTo: (x: number, y: number) => void
  zoomTo: (level: number) => void
  focusGroup: (groupId: number) => void
  focusTask: (taskId: number) => void
  clearSelection: () => void

  setGroups: (groups: TaskGroup[]) => void
  setGroupTasks: (groupId: number, tasks: Task[]) => void
  setStandaloneTasks: (tasks: Task[]) => void
  addTimelineEvent: (taskId: number, event: TimelineEvent) => void

  refreshAll: (dbPath: string) => Promise<void>
}

export const useCanvasStore = create<CanvasState>((set, get) => ({
  panX: 0,
  panY: 0,
  zoom: 1,

  groups: [],
  groupTasks: {},
  standaloneTasks: [],
  timelineEvents: {},

  selectedGroupId: null,
  selectedTaskId: null,

  panTo: (x, y) => set({ panX: x, panY: y }),
  zoomTo: (level) => set({ zoom: Math.max(0.3, Math.min(3, level)) }),
  focusGroup: (groupId) => set({ selectedGroupId: groupId, selectedTaskId: null }),
  focusTask: (taskId) => set({ selectedTaskId: taskId }),
  clearSelection: () => set({ selectedGroupId: null, selectedTaskId: null }),

  setGroups: (groups) => set({ groups }),
  setGroupTasks: (groupId, tasks) =>
    set((s) => ({ groupTasks: { ...s.groupTasks, [groupId]: tasks } })),
  setStandaloneTasks: (tasks) => set({ standaloneTasks: tasks }),
  addTimelineEvent: (taskId, event) =>
    set((s) => ({
      timelineEvents: {
        ...s.timelineEvents,
        [taskId]: [...(s.timelineEvents[taskId] || []), event],
      },
    })),

  refreshAll: async (dbPath: string) => {
    const tasks = await window.api.tasks.list(dbPath)
    const standalone = tasks.filter((t: Task) => !t.groupId)
    const grouped = tasks.filter((t: Task) => t.groupId)

    const groupMap: Record<number, Task[]> = {}
    for (const t of grouped) {
      if (!groupMap[t.groupId!]) groupMap[t.groupId!] = []
      groupMap[t.groupId!].push(t)
    }

    set({ standaloneTasks: standalone, groupTasks: groupMap })
  },
}))
```

**Step 2: Build to verify**

Run: `npm run build`
Expected: Clean build.

**Step 3: Commit**

```bash
git add src/renderer/src/stores/canvasStore.ts
git commit -m "feat: add canvasStore for canvas viewport and task group state"
```

---

## Phase 2: App Shell and Navigation

### Task 5: Create NavRail component

**Files:**
- Create: `src/renderer/src/components/NavRail.tsx`

**Step 1: Create NavRail**

```tsx
import { LayoutDashboard, GitBranch, Settings, FolderOpen } from 'lucide-react'
import { useLayoutStore } from '../stores/layoutStore'

const NAV_ITEMS = [
  { id: 'projects' as const, icon: FolderOpen, label: 'Projects' },
  { id: 'dashboard' as const, icon: LayoutDashboard, label: 'Dashboard' },
  { id: 'git' as const, icon: GitBranch, label: 'Git' },
  { id: 'settings' as const, icon: Settings, label: 'Settings' },
]

export function NavRail() {
  const view = useLayoutStore((s) => s.view)
  const setView = useLayoutStore((s) => s.setView)

  return (
    <nav className="flex flex-col items-center w-12 bg-[var(--color-surface)] border-r border-[var(--color-border)] py-3 gap-2">
      {NAV_ITEMS.map((item) => {
        const Icon = item.icon
        const active = view === item.id
        return (
          <button
            key={item.id}
            onClick={() => setView(item.id)}
            title={item.label}
            className={`
              w-9 h-9 flex items-center justify-center rounded-lg transition-all
              ${active
                ? 'bg-[var(--color-elevated)] text-[var(--color-accent-cyan)] shadow-[0_0_8px_var(--color-accent-cyan)/30]'
                : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] hover:bg-[var(--color-elevated)]'
              }
            `}
          >
            <Icon size={18} />
          </button>
        )
      })}
    </nav>
  )
}
```

**Step 2: Build to verify**

Run: `npm run build`
Expected: Clean build (component not yet used).

**Step 3: Commit**

```bash
git add src/renderer/src/components/NavRail.tsx
git commit -m "feat: add NavRail component for icon-only sidebar navigation"
```

---

### Task 6: Create AppShell layout container

**Files:**
- Create: `src/renderer/src/components/AppShell.tsx`

**Step 1: Create AppShell**

This is the three-zone container: NavRail | Main Content | Workshop Panel.

```tsx
import { useLayoutStore } from '../stores/layoutStore'
import { NavRail } from './NavRail'

interface AppShellProps {
  children: React.ReactNode
  workshopPanel?: React.ReactNode
}

export function AppShell({ children, workshopPanel }: AppShellProps) {
  const collapsed = useLayoutStore((s) => s.workshopPanelCollapsed)
  const maximized = useLayoutStore((s) => s.workshopPanelMaximized)
  const width = useLayoutStore((s) => s.workshopPanelWidth)
  const setWidth = useLayoutStore((s) => s.setWorkshopWidth)

  const panelWidth = collapsed ? 0 : maximized ? '80%' : `${width}px`

  const handleDragStart = (e: React.MouseEvent) => {
    e.preventDefault()
    const startX = e.clientX
    const startWidth = width

    const onMove = (ev: MouseEvent) => {
      const delta = startX - ev.clientX
      setWidth(startWidth + delta)
    }

    const onUp = () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }

    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }

  return (
    <div className="flex h-full w-full overflow-hidden">
      <NavRail />

      <div className="flex-1 min-w-0 overflow-hidden">
        {children}
      </div>

      {workshopPanel && !collapsed && (
        <>
          <div
            onMouseDown={handleDragStart}
            className="w-1 cursor-col-resize bg-[var(--color-border)] hover:bg-[var(--color-accent-cyan)] transition-colors flex-shrink-0"
          />
          <div
            className="flex-shrink-0 overflow-hidden bg-[var(--color-surface)] border-l border-[var(--color-border)]"
            style={{ width: panelWidth }}
          >
            {workshopPanel}
          </div>
        </>
      )}
    </div>
  )
}
```

**Step 2: Build to verify**

Run: `npm run build`
Expected: Clean build.

**Step 3: Commit**

```bash
git add src/renderer/src/components/AppShell.tsx
git commit -m "feat: add AppShell three-zone layout with resizable workshop panel"
```

---

### Task 7: Rewire App.tsx to use AppShell

**Files:**
- Modify: `src/renderer/src/App.tsx`

**Step 1: Read the current App.tsx**

Read the file to understand the current view-switching logic, global listeners, and modal rendering.

**Step 2: Refactor App.tsx**

Replace the view-switching logic with AppShell. The key changes:
- Wrap all views in `<AppShell>`
- Remove `case 'task-detail'` and `case 'workshop'` from the switch -- task detail is now an overlay, workshop is the persistent panel
- Add `<TaskDetailOverlay>` as a global overlay (placeholder for now)
- Pass workshop panel placeholder to AppShell

The view switch inside AppShell's children becomes:
- `'projects'` renders `<ProjectSelector />`
- `'dashboard'` renders `<Dashboard />` (which will become the canvas)
- `'git'` renders `<Git />`
- `'settings'` renders settings modal (or inline)

Keep all existing global listeners (pipeline status, approval dialogs, toasts).

**Step 3: Build and test**

Run: `npm run build`
Expected: Clean build. The app should still work but now shows the NavRail on the left.

**Step 4: Commit**

```bash
git add src/renderer/src/App.tsx
git commit -m "refactor: rewire App.tsx to use AppShell with NavRail navigation"
```

---

## Phase 3: Workshop Panel

### Task 8: Create WorkshopPanel container with tab system

**Files:**
- Create: `src/renderer/src/components/WorkshopPanel/WorkshopPanel.tsx`

**Step 1: Create the component**

The workshop panel is a container with three tabs (Chat, Artifacts, Group) and a session switcher. It replaces the full-page Workshop view.

```tsx
import { useState } from 'react'
import { Maximize2, Minimize2, PanelRightClose } from 'lucide-react'
import { useLayoutStore } from '../../stores/layoutStore'
import { useWorkshopStore } from '../../stores/workshopStore'

type Tab = 'chat' | 'artifacts' | 'group'

export function WorkshopPanel() {
  const [activeTab, setActiveTab] = useState<Tab>('chat')
  const maximized = useLayoutStore((s) => s.workshopPanelMaximized)
  const setMaximized = useLayoutStore((s) => s.setWorkshopMaximized)
  const togglePanel = useLayoutStore((s) => s.toggleWorkshopPanel)
  const sessions = useWorkshopStore((s) => s.sessions)
  const activeSessionId = useWorkshopStore((s) => s.activeSessionId)
  const setActiveSession = useWorkshopStore((s) => s.setActiveSession)

  const tabs: { id: Tab; label: string }[] = [
    { id: 'chat', label: 'Chat' },
    { id: 'artifacts', label: 'Artifacts' },
    { id: 'group', label: 'Group' },
  ]

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--color-border)]">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-[var(--color-text-primary)]">Workshop</span>
          <select
            value={activeSessionId ?? ''}
            onChange={(e) => setActiveSession(Number(e.target.value))}
            className="text-xs bg-[var(--color-elevated)] text-[var(--color-text-secondary)] border border-[var(--color-border)] rounded px-1.5 py-0.5"
          >
            {sessions.map((s) => (
              <option key={s.id} value={s.id}>{s.title || `Session ${s.id}`}</option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setMaximized(!maximized)}
            className="p-1 rounded hover:bg-[var(--color-elevated)] text-[var(--color-text-muted)]"
            title={maximized ? 'Restore' : 'Maximize'}
          >
            {maximized ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
          </button>
          <button
            onClick={togglePanel}
            className="p-1 rounded hover:bg-[var(--color-elevated)] text-[var(--color-text-muted)]"
            title="Collapse panel"
          >
            <PanelRightClose size={14} />
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-[var(--color-border)]">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`
              px-3 py-1.5 text-xs font-medium transition-colors
              ${activeTab === tab.id
                ? 'text-[var(--color-accent-cyan)] border-b-2 border-[var(--color-accent-cyan)]'
                : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]'
              }
            `}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-hidden">
        {activeTab === 'chat' && <div className="p-3 text-xs text-[var(--color-text-muted)]">Chat tab -- placeholder</div>}
        {activeTab === 'artifacts' && <div className="p-3 text-xs text-[var(--color-text-muted)]">Artifacts tab -- placeholder</div>}
        {activeTab === 'group' && <div className="p-3 text-xs text-[var(--color-text-muted)]">Group tab -- placeholder</div>}
      </div>
    </div>
  )
}
```

**Step 2: Wire into AppShell**

In `App.tsx`, import `WorkshopPanel` and pass it to AppShell:

```tsx
<AppShell workshopPanel={view !== 'projects' ? <WorkshopPanel /> : undefined}>
```

**Step 3: Build and test**

Run: `npm run build`
Expected: Clean build. Workshop panel appears on the right side with tabs and session switcher.

**Step 4: Commit**

```bash
git add src/renderer/src/components/WorkshopPanel/WorkshopPanel.tsx
git add src/renderer/src/App.tsx
git commit -m "feat: add WorkshopPanel container with tab system and session switcher"
```

---

### Task 9: Create ChatMessage component

**Files:**
- Create: `src/renderer/src/components/WorkshopPanel/ChatMessage.tsx`

**Step 1: Create differentiated message component**

This replaces `MessageBubble.tsx`. User messages get a subtle bubble, agent messages are clean text on the panel background. References `CodeBlock`, `ToolCallChip`, and `ThinkingPill` created in the next tasks.

Build this component to accept a message object and render it with the new styling. User messages use elevated background with rounded corners. Agent messages have no bubble. Timestamps show on hover. Thinking content renders via ThinkingPill. Tool calls render as ToolCallChip pills. Code blocks render via CodeBlock with language labels.

**Step 2: Commit**

```bash
git add src/renderer/src/components/WorkshopPanel/ChatMessage.tsx
git commit -m "feat: add ChatMessage with differentiated user/agent styling"
```

---

### Task 10: Create ThinkingPill component

**Files:**
- Create: `src/renderer/src/components/WorkshopPanel/ThinkingPill.tsx`

**Step 1: Create the component**

Replaces `ThinkingDivider`. Shows a shimmer while thinking, collapses to a clickable pill after.

- While streaming: show animated pulse with "Thinking..." text and cyan glow
- After completion: collapse to a pill showing `Thought for Xs` with expand/collapse toggle
- Expanded state shows full reasoning text in a muted, indented block with left border

Use `Zap` icon from lucide-react, `ChevronDown`/`ChevronUp` for toggle.

**Step 2: Commit**

```bash
git add src/renderer/src/components/WorkshopPanel/ThinkingPill.tsx
git commit -m "feat: add ThinkingPill with shimmer animation and collapsible reasoning"
```

---

### Task 11: Create ToolCallChip component

**Files:**
- Create: `src/renderer/src/components/WorkshopPanel/ToolCallChip.tsx`

**Step 1: Create the component**

Compact inline pill for tool calls. Replaces `ToolCallCard` and `ToolCallGroup`.

- Individual chip: pill-shaped button with icon + action summary (e.g., "Read: auth.ts")
- Click to expand: shows full output in a collapsible pre block below
- Grouped mode: when 5+ tool calls, show a single "N actions" chip that expands to show all individual chips
- Icons: FileText for reads, Search for searches, Check for tests, Terminal for commands
- Muted colors, don't compete with message text

**Step 2: Commit**

```bash
git add src/renderer/src/components/WorkshopPanel/ToolCallChip.tsx
git commit -m "feat: add ToolCallChip compact inline pills for tool call display"
```

---

### Task 12: Create CodeBlock component

**Files:**
- Create: `src/renderer/src/components/WorkshopPanel/CodeBlock.tsx`

**Step 1: Create syntax-highlighted code block**

Clean code block with language label and copy button.

- Header bar: language label (left), copy button with check feedback (right)
- Code area: monospace font, slightly different background, horizontal scroll
- Copy uses `navigator.clipboard.writeText()` with a 2-second "Copied" state
- Rounded corners, subtle border using cyberpunk palette

**Step 2: Commit**

```bash
git add src/renderer/src/components/WorkshopPanel/CodeBlock.tsx
git commit -m "feat: add CodeBlock with language label and copy button"
```

---

### Task 13: Build ChatTab with streaming and auto-scroll

**Files:**
- Create: `src/renderer/src/components/WorkshopPanel/ChatTab.tsx`

**Step 1: Create the chat tab**

This replaces `ConversationPanel`. Renders messages with the new components and handles streaming + smart auto-scroll.

Key behaviors:
- Renders message list using `ChatMessage` component
- Smart auto-scroll: follows new content UNLESS user has manually scrolled up (check if within 100px of bottom)
- Streaming indicator: small pulsing dot with "ClawFlow is responding..."
- Input area: textarea that starts at 1 row, auto-expands to max 5 rows
- Enter to send, Shift+Enter for newline
- Input has accent-cyan focus glow
- Contextual placeholder text: "Message ClawFlow..." normally, "Respond to agent question..." when intervention pending
- Send button on the right, disabled when empty or streaming

**Step 2: Wire ChatTab into WorkshopPanel**

Replace the chat placeholder in `WorkshopPanel.tsx`:
```tsx
{activeTab === 'chat' && <ChatTab />}
```

**Step 3: Build and test**

Run: `npm run build`
Expected: Clean build.

**Step 4: Commit**

```bash
git add src/renderer/src/components/WorkshopPanel/ChatTab.tsx
git add src/renderer/src/components/WorkshopPanel/WorkshopPanel.tsx
git commit -m "feat: add ChatTab with streaming, smart auto-scroll, and expanding input"
```

---

### Task 14: Create ArtifactViewer with zoomable mermaid

**Files:**
- Create: `src/renderer/src/components/WorkshopPanel/ArtifactViewer.tsx`

**Step 1: Create zoomable/pannable artifact viewer**

Replaces `MermaidDiagram` with zoom/pan support. Also handles markdown and code artifacts.

Three modes based on artifact type:
- **Mermaid:** Render via `mermaid.render()`, display as SVG with zoom (scroll wheel), pan (click-drag), and reset button. Show zoom percentage. Use ZoomIn/ZoomOut/Maximize2 from lucide-react.
- **Markdown:** Render with ReactMarkdown + remarkGfm in a scrollable container.
- **Code:** Render in a pre block with monospace font.

**Step 2: Commit**

```bash
git add src/renderer/src/components/WorkshopPanel/ArtifactViewer.tsx
git commit -m "feat: add ArtifactViewer with zoomable pannable mermaid diagrams"
```

---

### Task 15: Build ArtifactsTab

**Files:**
- Create: `src/renderer/src/components/WorkshopPanel/ArtifactsTab.tsx`

**Step 1: Create the artifacts tab**

Lists artifacts from the active session. Clicking one opens it in the ArtifactViewer.

- List view: each artifact as a clickable row with icon (GitBranch for mermaid, Code for code, FileText for markdown), title, and type label
- Detail view: back button + ArtifactViewer filling the remaining space
- Empty state: "No artifacts yet" centered message

**Step 2: Wire into WorkshopPanel**

Replace the artifacts placeholder:
```tsx
{activeTab === 'artifacts' && <ArtifactsTab />}
```

**Step 3: Build and test**

Run: `npm run build`
Expected: Clean build.

**Step 4: Commit**

```bash
git add src/renderer/src/components/WorkshopPanel/ArtifactsTab.tsx
git add src/renderer/src/components/WorkshopPanel/WorkshopPanel.tsx
git commit -m "feat: add ArtifactsTab with artifact list and zoomable viewer"
```

---

### Task 16: Build GroupTab with context window bars

**Files:**
- Create: `src/renderer/src/components/WorkshopPanel/GroupTab.tsx`
- Create: `src/renderer/src/components/WorkshopPanel/ContextWindowBar.tsx`

**Step 1: Create ContextWindowBar**

Simple progress bar component:
- Takes `used` and `max` token counts
- Calculates percentage, renders a horizontal bar
- Color coding: green (< 50%), amber (50-80%), red (> 80%)
- Shows percentage text on the right

**Step 2: Create GroupTab**

Shows the active task group with per-task status cards:
- Group header: title + status badge (color-coded: green for running, amber for paused)
- Per task card: title, agent name, current stage, context window bar, action buttons (Message Agent, Peek Output)
- Group controls at bottom: Pause/Resume Group, View on Canvas
- Empty state: "No active task groups"
- Data from: `canvasStore.groups`, `canvasStore.groupTasks`, `pipelineStore.contextByTaskId`
- Group operations via: `window.api.pipeline.pauseGroup()` / `resumeGroup()`

**Step 3: Wire into WorkshopPanel**

```tsx
{activeTab === 'group' && <GroupTab />}
```

**Step 4: Build and test**

Run: `npm run build`
Expected: Clean build.

**Step 5: Commit**

```bash
git add src/renderer/src/components/WorkshopPanel/ContextWindowBar.tsx
git add src/renderer/src/components/WorkshopPanel/GroupTab.tsx
git add src/renderer/src/components/WorkshopPanel/WorkshopPanel.tsx
git commit -m "feat: add GroupTab with per-agent context window bars and controls"
```

---

## Phase 4: Metrics Strip

### Task 17: Create MetricTile with sparkline

**Files:**
- Create: `src/renderer/src/components/Dashboard/MetricTile.tsx`

**Step 1: Create the tile component**

Each tile shows a value, label, and a tiny inline SVG sparkline.

- Sparkline types: `bar` (vertical bars), `line` (connected points), `area` (line with filled area below), `dots` (circle indicators)
- SVG dimensions: 48x16px
- Data is an array of numbers, normalized to fit the SVG height
- Tile layout: value (large, colored), label (small, muted), sublabel (small, muted), sparkline on the right
- Background: surface color with border, rounded corners

**Step 2: Commit**

```bash
git add src/renderer/src/components/Dashboard/MetricTile.tsx
git commit -m "feat: add MetricTile with inline SVG sparkline charts"
```

---

### Task 18: Create MetricsStrip

**Files:**
- Create: `src/renderer/src/components/Dashboard/MetricsStrip.tsx`

**Step 1: Create the metrics strip**

Replaces `MetricsRow`. Compact horizontal bar with 5 metric tiles.

Five metrics with their sparkline types and colors:
1. Active Agents (peach, dots) -- count of running agents
2. Tasks Done (green, bar) -- completed task count with 7-day sparkline
3. Completion Rate (cyan, line) -- percentage with trend
4. Avg Stage Time (amber, line) -- formatted as seconds/minutes
5. Token Usage (violet, area) -- formatted as k/M

Token formatting helper: >= 1M shows "1.2M", >= 1K shows "842k", else raw number.
Time formatting helper: < 60s shows "45s", else "12m".

Horizontally scrollable on narrow screens.

**Step 2: Wire into Dashboard**

Replace the MetricsRow import/usage in `Dashboard.tsx` with MetricsStrip.

**Step 3: Build and test**

Run: `npm run build`
Expected: Clean build.

**Step 4: Commit**

```bash
git add src/renderer/src/components/Dashboard/MetricsStrip.tsx
git add src/renderer/src/components/Dashboard/Dashboard.tsx
git commit -m "feat: add MetricsStrip with 5 sparkline metrics replacing MetricsRow"
```

---

## Phase 5: Canvas

### Task 19: Create Canvas container with pan/zoom

**Files:**
- Create: `src/renderer/src/components/Canvas/Canvas.tsx`

**Step 1: Create the pannable/zoomable canvas**

The canvas is the central workspace. It renders task groups and standalone tasks, handles pan/zoom.

Key behaviors:
- Pan: click-drag on empty canvas space, or scroll (deltaX/deltaY maps to pan)
- Zoom: ctrl+scroll / meta+scroll changes zoom level (0.3 to 3.0)
- Renders CanvasGroup components for each group
- Renders CanvasTaskLane (with standalone=true) for ungrouped tasks
- Transform applied via CSS translate + scale on an inner container
- Zoom percentage indicator in bottom-right corner
- Empty state message when no tasks exist

**Step 2: Commit**

```bash
git add src/renderer/src/components/Canvas/Canvas.tsx
git commit -m "feat: add Canvas container with pan/zoom interactions"
```

---

### Task 20: Create CanvasGroup, CanvasTaskLane, and CanvasStageCard

**Files:**
- Create: `src/renderer/src/components/Canvas/CanvasStageCard.tsx`
- Create: `src/renderer/src/components/Canvas/CanvasTaskLane.tsx`
- Create: `src/renderer/src/components/Canvas/CanvasGroup.tsx`

**Step 1: Create CanvasStageCard**

Individual stage card within a task lane:
- Three states: completed (muted bg, check mark), active (colored border + glow + pulsing dot), pending (dim, low opacity)
- Color per stage: brainstorming/design_review = violet, planning/implement = cyan, code_review = amber, verify/done = green
- Compact: small text, minimal padding

**Step 2: Create CanvasTaskLane**

Vertical lane for a single task:
- Shows task title, agent name
- Stacks CanvasStageCard components vertically
- Uses GROUPED_STAGES (4 stages) for grouped tasks, full stage list for standalone
- Determines stage status by comparing against task's current status
- Clicking the lane calls `openTaskDetail(taskId)`
- Standalone tasks get a bordered container; grouped tasks are borderless (group container provides the border)

**Step 3: Create CanvasGroup**

Visual container for a task group:
- Rounded border colored by group status (green=running, amber=paused, magenta=failed, violet=planning)
- Header: group title + status badge + pause/resume buttons
- Body: horizontal flex of CanvasTaskLane components
- Min-width to prevent collapse

**Step 4: Build and test**

Run: `npm run build`
Expected: Clean build.

**Step 5: Commit**

```bash
git add src/renderer/src/components/Canvas/CanvasStageCard.tsx
git add src/renderer/src/components/Canvas/CanvasTaskLane.tsx
git add src/renderer/src/components/Canvas/CanvasGroup.tsx
git commit -m "feat: add CanvasGroup, CanvasTaskLane, and CanvasStageCard components"
```

---

### Task 21: Create CanvasTimeline for live events

**Files:**
- Create: `src/renderer/src/components/Canvas/CanvasTimeline.tsx`

**Step 1: Create the timeline component**

Horizontal event dot timeline at the bottom of task lanes:
- Renders last 20 events as small colored dots on a horizontal line
- Color by event type: green (stage-complete), cyan (file-change), amber (test-result), magenta (agent-question/error)
- Hover shows tooltip with event summary
- Click could jump to event detail (stretch goal)
- Returns null if no events

**Step 2: Add timeline to CanvasTaskLane**

At the bottom of each task lane, render `<CanvasTimeline taskId={task.id} />`.

**Step 3: Build and test**

Run: `npm run build`
Expected: Clean build.

**Step 4: Commit**

```bash
git add src/renderer/src/components/Canvas/CanvasTimeline.tsx
git add src/renderer/src/components/Canvas/CanvasTaskLane.tsx
git commit -m "feat: add CanvasTimeline with live event dots"
```

---

### Task 22: Wire Canvas into Dashboard

**Files:**
- Modify: `src/renderer/src/components/Dashboard/Dashboard.tsx`

**Step 1: Replace KanbanBoard with Canvas**

Read `Dashboard.tsx` and replace:
- Remove `KanbanBoard` import and usage
- Remove `ActivityFeed` import and usage
- Replace `MetricsRow` with `MetricsStrip` (if not done in Task 18)
- Add `Canvas` import and render it as the main content area
- Update the polling logic (useEffect with setInterval) to also call `canvasStore.refreshAll()` and `metricsStore.refresh()`

The new Dashboard renders: `MetricsStrip` at the top, `Canvas` filling the rest.

**Step 2: Build and test**

Run: `npm run build`
Expected: Clean build.

**Step 3: Commit**

```bash
git add src/renderer/src/components/Dashboard/Dashboard.tsx
git commit -m "refactor: replace KanbanBoard and ActivityFeed with Canvas and MetricsStrip"
```

---

## Phase 6: Task Detail Overlay

### Task 23: Create TaskDetailOverlay

**Files:**
- Create: `src/renderer/src/components/TaskDetail/TaskDetailOverlay.tsx`

**Step 1: Create the slide-over overlay**

This replaces the full-page TaskDetail. Slides in from the right when a task is selected.

Key sections:
- **Backdrop:** fixed overlay with semi-transparent black, clicking closes the panel
- **Panel:** fixed right-side panel, 480px wide (max 90vw), scrollable
- **Header:** close button + task title
- **Status bar:** status, agent name, context window bar (using ContextWindowBar)
- **Work order section (grouped tasks):** objective, files with paths and actions, patterns
- **Description section (standalone tasks):** plain text description
- **Action buttons:** Pause, Message Agent, Restart
- **Stage tabs:** reuse/adapt existing StageTabs for output per stage
- **Agent log:** collapsible timeline of actions (reuse/adapt AgentLog)

Data from: `layoutStore.taskDetailOverlayId`, `taskStore.tasks`, `pipelineStore.contextByTaskId`

**Step 2: Add to App.tsx**

Import and render `<TaskDetailOverlay />` as a global overlay alongside other modals.

**Step 3: Build and test**

Run: `npm run build`
Expected: Clean build.

**Step 4: Commit**

```bash
git add src/renderer/src/components/TaskDetail/TaskDetailOverlay.tsx
git add src/renderer/src/App.tsx
git commit -m "feat: add TaskDetailOverlay slide-over panel with work order display"
```

---

### Task 24: Create TaskProposalPanel (floating, non-blocking)

**Files:**
- Create: `src/renderer/src/components/WorkshopPanel/TaskProposalPanel.tsx`

**Step 1: Create the floating panel**

Non-blocking panel for reviewing proposed task groups. Opens from a chip in chat, doesn't block conversation.

Key features:
- Floating panel (fixed position, not a modal -- no backdrop dimming)
- Header: "Task Proposals" + close button
- Group name display
- Task list: numbered tasks with title, objective, file assignments (path + create/modify action), assigned skill
- File conflict detection: check for duplicate file paths across tasks, highlight conflicts in magenta
- Conflict warning bar (if conflicts found)
- "No file conflicts detected" success message (if clean)
- Action buttons: Launch Group, Edit Tasks, Queue
- Launch disabled if file conflicts exist
- Animate in with fade-scale-in

**Step 2: Commit**

```bash
git add src/renderer/src/components/WorkshopPanel/TaskProposalPanel.tsx
git commit -m "feat: add TaskProposalPanel floating non-blocking review panel"
```

---

## Phase 7: Git View and Cleanup

### Task 25: Create DiffViewer component

**Files:**
- Create: `src/renderer/src/components/Git/DiffViewer.tsx`

**Step 1: Create syntax-highlighted diff viewer**

Line-by-line diff rendering with color coding:
- Lines starting with `+` (not `+++`): green text on subtle green background
- Lines starting with `-` (not `---`): magenta text on subtle magenta background
- Lines starting with `@@`: cyan text (hunk headers)
- All other lines: default text color
- Optional file name header above the diff
- Monospace font, horizontal scroll for long lines

**Step 2: Wire into BranchDetail**

Read `BranchDetail.tsx` and replace the current raw diff display with `<DiffViewer diff={...} />`.

**Step 3: Build and test**

Run: `npm run build`
Expected: Clean build.

**Step 4: Commit**

```bash
git add src/renderer/src/components/Git/DiffViewer.tsx
git add src/renderer/src/components/Git/BranchDetail.tsx
git commit -m "feat: add DiffViewer with syntax-highlighted diff rendering"
```

---

### Task 26: Update ProjectSelector cards

**Files:**
- Modify: `src/renderer/src/components/ProjectSelector/ProjectCard.tsx`

**Step 1: Read the current ProjectCard**

**Step 2: Add progress bar and activity timestamp**

Update the card to show:
- Project name (existing)
- Active task count
- A small progress bar (done / total) using accent-cyan fill on a dark track
- Last activity timestamp

**Step 3: Build and test**

Run: `npm run build`
Expected: Clean build.

**Step 4: Commit**

```bash
git add src/renderer/src/components/ProjectSelector/ProjectCard.tsx
git commit -m "feat: refresh ProjectCard with progress bar and activity timestamp"
```

---

### Task 27: Clean up old components

**Files:**
- Delete: `src/renderer/src/components/KanbanBoard/KanbanBoard.tsx`
- Delete: `src/renderer/src/components/KanbanBoard/KanbanColumn.tsx`
- Delete: `src/renderer/src/components/KanbanBoard/TaskCard.tsx`
- Delete: `src/renderer/src/components/ActivityFeed/ActivityFeed.tsx`
- Delete: `src/renderer/src/components/ActivityFeed/ActivityEntry.tsx`
- Delete: `src/renderer/src/components/Dashboard/MetricsRow.tsx`

**Step 1: Remove old components**

Delete the files listed above. These have all been replaced.

**Step 2: Remove any remaining imports**

Search the codebase for imports of the deleted components and remove them.

**Step 3: Build to verify nothing breaks**

Run: `npm run build`
Expected: Clean build. No references to deleted components remain.

**Step 4: Commit**

```bash
git add -A
git commit -m "refactor: remove replaced components (Kanban, ActivityFeed, MetricsRow)"
```

---

### Task 28: Final integration and build verification

**Step 1: Full build**

Run: `npm run build`
Fix any remaining type errors or import issues.

**Step 2: Smoke test the app**

Run: `npm run dev`
Verify:
- NavRail appears on the left with 4 icons
- Canvas renders in the center with task groups and standalone tasks
- Workshop panel is on the right with Chat/Artifacts/Group tabs
- MetricsStrip shows above the canvas
- Clicking a task opens the slide-over overlay
- Git view renders with the diff viewer
- Project selector shows refreshed cards
- Workshop panel is resizable (drag the edge)
- Workshop panel maximize button works
- Canvas pan (click-drag) and zoom (ctrl+scroll) work

**Step 3: Commit any final fixes**

```bash
git add -A
git commit -m "fix: final integration fixes for UI rework"
```

---

## Summary

| Phase | Tasks | Key Deliverables |
|-------|-------|-----------------|
| 1: Foundation | 1-4 | Fixed metrics, updated stores, new canvasStore + metricsStore |
| 2: App Shell | 5-7 | NavRail, AppShell, rewired App.tsx |
| 3: Workshop Panel | 8-16 | WorkshopPanel, ChatTab, ArtifactsTab, GroupTab, ChatMessage, ThinkingPill, ToolCallChip, CodeBlock, ArtifactViewer, ContextWindowBar |
| 4: Metrics | 17-18 | MetricTile, MetricsStrip |
| 5: Canvas | 19-22 | Canvas, CanvasGroup, CanvasTaskLane, CanvasStageCard, CanvasTimeline, Dashboard rewire |
| 6: Task Detail | 23-24 | TaskDetailOverlay, TaskProposalPanel |
| 7: Git and Polish | 25-28 | DiffViewer, ProjectCard refresh, old component cleanup, integration |

**Total: 28 tasks across 7 phases.**
