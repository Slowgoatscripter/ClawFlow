# Midnight Neon Visual Overhaul — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Transform ClawFlow's UI from flat Catppuccin dark theme to a "Midnight Neon" aesthetic — near-black backgrounds, Geist typography, frosted glass surfaces, smooth animations, and cyberpunk flair accents.

**Architecture:** Bottom-up token replacement. Change the foundation (CSS tokens, theme.ts, fonts) first, then update components in layers: core shell → high-frequency components → view-specific components. Glass effects and animations are layered on top after colors/typography are consistent.

**Tech Stack:** Tailwind CSS v4 (via `@theme` in index.css), React 19, Geist font family (npm), CSS animations/transitions.

**Design doc:** `docs/plans/2026-02-26-visual-overhaul-design.md`

---

## Phase 1: Foundation (Tokens, Fonts, Global CSS)

### Task 1: Install Geist font and update package.json

**Files:**
- Modify: `package.json`

**Step 1: Install Geist font packages**

Run:
```bash
pnpm add geist
```

**Step 2: Verify installation**

Run: `pnpm ls geist`
Expected: `geist` package listed

**Step 3: Commit**

```bash
git add package.json pnpm-lock.yaml
git commit -m "chore: add geist font package"
```

---

### Task 2: Replace color palette and typography in index.css

**Files:**
- Modify: `src/renderer/src/index.css`

**Step 1: Update @theme block with new color tokens**

Replace the entire `@theme` block. New tokens:

```css
@theme {
  /* Background layers */
  --color-bg: #0a0b10;
  --color-surface: #12131a;
  --color-elevated: #1a1b26;
  --color-overlay: #1e1f2e;

  /* Borders */
  --color-border: #2a2b3d;
  --color-border-bright: #3a3b5d;

  /* Text hierarchy */
  --color-text-primary: #e4e6f0;
  --color-text-secondary: #8b8fa3;
  --color-text-muted: #4a4d63;

  /* Accents */
  --color-accent-cyan: #00e5ff;
  --color-accent-magenta: #ff2d78;
  --color-accent-amber: #ffb836;
  --color-accent-green: #3ddc84;
  --color-accent-violet: #a78bfa;
  --color-accent-peach: #ff8a65;

  /* Fonts */
  --font-family-ui: 'Geist', -apple-system, BlinkMacSystemFont, sans-serif;
  --font-family-mono: 'Geist Mono', 'JetBrains Mono', 'Fira Code', monospace;
}
```

Remove any old tokens that no longer exist (accent-teal, accent-gold, accent-red, accent-mauve). Add Tailwind aliases where needed (e.g. `--color-accent-teal` as alias to `--color-accent-cyan` temporarily if needed for migration).

**Step 2: Add Geist font import at top of file**

```css
@import 'geist/font/sans';
@import 'geist/font/mono';
```

Place these BEFORE the `@import "tailwindcss"` line.

**Step 3: Update body font-family**

The body rule should reference the new CSS variable: `font-family: var(--font-family-ui);`

**Step 4: Update scrollbar styles**

```css
::-webkit-scrollbar { width: 8px; height: 8px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: var(--color-border); border-radius: 9999px; }
::-webkit-scrollbar-thumb:hover { background: var(--color-border-bright); }
```

**Step 5: Add new animation keyframes**

```css
@keyframes glow-pulse {
  0%, 100% { box-shadow: 0 0 8px rgba(255, 184, 54, 0.15); }
  50% { box-shadow: 0 0 20px rgba(255, 184, 54, 0.3); }
}

@keyframes neon-border-sweep {
  0% { background-position: 0% 50%; }
  100% { background-position: 200% 50%; }
}

@keyframes fade-scale-in {
  from { opacity: 0; transform: scale(0.95); }
  to { opacity: 1; transform: scale(1); }
}

@keyframes fade-scale-out {
  from { opacity: 1; transform: scale(1); }
  to { opacity: 0; transform: scale(0.98); }
}

@keyframes stagger-in {
  from { opacity: 0; transform: translateY(8px); }
  to { opacity: 1; transform: translateY(0); }
}

@keyframes slide-in-right {
  from { transform: translateX(100%); }
  to { transform: translateX(0); }
}

@keyframes glitch {
  0% { clip-path: inset(0 0 0 0); transform: translateX(0); }
  20% { clip-path: inset(20% 0 60% 0); transform: translateX(-3px); }
  40% { clip-path: inset(60% 0 10% 0); transform: translateX(3px); }
  60% { clip-path: inset(40% 0 30% 0); transform: translateX(-2px); }
  80% { clip-path: inset(10% 0 70% 0); transform: translateX(2px); }
  100% { clip-path: inset(0 0 0 0); transform: translateX(0); }
}

@keyframes cursor-blink {
  0%, 45% { opacity: 1; }
  50%, 95% { opacity: 0; }
  100% { opacity: 1; }
}
```

