# ClawFlow Visual Overhaul — "Midnight Neon" Design

**Date:** 2026-02-26
**Direction:** Polished dev tool with cyberpunk edge
**Density:** Balanced
**Motion:** Subtle & smooth with cyberpunk flair accents

---

## 1. Color System

### Background Layers

| Token | Hex | Role |
|-------|-----|------|
| `bg` | `#0a0b10` | App background — near black with blue undertone |
| `surface` | `#12131a` | Cards, panels, sidebar |
| `elevated` | `#1a1b26` | Inputs, code blocks, hover states, nested panels |
| `overlay` | `#1e1f2e` | Modals, dropdowns, popovers |

### Borders

| Token | Hex | Role |
|-------|-----|------|
| `border` | `#2a2b3d` | Default borders |
| `border-bright` | `#3a3b5d` | Hover states, focused inputs |

### Text Hierarchy

| Token | Hex | Role |
|-------|-----|------|
| `text-primary` | `#e4e6f0` | Main body text, headings |
| `text-secondary` | `#8b8fa3` | Descriptions, labels |
| `text-muted` | `#4a4d63` | Timestamps, placeholders, disabled |

### Accent Colors

| Token | Hex | Role |
|-------|-----|------|
| `accent-cyan` | `#00e5ff` | Primary actions, active states, focus rings |
| `accent-magenta` | `#ff2d78` | Errors, destructive actions, circuit breakers |
| `accent-amber` | `#ffb836` | Warnings, interventions, gates |
| `accent-green` | `#3ddc84` | Success, done, approved |
| `accent-violet` | `#a78bfa` | AI/agent activity, brainstorm, tool approvals |
| `accent-peach` | `#ff8a65` | High priority, implementing stage |

### Pipeline Stage Colors

| Stage | Color | Token |
|-------|-------|-------|
| backlog | `#4a4d63` | `text-muted` |
| brainstorming | `#a78bfa` | `accent-violet` |
| design_review | `#ffb836` | `accent-amber` |
| planning | `#00e5ff` | `accent-cyan` |
| implementing | `#ff8a65` | `accent-peach` |
| code_review | `#ffb836` | `accent-amber` |
| verifying | `#3ddc84` | `accent-green` |
| done | `#3ddc84` | `accent-green` |
| blocked | `#ff2d78` | `accent-magenta` |
| paused | `#4a4d63` | `text-muted` |

### Special Effects

- **Glow:** `accent-cyan` at 20-30% opacity for box-shadows on active/focused elements
- **Gradient borders:** `linear-gradient(135deg, accent-cyan, accent-violet)` on primary CTAs
- **Frosted glass:** `backdrop-blur-md bg-surface/80` on modals and overlays

---

## 2. Typography

### Font Choices

- **Display/UI:** Geist Sans (Vercel) — geometric, sharp, modern
- **Monospace:** Geist Mono — matching companion

### Scale

| Usage | Size | Weight | Font |
|-------|------|--------|------|
| App title (CLAWFLOW) | 14px | 700 | Geist Sans, letter-spacing: 0.25em |
| Page heading | 22px | 600 | Geist Sans |
| Section heading | 16px | 600 | Geist Sans |
| Body text | 14px | 400 | Geist Sans |
| Small text / labels | 12px | 500 | Geist Sans |
| Tiny (badges, timestamps) | 10px | 600 | Geist Mono |
| Code / logs | 13px | 400 | Geist Mono |

### Key Decisions

- Pipeline stage labels in mono (system readout feel)
- Metric values in mono, large and bold (precision feel)
- CLAWFLOW wordmark: gradient text fill (`accent-cyan → accent-violet`)

---

## 3. Surfaces & Depth

### Glass Treatment

| Surface | Treatment |
|---------|-----------|
| Sidebar panels (SessionList, BranchList, ActivityFeed) | `bg-surface/60 backdrop-blur-lg` |
| Modals | `bg-overlay/80 backdrop-blur-xl` |
| TopBar | `bg-surface/70 backdrop-blur-md border-b border-border/50` |
| Card hover | `bg-surface/90 backdrop-blur-sm` |
| Kanban column headers | `bg-surface/40 backdrop-blur-sm` |
| Workshop input bar | `bg-surface/70 backdrop-blur-md` |

### Panel Treatments

