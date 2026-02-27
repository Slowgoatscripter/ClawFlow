# Settings Modal Design

**Date:** 2026-02-26
**Status:** Approved

## Overview

Add a Settings modal to ClawFlow, accessible from the gear icon in the TopBar. The modal provides control over AI model selection, pipeline tuning, and UI preferences with global defaults and per-project overrides.

## Modal Structure

Centered overlay modal with left-side tab navigation. Three tabs:

### Tab 1: AI Models

- **Global default model** — dropdown: Opus / Sonnet / Haiku
- **Per-stage overrides** — table with each pipeline stage (Brainstorm, Design Review, Plan, Implement, Code Review, Verify) and an optional model dropdown defaulting to "Use global default"
- **Workshop model** — separate dropdown for the workshop chat engine

### Tab 2: Pipeline

Per-stage config table with editable columns:

| Column | Type | Description |
|--------|------|-------------|
| Stage | Label | Pipeline stage name (read-only) |
| Max Turns | Number input | Max agent turns before stopping |
| Timeout | Number input (minutes) | Stage timeout duration |
| Auto-Approve Threshold | Number input (0-5) | Confidence score for auto-approval |

- Pre-filled with current hardcoded defaults from `STAGE_CONFIGS`
- "Reset to Defaults" button to restore hardcoded values

### Tab 3: Preferences

- Activity feed default state (open / closed on launch)
- UI density (comfortable / compact)
- Font size (small / medium / large)

## Scope: Global vs Per-Project

- **Global settings** stored in `~/.clawflow/clawflow.db` (new `settings` table)
- **Per-project overrides** stored in project DB (`~/.clawflow/dbs/{project}.db`)
- When a project is selected, a "Project Override" toggle appears at the top of each tab
- Pipeline engine reads project settings first, falls back to global

## Persistence

- New `settings` table: `key TEXT PRIMARY KEY, value TEXT` (JSON-serialized)
- Added to both global and project DB schemas
- New `settingsStore` (Zustand) manages state and syncs via IPC
- Settings loaded on app startup; project overrides loaded on project switch

## Entry Point

- Gear icon in `TopBar.tsx` (lines 126-144) gets an `onClick` handler
- Opens the Settings modal as an overlay

## Tech

- React modal component with Tailwind CSS (Catppuccin dark theme)
- Zustand store for client state
- IPC handlers for read/write to SQLite
- Pipeline engine updated to read from settings instead of hardcoded constants