**Step 6: Add scanline overlay utility class**

```css
.scanlines::after {
  content: '';
  position: fixed;
  inset: 0;
  pointer-events: none;
  z-index: 9999;
  background: repeating-linear-gradient(
    0deg,
    transparent,
    transparent 2px,
    rgba(255, 255, 255, 0.015) 2px,
    rgba(255, 255, 255, 0.015) 4px
  );
}
```

**Step 7: Update context-bar data-level colors and any hardcoded rgba values**

Replace old accent colors in `[data-level="ok"]`, `[data-level="warn"]`, `[data-level="danger"]` with new accent-green, accent-amber, accent-magenta.

Update pause/resume button styles that use hardcoded `rgba(36,39,58,...)` to use new token values.

**Step 8: Verify build compiles**

Run: `pnpm run build`
Expected: Build succeeds (there will be visual mismatches until components are updated, but no compile errors)

**Step 9: Commit**

```bash
git add src/renderer/src/index.css
git commit -m "feat: replace color palette, add Geist fonts, add animation keyframes"
```

---

### Task 3: Update theme.ts to match new palette

**Files:**
- Modify: `src/renderer/src/theme.ts`

**Step 1: Replace entire colors object**

```typescript
export const colors = {
  bg: '#0a0b10',
  surface: '#12131a',
  elevated: '#1a1b26',
  overlay: '#1e1f2e',
  border: '#2a2b3d',
  borderBright: '#3a3b5d',
  text: {
    primary: '#e4e6f0',
    secondary: '#8b8fa3',
    muted: '#4a4d63',
  },
  accent: {
    cyan: '#00e5ff',
    magenta: '#ff2d78',
    amber: '#ffb836',
    green: '#3ddc84',
    violet: '#a78bfa',
    peach: '#ff8a65',
  },
  tier: {
    L1: '#3ddc84',
    L2: '#00e5ff',
    L3: '#a78bfa',
  },
  priority: {
    low: '#8b8fa3',
    medium: '#ffb836',
    high: '#ff8a65',
    critical: '#ff2d78',
  },
  status: {
    backlog: '#4a4d63',
    brainstorming: '#a78bfa',
    design_review: '#ffb836',
    planning: '#00e5ff',
    implementing: '#ff8a65',
    code_review: '#ffb836',
    verifying: '#3ddc84',
    done: '#3ddc84',
    blocked: '#ff2d78',
    paused: '#4a4d63',
  },
} as const

export const fonts = {
  ui: "'Geist', -apple-system, BlinkMacSystemFont, sans-serif",
  mono: "'Geist Mono', 'JetBrains Mono', 'Fira Code', monospace",
} as const
```

**Step 2: Update any old property references**

Search the codebase for `colors.accent.teal` → replace with `colors.accent.cyan`
Search for `colors.accent.gold` → replace with `colors.accent.amber`
Search for `colors.accent.red` → replace with `colors.accent.magenta`
Search for `colors.accent.mauve` → replace with `colors.accent.violet`

**Step 3: Verify build compiles**

Run: `pnpm run build`
Expected: Build succeeds. Fix any TypeScript errors from removed/renamed properties.

**Step 4: Commit**

```bash
git add src/renderer/src/theme.ts
git commit -m "feat: update theme.ts to Midnight Neon palette"
```

---

### Task 4: Fix all inline theme.ts references across codebase

**Files:**
- Modify: Every file that imports and uses `colors` from theme.ts (App.tsx, TaskDetail.tsx, TopBar.tsx, KanbanColumn.tsx, TaskCard.tsx, HandoffChain.tsx, BranchDetail.tsx)

**Step 1: Search for all `colors.accent.teal` references and replace with `colors.accent.cyan`**

Run: `grep -rn "colors\.accent\.teal" src/renderer/src/`

Replace each occurrence.

**Step 2: Search for `colors.accent.gold` → `colors.accent.amber`**

Run: `grep -rn "colors\.accent\.gold" src/renderer/src/`

**Step 3: Search for `colors.accent.red` → `colors.accent.magenta`**

Run: `grep -rn "colors\.accent\.red" src/renderer/src/`

**Step 4: Search for `colors.accent.mauve` → `colors.accent.violet`**

Run: `grep -rn "colors\.accent\.mauve" src/renderer/src/`