- **Cards:** `bg-surface border border-border`, hover: `border-border-bright` + faint cyan glow `shadow-[0_0_12px_rgba(0,229,255,0.06)]`
- **Active/selected:** `border-accent-cyan/40 bg-accent-cyan/5`
- **Inputs:** `bg-elevated border border-border`, focus: `border-accent-cyan/50 shadow-[0_0_0_1px_rgba(0,229,255,0.15)]`

### Kanban Column Headers

Replace `borderTop: 3px solid` with gradient fade bar: 4px tall, `linear-gradient(90deg, stageColor 0%, transparent 100%)`.

### Glow-Pulse (Intervention States)

`accent-amber`, 3s breathing cycle (ease-in-out), with static `border-left: 3px solid accent-amber` anchor.

### Scrollbars

8px wide, `bg-border` thumb, `rounded-full`, hover: `border-bright`.

---

## 4. Motion & Animation

### Global Transitions

- **Easing:** `cubic-bezier(0.4, 0, 0.2, 1)`
- **Durations:** 150ms (micro), 250ms (state changes), 400ms (navigation)

### View Transitions

- Outgoing: fade out + scale to 98% (200ms)
- Incoming: fade in + scale from 98% (300ms, 100ms stagger)

### Kanban Card Reveals

- Stagger top-to-bottom, 50ms between cards
- Each: `opacity 0→1, translateY(8px→0)`, 200ms

### Active Process Indicators

- Streaming dot: `accent-cyan` glow ring
- Intervention glow: `accent-amber`, 3s breathing
- Running pipeline: 2px animated gradient border (`accent-cyan → accent-violet → accent-cyan`)

### Hover Effects

- Cards: border + glow transition (150ms)
- Buttons: background transition + `translateY(-1px)` on primary
- Sidebar items: background slides in from left (150ms)

### Modal Entry/Exit

- Entry: backdrop fade (200ms), modal scale 95→100% + fade (250ms)
- Exit: reverse, 150ms

### Cyberpunk Flair

- **Scanline overlay:** Repeating horizontal lines on app root, `opacity: 0.015`, toggleable
- **Glitch on errors:** 300ms `clip-path` flicker with cyan/red color split on blocked/error states
- **Neon border pulse:** 4s gradient sweep on active pipeline tasks
- **Typing cursor:** Thin `|` with `accent-cyan` glow, slightly irregular blink
- **Title bar accent line:** 1px gradient (`accent-cyan → transparent → accent-magenta`) at TitleBar bottom
- **Task completion flash:** 200ms `accent-green` at 10% opacity wash on completion

---

## 5. Component-Specific Redesigns

### TitleBar
- Glass: `bg-surface/70 backdrop-blur-md`
- 1px gradient accent line at bottom
- CLAWFLOW: gradient text, letter-spacing 0.25em, Geist Sans 700
- Window controls: smaller circles, close glows magenta on hover

### ProjectSelector
- Radial gradient behind heading (faint cyan glow center → bg)
- Project cards: glass on hover
- Register button: gradient fill (`accent-cyan → accent-violet`)

### Dashboard TopBar
- Glass treatment
- Ghost buttons: `border border-border` → hover: `border-accent-cyan/40 bg-accent-cyan/5`
- Usage indicator: redesign as thin arc/ring

### MetricsRow
- Cards: `bg-surface/60 backdrop-blur-sm`
- Values: Geist Mono 28px bold
- Faint colored left border (4px, rounded)

### KanbanBoard
- Column headers: gradient fade bar + mono label + glass count badge
- Running tasks: neon gradient border sweep
- Intervention: amber breathing glow
- Staggered card entrance

### TaskDetail
- Timeline nodes: gradient connecting lines (completed: cyan→green, active: animated pulse, future: dashed muted)
- Intervention panels: glass + colored left border accent
- Live output: `bg-bg` with faint scanline overlay
- Active stage tab: gradient underline

### Workshop
- SessionList: full glass (`bg-surface/60 backdrop-blur-lg`)
- User messages: `bg-accent-cyan/10 border border-accent-cyan/20`
- Assistant messages: `bg-surface border border-border`
- Tool call cards: glass + left-border accent in tool color
- ArtifactPanel: glass, gradient underline on active tab
- Input bar: glass + gradient border on focus

### Git View
- Full theme token conversion (remove all raw Tailwind colors)
- Status dots using accent tokens
- Glass sidebar treatment

### Settings Modal
- Glass panel treatment
- Gradient fade dividers
- Toggle switches: `accent-cyan` glow when active
