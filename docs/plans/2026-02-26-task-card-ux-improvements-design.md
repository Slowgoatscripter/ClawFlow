# Task Card UX Improvements Design

**Date:** 2026-02-26
**Status:** Approved

## Overview

Three UX improvements to the Kanban board task cards:
1. Pulsing gold glow on cards awaiting plan approval
2. Collapsible Done column with per-card and bulk archive
3. Newest-first sorting across all columns

## 1. Awaiting Approval Glow (Kanban Card)

**Trigger:** Task is in `awaitingReview` state — derived from `pipelineStore.awaitingReview[taskId]` (ephemeral boolean from IPC status events) OR `isAwaitingReviewFromHandoffs(task)` (checks last handoff status vs current task status).

**Effect:** Soft pulsing gold (`accent-gold` / `#f9e2af`) box-shadow glow on the `TaskCard` in the Kanban board. Breathing animation on a ~2s cycle using CSS `@keyframes`.

**Implementation:**
- Add a `@keyframes glow-pulse` animation in `index.css` using `box-shadow` with `accent-gold`
- Expose `awaitingReview` state to `TaskCard` component (currently only used in `TaskDetail`)
- Apply animation class conditionally when task is awaiting review
- Separate from existing `animate-pulse` gold dot for active agents

## 2. Collapsible Done Column

**Default state:** Collapsed — shows header "Done (N)" with chevron toggle.

**Expanded:** Click to reveal all done cards, sorted newest-first by `completedAt`.

**State management:** Local component state (not persisted across sessions). Defaults to collapsed.

**UI:** Chevron icon rotates on toggle. Smooth height transition for expand/collapse.

## 3. Archive System

### Data Model
- New `archivedAt: string | null` field on the `Task` interface
- Archived tasks filtered out of Kanban board columns

### Per-Card Archive
- Small archive icon button on each done card
- Only visible on cards in the Done column

### Bulk Archive
- "Archive All" button in the Done column header
- Archives all non-archived done tasks at once

### Archive Drawer
- Icon button in the main UI header/sidebar area
- Opens a slide-out drawer panel from the right
- Shows all archived tasks sorted newest-first
- Each archived task shows: title, tier, completed date
- Unarchive button to move tasks back to Done column
- Click to view task detail (same as board)

## 4. Newest-First Sorting

**All columns** sort cards with most recently active tasks at the top.

**Sort keys by column:**
- Active columns (backlog through verifying): `startedAt` descending, fallback to `createdAt`
- Done column: `completedAt` descending
- Fallback: `createdAt` descending

## Technical Notes

- All styling uses Tailwind utility classes + custom theme tokens (Catppuccin-inspired)
- Existing color tokens: `accent-gold` (#f9e2af), `accent-green` (#a6e3a1), `accent-teal` (#89b4fa)
- Key files: `TaskCard.tsx`, `KanbanBoard.tsx`, `KanbanColumn.tsx`, `pipelineStore.ts`, `index.css`
- The `awaitingReview` derivation logic already exists in stores — needs to be piped to card level