**Step 5: Search for `colors.text.primary`, `colors.text.secondary`, `colors.text.muted` — these should still work but verify the object shape matches**

**Step 6: Verify build compiles**

Run: `pnpm run build`
Expected: No TypeScript errors

**Step 7: Commit**

```bash
git add -A
git commit -m "refactor: update all inline theme color references to new palette"
```

---

## Phase 2: Tailwind Class Migration (Color Token Renames)

### Task 5: Rename Tailwind color classes globally

The old token names (`accent-teal`, `accent-gold`, `accent-red`, `accent-mauve`) no longer exist. Every Tailwind class referencing them must be updated.

**Files:** All 50 component files

**Mapping:**
- `accent-teal` → `accent-cyan`
- `accent-gold` → `accent-amber`
- `accent-red` → `accent-magenta`
- `accent-mauve` → `accent-violet`

**Step 1: Run search-and-replace across all renderer source files**

For each mapping, replace in ALL files under `src/renderer/src/`:
- `text-accent-teal` → `text-accent-cyan`
- `bg-accent-teal` → `bg-accent-cyan`
- `border-accent-teal` → `border-accent-cyan`
- `border-l-accent-teal` → `border-l-accent-cyan`
- `border-b-accent-teal` → `border-b-accent-cyan`
- `focus:border-accent-teal` → `focus:border-accent-cyan`
- `hover:border-accent-teal` → `hover:border-accent-cyan`
- (same patterns for gold→amber, red→magenta, mauve→violet)

Also handle opacity variants: `accent-teal/10` → `accent-cyan/10`, etc.

**Step 2: Verify build compiles**

Run: `pnpm run build`
Expected: Build succeeds

**Step 3: Commit**

```bash
git add -A
git commit -m "refactor: rename all Tailwind accent color classes to new palette"
```

---

### Task 6: Fix Git view inconsistent token usage

The Git view files use raw Tailwind colors and non-standard token names.

**Files:**
- Modify: `src/renderer/src/components/Git/Git.tsx`
- Modify: `src/renderer/src/components/Git/BranchList.tsx`
- Modify: `src/renderer/src/components/Git/BranchDetail.tsx`
- Modify: `src/renderer/src/components/Git/GitStatusBar.tsx`

**Step 1: Replace raw color classes in BranchList.tsx**

Replace `STATUS_COLORS` map:
- `bg-green-500` → `bg-accent-green`
- `bg-blue-500` → `bg-accent-cyan`
- `bg-yellow-500` → `bg-accent-amber`
- `bg-gray-500` → `bg-text-muted`

**Step 2: Replace raw color classes in BranchDetail.tsx**

Replace `STATUS_INDICATORS` map:
- `text-yellow-400` → `text-accent-amber`
- `text-green-400` → `text-accent-green`
- `text-red-400` → `text-accent-magenta`
- `text-gray-400` → `text-text-muted`
- `text-blue-400` → `text-accent-cyan`

Replace action buttons:
- `bg-green-600` → `bg-accent-green`
- `bg-red-600` → `bg-accent-magenta`
- `bg-red-500/10 border-red-500/30 text-red-400` → `bg-accent-magenta/10 border-accent-magenta/30 text-accent-magenta`

**Step 3: Replace raw color classes in GitStatusBar.tsx**

- `text-green-400` → `text-accent-green`
- `text-blue-400` → `text-accent-cyan`
- `text-yellow-400` → `text-accent-amber`
- `text-gray-400` → `text-text-muted`

**Step 4: Fix non-standard token names in all Git files**

- `text-textSecondary` → `text-text-secondary`
- `text-text` → `text-text-primary`
- `bg-accent` → `bg-accent-cyan`
- `focus:border-accent` → `focus:border-accent-cyan`

**Step 5: Replace raw colors in Workshop files**

Check and replace any raw Tailwind colors in:
- `ConversationPanel.tsx`: `bg-yellow-500/10 border-yellow-500/30 text-yellow-400` → amber equivalents
- `SessionList.tsx`: `hover:bg-red-500/20 text-red-400` → magenta equivalents
- `ArtifactPanel.tsx`: `bg-red-500/10 border-red-500/30 text-red-400` → magenta equivalents

**Step 6: Verify build compiles**

Run: `pnpm run build`

**Step 7: Commit**

```bash
git add -A
git commit -m "fix: normalize all raw Tailwind colors to design system tokens"
```

---

### Task 7: Update ToolCallCard and ToolCallGroup TOOL_STYLES

Both files duplicate a `TOOL_STYLES` map using raw Tailwind color classes.

**Files:**
- Modify: `src/renderer/src/components/Workshop/ToolCallCard.tsx`
- Modify: `src/renderer/src/components/Workshop/ToolCallGroup.tsx`

**Step 1: Replace TOOL_STYLES color values in both files**

Map the tool type colors to the new accent system:
- Read/LS (blue) → `accent-cyan`: `text-accent-cyan`, `bg-accent-cyan/10`, `border-accent-cyan/20`
- Edit/Write (amber) → `accent-amber`: `text-accent-amber`, `bg-accent-amber/10`, `border-accent-amber/20`
- Bash (green) → `accent-green`: `text-accent-green`, `bg-accent-green/10`, `border-accent-green/20`
- Grep/Glob (violet) → `accent-violet`: `text-accent-violet`, `bg-accent-violet/10`, `border-accent-violet/20`
- WebFetch/WebSearch (cyan) → `accent-cyan`: (same as Read, or differentiate with slightly different opacity)
- Task (slate) → `text-secondary`: `text-text-secondary`, `bg-elevated`, `border-border`

**Step 2: Verify build**

Run: `pnpm run build`

**Step 3: Commit**

```bash
git add src/renderer/src/components/Workshop/ToolCallCard.tsx src/renderer/src/components/Workshop/ToolCallGroup.tsx
git commit -m "refactor: update tool call card colors to design system tokens"
```

---

## Phase 3: Glass & Surface Effects

### Task 8: Add glass treatment to base Modal and TitleBar

**Files:**
- Modify: `src/renderer/src/components/common/Modal.tsx`
- Modify: `src/renderer/src/components/common/TitleBar.tsx`

**Step 1: Update Modal.tsx**

Change backdrop: `bg-black/50` → `bg-black/60 backdrop-blur-sm`
Change container: `bg-surface rounded-lg p-6` → `bg-overlay/80 backdrop-blur-xl rounded-lg p-6 border border-border-bright`
Add entrance animation: `animate-[fade-scale-in_0.25s_ease-out]`

**Step 2: Update TitleBar.tsx**

Change background: `bg-surface` → `bg-surface/70 backdrop-blur-md`
Add gradient accent line at bottom: after the existing div, add a 1px div with:
```
bg-gradient-to-r from-accent-cyan via-transparent to-accent-magenta h-px
```
Update CLAWFLOW wordmark: add gradient text effect:
```
bg-gradient-to-r from-accent-cyan to-accent-violet bg-clip-text text-transparent
```
Update window control close button hover: `hover:bg-accent-red` → `hover:bg-accent-magenta`

**Step 3: Verify build**

Run: `pnpm run build`

**Step 4: Commit**

```bash
git add src/renderer/src/components/common/Modal.tsx src/renderer/src/components/common/TitleBar.tsx
git commit -m "feat: add glass treatment to Modal and TitleBar"
```

---

### Task 9: Add glass treatment to sidebar panels

**Files:**
- Modify: `src/renderer/src/components/Workshop/SessionList.tsx`
- Modify: `src/renderer/src/components/ActivityFeed/ActivityFeed.tsx`
- Modify: `src/renderer/src/components/Git/BranchList.tsx`
- Modify: `src/renderer/src/components/Workshop/ArtifactPanel.tsx`
- Modify: `src/renderer/src/components/ArchiveDrawer/ArchiveDrawer.tsx`

**Step 1: SessionList — change `bg-surface/50` → `bg-surface/60 backdrop-blur-lg`**

**Step 2: ActivityFeed — change `bg-surface` panel → `bg-surface/60 backdrop-blur-lg`**

**Step 3: BranchList — add `bg-surface/60 backdrop-blur-lg` to container**

**Step 4: ArtifactPanel — change `bg-surface/30` → `bg-surface/60 backdrop-blur-lg`**

**Step 5: ArchiveDrawer — change `bg-surface` → `bg-surface/60 backdrop-blur-lg`**
Also update slide animation: `animate-[slide-in-right_0.2s_ease-out]` → `animate-[slide-in-right_0.3s_cubic-bezier(0.4,0,0.2,1)]`

**Step 6: Verify build**

Run: `pnpm run build`

**Step 7: Commit**

```bash
git add -A
git commit -m "feat: add glass treatment to sidebar panels"
```

---

### Task 10: Add glass treatment to TopBar and input areas

**Files:**
- Modify: `src/renderer/src/components/Dashboard/TopBar.tsx`
- Modify: `src/renderer/src/components/Workshop/Workshop.tsx`
- Modify: `src/renderer/src/components/Workshop/ConversationPanel.tsx`

**Step 1: Dashboard TopBar — change `bg-surface` → `bg-surface/70 backdrop-blur-md`**

Change button styles from solid to ghost: `bg-accent-cyan/10 text-accent-cyan` → `border border-border text-accent-cyan hover:border-accent-cyan/40 hover:bg-accent-cyan/5`

**Step 2: Workshop TopBar area — apply `bg-surface/70 backdrop-blur-md` to the top bar area**

**Step 3: ConversationPanel input bar — change the input container border-t area to `bg-surface/70 backdrop-blur-md`**

Add gradient border on focus for the textarea: when focused, add `shadow-[0_0_0_1px_rgba(0,229,255,0.15)]`

**Step 4: Verify build**

Run: `pnpm run build`

**Step 5: Commit**

```bash
git add -A
git commit -m "feat: add glass treatment to top bars and input areas"
```

---

### Task 11: Update card surfaces (TaskCard, MetricsRow, ProjectCard)

**Files:**
- Modify: `src/renderer/src/components/KanbanBoard/TaskCard.tsx`
- Modify: `src/renderer/src/components/Dashboard/MetricsRow.tsx`
- Modify: `src/renderer/src/components/ProjectSelector/ProjectCard.tsx`
- Modify: `src/renderer/src/components/ProjectSelector/ProjectSelector.tsx`

**Step 1: TaskCard — update hover state**

Change hover: `hover:border-accent-teal` → `hover:border-border-bright` with added `hover:shadow-[0_0_12px_rgba(0,229,255,0.06)]`

**Step 2: MetricsRow cards — add glass treatment**

Change `bg-elevated` → `bg-surface/60 backdrop-blur-sm`
Add left accent border: each card gets `border-l-4` in its accent color (peach, green, amber, magenta)
Change metric values to mono font: add `font-mono` class to the value element

**Step 3: ProjectCard — add glass hover**

Add `hover:bg-surface/90 hover:backdrop-blur-sm` to card hover state

**Step 4: ProjectSelector — add radial gradient behind heading**

Add a `div` behind the CLAWFLOW heading with:
```
absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(0,229,255,0.08)_0%,transparent_70%)]
```
Apply gradient text to CLAWFLOW heading (same as TitleBar wordmark)

**Step 5: Verify build**

Run: `pnpm run build`

**Step 6: Commit**

```bash
git add -A
git commit -m "feat: update card surfaces with glass effects and accent borders"
```

---

### Task 12: Update KanbanColumn headers with gradient fade bars

**Files:**
- Modify: `src/renderer/src/components/KanbanBoard/KanbanColumn.tsx`

**Step 1: Replace `borderTop: 3px solid` with gradient fade bar**

Change the inline style from `borderTop: '3px solid ${color}'` to a child `div`:
```html
<div style={{
  height: '4px',
  background: `linear-gradient(90deg, ${color} 0%, transparent 100%)`,
  borderRadius: '2px 2px 0 0'
}} />
```

Add glass treatment to column header area: `bg-surface/40 backdrop-blur-sm` on the header section.

**Step 2: Verify build**

Run: `pnpm run build`

**Step 3: Commit**

```bash
git add src/renderer/src/components/KanbanBoard/KanbanColumn.tsx
git commit -m "feat: replace solid column borders with gradient fade bars"
```

---

## Phase 4: Animation & Motion

### Task 13: Add view transition animations

**Files:**
- Modify: `src/renderer/src/App.tsx`

**Step 1: Add CSS transition wrapper for view changes**

Wrap the view router content in a container that applies `animate-[fade-scale-in_0.3s_cubic-bezier(0.4,0,0.2,1)]` keyed by the current view. Use the view name as a React `key` to trigger re-mount animation on navigation.

**Step 2: Verify build and test navigation between views**

Run: `pnpm run build`

**Step 3: Commit**

```bash
git add src/renderer/src/App.tsx
git commit -m "feat: add fade-scale view transition animations"
```

---

### Task 14: Add staggered card entrance to KanbanBoard

**Files:**
- Modify: `src/renderer/src/components/KanbanBoard/KanbanColumn.tsx`
- Modify: `src/renderer/src/components/KanbanBoard/TaskCard.tsx`

**Step 1: Add stagger delay to TaskCards**

In KanbanColumn, pass the card index to TaskCard. In TaskCard, apply:
```
style={{ animationDelay: `${index * 50}ms` }}
className="animate-[stagger-in_0.2s_cubic-bezier(0.4,0,0.2,1)_both]"
```

The `both` fill mode ensures cards stay visible after animation completes.

**Step 2: Verify build**

Run: `pnpm run build`

**Step 3: Commit**

```bash
git add src/renderer/src/components/KanbanBoard/KanbanColumn.tsx src/renderer/src/components/KanbanBoard/TaskCard.tsx
git commit -m "feat: add staggered entrance animation to kanban cards"
```

---

### Task 15: Add neon border pulse to active pipeline tasks

**Files:**
- Modify: `src/renderer/src/components/KanbanBoard/TaskCard.tsx`

**Step 1: Add neon gradient border for running tasks**

For tasks in active pipeline stages (brainstorming, implementing, verifying, etc.), add:
```css
background: linear-gradient(var(--color-surface), var(--color-surface)) padding-box,
            linear-gradient(90deg, var(--color-accent-cyan), var(--color-accent-violet), var(--color-accent-cyan)) border-box;
border: 2px solid transparent;
background-size: 100% 100%, 200% 100%;
animation: neon-border-sweep 4s linear infinite;
```

This creates an animated gradient border that sweeps across the card edge.

**Step 2: Update the glow-pulse for intervention states**

Change the existing `glow-pulse` from gold to amber and slow to 3s:
Already updated in index.css (Task 2). Now apply: `animate-[glow-pulse_3s_ease-in-out_infinite]` and add `border-l-[3px] border-l-accent-amber` as static anchor.

**Step 3: Verify build**

Run: `pnpm run build`

**Step 4: Commit**

```bash
git add src/renderer/src/components/KanbanBoard/TaskCard.tsx
git commit -m "feat: add neon border pulse to active pipeline tasks"
```

---

### Task 16: Add glitch effect on error states and completion flash

**Files:**
- Modify: `src/renderer/src/components/KanbanBoard/TaskCard.tsx`

**Step 1: Add glitch class for blocked/error states**

When task status is `blocked`, apply a one-shot glitch:
```
className="animate-[glitch_0.3s_ease-in-out]"
```

Use a React key or state change to trigger the animation only on transition to blocked.

**Step 2: Add completion flash**

When a task transitions to `done`, briefly flash `bg-accent-green/10` overlay (200ms):
Add a `div` overlay with `animate-[fade-scale-out_0.2s_ease-out_forwards]` and `bg-accent-green/10` that plays once.

**Step 3: Verify build**

Run: `pnpm run build`

**Step 4: Commit**

```bash
git add src/renderer/src/components/KanbanBoard/TaskCard.tsx
git commit -m "feat: add glitch effect on blocked and completion flash"
```

---

### Task 17: Add scanline overlay and cyberpunk cursor

**Files:**
- Modify: `src/renderer/src/App.tsx`
- Modify: `src/renderer/src/components/Workshop/ConversationPanel.tsx`
- Modify: `src/renderer/src/components/Workshop/ThinkingDivider.tsx`

**Step 1: Add scanline class to App root**

Add `scanlines` class to the outermost div in App.tsx. This uses the CSS utility defined in Task 2.

Consider adding a setting toggle for this (can be added later via preferences).

**Step 2: Update Workshop streaming cursor**

In ConversationPanel or MessageBubble, change the streaming cursor from `w-1.5 h-4 bg-accent-teal/70 animate-pulse` to:
```
w-0.5 h-4 bg-accent-cyan shadow-[0_0_6px_rgba(0,229,255,0.5)] animate-[cursor-blink_1.2s_steps(1)_infinite]
```

**Step 3: Update ThinkingDivider dots**

Change `bg-accent-teal` → `bg-accent-cyan` with added `shadow-[0_0_4px_rgba(0,229,255,0.3)]` glow.

**Step 4: Verify build**

Run: `pnpm run build`

**Step 5: Commit**

```bash
git add -A
git commit -m "feat: add scanline overlay and cyberpunk cursor effects"
```

---

## Phase 5: Component Detail Pass

### Task 18: Update TaskDetail view

**Files:**
- Modify: `src/renderer/src/components/TaskDetail/TaskDetail.tsx`
- Modify: `src/renderer/src/components/TaskDetail/TaskTimeline.tsx`
- Modify: `src/renderer/src/components/TaskDetail/StageTabs.tsx`
- Modify: `src/renderer/src/components/TaskDetail/HandoffChain.tsx`
- Modify: `src/renderer/src/components/TaskDetail/AgentLog.tsx`
- Modify: `src/renderer/src/components/TaskDetail/TodoAccordion.tsx`

**Step 1: TaskTimeline — gradient connecting lines**

- Completed stages: connecting line becomes gradient `bg-gradient-to-r from-accent-cyan to-accent-green`
- Active stage: pulsing glow ring `shadow-[0_0_12px_rgba(0,229,255,0.3)]`
- Future stages: `border-dashed border-text-muted`

**Step 2: StageTabs — gradient underline on active**

Change `border-b-2 border-accent-teal` → `bg-gradient-to-r from-accent-cyan to-accent-violet h-0.5` as an absolute-positioned element under the active tab.

**Step 3: HandoffChain — glass highlight boxes**

Change `bg-accent-gold/10` highlights → `bg-accent-amber/10 backdrop-blur-sm border border-accent-amber/20`
Change `bg-accent-teal/10` highlights → `bg-accent-cyan/10 backdrop-blur-sm border border-accent-cyan/20`

**Step 4: AgentLog — update agent color map**

Replace `accent-mauve` → `accent-violet`, `accent-teal` → `accent-cyan`, `accent-gold` → `accent-amber` in the agent color map.

**Step 5: TodoAccordion — update accent colors**

Replace `text-accent-green`, `text-accent-teal animate-pulse` with new token names.

**Step 6: TaskDetail.tsx — update all inline styles and class maps**

Update tier/priority/event class maps to use new accent names. Update inline `colors.*` references. Add `font-mono` to live output area. Consider adding faint scanline overlay to the live output terminal area.

**Step 7: Verify build**

Run: `pnpm run build`

**Step 8: Commit**

```bash
git add src/renderer/src/components/TaskDetail/
git commit -m "feat: update TaskDetail view with gradient lines, glass highlights, new accents"
```

---

### Task 19: Update InterventionPanel components

**Files:**
- Modify: `src/renderer/src/components/InterventionPanel/InterventionPanel.tsx`
- Modify: `src/renderer/src/components/InterventionPanel/PlanReviewGate.tsx`
- Modify: `src/renderer/src/components/InterventionPanel/CodeReviewGate.tsx`
- Modify: `src/renderer/src/components/InterventionPanel/CircuitBreakerPanel.tsx`
- Modify: `src/renderer/src/components/InterventionPanel/OpenQuestionsPanel.tsx`

**Step 1: InterventionPanel wrapper — glass treatment**

Change `bg-surface border border-accent-gold` → `bg-surface/80 backdrop-blur-md border border-accent-amber/40`
Add `border-l-4 border-l-accent-amber` for amber gates, `border-l-accent-magenta` for circuit breakers, `border-l-accent-cyan` for questions.

**Step 2: Update all accent-gold → accent-amber, accent-red → accent-magenta, accent-teal → accent-cyan in all 4 sub-panels**

**Step 3: Update button colors**

- Approve buttons: `bg-accent-green`
- Reject/deny buttons: `bg-accent-magenta` or `border border-accent-magenta text-accent-magenta`
- Retry buttons: `bg-accent-cyan`
- Force advance: `border border-accent-amber text-accent-amber`

**Step 4: Verify build**

Run: `pnpm run build`

**Step 5: Commit**

```bash
git add src/renderer/src/components/InterventionPanel/
git commit -m "feat: update intervention panels with glass treatment and new accents"
```

---

### Task 20: Update Workshop message bubbles and modals

**Files:**
- Modify: `src/renderer/src/components/Workshop/MessageBubble.tsx`
- Modify: `src/renderer/src/components/Workshop/ChoicesModal.tsx`
- Modify: `src/renderer/src/components/Workshop/TaskSuggestionModal.tsx`
- Modify: `src/renderer/src/components/Workshop/PanelSessionModal.tsx`

**Step 1: MessageBubble**

- User messages: `bg-accent-teal/15` → `bg-accent-cyan/10 border border-accent-cyan/20`
- Assistant messages: keep `bg-surface border border-border`
- Streaming cursor: updated in Task 17
- Update `PERSONA_COLORS` map if it uses old accent names

**Step 2: ChoicesModal — update hover states**

`hover:border-accent-teal/50 hover:bg-accent-teal/5` → `hover:border-accent-cyan/50 hover:bg-accent-cyan/5`

**Step 3: TaskSuggestionModal — update tier/priority color maps**

Same changes as CreateTaskModal color maps.

**Step 4: PanelSessionModal — fix `bg-bg-secondary` (undefined token)**

Change `bg-bg-secondary` → `bg-surface`. Update `PERSONA_COLORS` if needed.

**Step 5: Verify build**

Run: `pnpm run build`

**Step 6: Commit**

```bash
git add src/renderer/src/components/Workshop/MessageBubble.tsx src/renderer/src/components/Workshop/ChoicesModal.tsx src/renderer/src/components/Workshop/TaskSuggestionModal.tsx src/renderer/src/components/Workshop/PanelSessionModal.tsx
git commit -m "feat: update Workshop bubbles and modals with new palette"
```

---

### Task 21: Update remaining common components

**Files:**
- Modify: `src/renderer/src/components/common/Toast.tsx`
- Modify: `src/renderer/src/components/common/ApprovalDialog.tsx`
- Modify: `src/renderer/src/components/common/Skeleton.tsx`
- Modify: `src/renderer/src/components/common/ErrorBoundary.tsx`

**Step 1: Toast — update accent border colors**

- Success: `border-l-accent-green text-accent-green`
- Error: `border-l-accent-magenta text-accent-magenta`
- Warning: `border-l-accent-amber text-accent-amber`
- Info: `border-l-accent-cyan text-accent-cyan`

**Step 2: ApprovalDialog — update colors**

- Tool icon: `bg-accent-violet/20 text-accent-violet` (replaces mauve)
- Tool name: `text-accent-violet font-mono`
- Allow: `bg-accent-green`
- Deny: `border-accent-magenta text-accent-magenta`

**Step 3: Skeleton — update pulse color**

`bg-elevated animate-pulse` → `bg-elevated/50 animate-pulse`

**Step 4: ErrorBoundary — update error colors**

`accent-red` → `accent-magenta` throughout

**Step 5: Verify build**

Run: `pnpm run build`

**Step 6: Commit**

```bash
git add src/renderer/src/components/common/
git commit -m "feat: update common components with new palette and glass effects"
```

---

### Task 22: Update Settings modal and remaining components

**Files:**
- Modify: `src/renderer/src/components/Settings/SettingsModal.tsx`
- Modify: `src/renderer/src/components/Dashboard/CreateTaskModal.tsx`
- Modify: `src/renderer/src/components/ProjectSelector/RegisterProjectModal.tsx`

**Step 1: SettingsModal**

- Glass treatment on sidebar: `bg-surface/60 backdrop-blur-lg border-r border-border/50`
- Toggle switch active: `bg-accent-cyan` with `shadow-[0_0_8px_rgba(0,229,255,0.2)]`
- Update all `accent-teal` → `accent-cyan` references
- Gradient fade dividers: replace `border-b border-border` with gradient line `bg-gradient-to-r from-border via-border-bright to-transparent h-px`

**Step 2: CreateTaskModal — update tier/priority button color maps**

Use new accent names:
- L1: `accent-green`, L2: `accent-cyan`, L3: `accent-violet`
- Priority: low `text-secondary`, medium `accent-amber`, high `accent-peach`, critical `accent-magenta`

**Step 3: RegisterProjectModal — update accent colors**

`focus:border-accent-teal` → `focus:border-accent-cyan`, button `bg-accent-teal` → `bg-accent-cyan`

**Step 4: Verify build**

Run: `pnpm run build`

**Step 5: Commit**

```bash
git add -A
git commit -m "feat: update Settings, CreateTask, and RegisterProject modals"
```

---

## Phase 6: Title Bar Accent Line and Final Polish

### Task 23: Add title bar gradient accent line

**Files:**
- Modify: `src/renderer/src/components/common/TitleBar.tsx` (if not already done in Task 8)

**Step 1: Verify the gradient accent line is present from Task 8**

The 1px gradient line (`accent-cyan → transparent → accent-magenta`) should be at the bottom of the TitleBar. If not present, add it.

**Step 2: Commit if changed**

---

### Task 24: Final build verification and visual QA

**Step 1: Full build**

Run: `pnpm run build`
Expected: Clean build, zero errors

**Step 2: Run the app**

Run: `pnpm run dev`

Visually verify each view:
- [ ] ProjectSelector: gradient CLAWFLOW heading, radial glow, glass project cards
- [ ] Dashboard: glass TopBar, gradient column headers, glass metric cards, staggered kanban cards
- [ ] TaskDetail: gradient timeline, glass intervention panels, mono live output
- [ ] Workshop: glass sidebar, new message bubble colors, cyberpunk cursor, tool call cards
- [ ] Git: consistent token usage, glass branch list
- [ ] Settings: glass modal, cyan toggles
- [ ] Modals: glass backdrop, fade-scale entrance
- [ ] Toasts: new accent colors
- [ ] Scanline overlay: visible but very subtle

**Step 3: Fix any visual issues found during QA**

**Step 4: Final commit**

```bash
git add -A
git commit -m "feat: complete Midnight Neon visual overhaul"
```
