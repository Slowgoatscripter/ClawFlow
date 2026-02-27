# Settings Modal Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a tabbed Settings modal (AI Models, Pipeline, Preferences) with global defaults and per-project overrides, triggered from the TopBar gear icon.

**Architecture:** New `settings` table in both global and project SQLite DBs. IPC handlers for CRUD. Zustand `settingsStore` in renderer. Pipeline engine reads merged settings (project overrides > global defaults) instead of hardcoded constants. Modal component uses existing `Modal` wrapper with tabbed layout.

**Tech Stack:** Electron IPC, better-sqlite3, Zustand, React, Tailwind CSS (Catppuccin dark theme)

---

### Task 1: Add `settings` table to global DB

**Files:**
- Modify: `src/main/db.ts` (after line 38, inside `getGlobalDb()`)

**Step 1: Add CREATE TABLE after projects table creation**

Add after the existing `migrateProjectsTable(globalDb)` call (~line 38):

```ts
globalDb.exec(`
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  )
`)
```

**Step 2: Run app to verify DB initializes without errors**

Run: `npx electron-vite dev`
Expected: App starts, no crash on DB init

**Step 3: Commit**

```
git add src/main/db.ts
git commit -m "feat(settings): add settings table to global DB"
```

---

### Task 2: Add `settings` table to project DB

**Files:**
- Modify: `src/main/db.ts` (inside `initProjectDb()`, after last CREATE TABLE ~line 186)

**Step 1: Add CREATE TABLE in initProjectDb()**

Add after the last `migrate*Table()` call inside `initProjectDb()`:

```ts
db.exec(`
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  )
`)
```

**Step 2: Commit**

```
git add src/main/db.ts
git commit -m "feat(settings): add settings table to project DB"
```

---

### Task 3: Add DB helper functions for settings

**Files:**
- Modify: `src/main/db.ts` (add exported functions at bottom)

**Step 1: Add CRUD functions**

```ts
// Settings helpers

export function getGlobalSetting(key: string): string | null {
  const db = getGlobalDb()
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined
  return row?.value ?? null
}

export function getAllGlobalSettings(): Record<string, string> {
  const db = getGlobalDb()
  const rows = db.prepare('SELECT key, value FROM settings').all() as { key: string; value: string }[]
  return Object.fromEntries(rows.map(r => [r.key, r.value]))
}

export function setGlobalSetting(key: string, value: string): void {
  const db = getGlobalDb()
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = ?').run(key, value, value)
}

export function deleteGlobalSetting(key: string): void {
  const db = getGlobalDb()
  db.prepare('DELETE FROM settings WHERE key = ?').run(key)
}

export function getProjectSetting(dbPath: string, key: string): string | null {
  const db = getProjectDb(dbPath)
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined
  return row?.value ?? null
}

export function getAllProjectSettings(dbPath: string): Record<string, string> {
  const db = getProjectDb(dbPath)
  const rows = db.prepare('SELECT key, value FROM settings').all() as { key: string; value: string }[]
  return Object.fromEntries(rows.map(r => [r.key, r.value]))
}

export function setProjectSetting(dbPath: string, key: string, value: string): void {
  const db = getProjectDb(dbPath)
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = ?').run(key, value, value)
}

export function deleteProjectSetting(dbPath: string, key: string): void {
  const db = getProjectDb(dbPath)
  db.prepare('DELETE FROM settings WHERE key = ?').run(key)
}
```

**Step 2: Commit**

```
git add src/main/db.ts
git commit -m "feat(settings): add DB helper functions for settings CRUD"
```

---

### Task 4: Add settings IPC handlers

**Files:**
- Modify: `src/main/ipc-handlers.ts` (add inside `registerIpcHandlers()`)

**Step 1: Add imports at top of file**

```ts
import {
  getGlobalSetting, getAllGlobalSettings, setGlobalSetting, deleteGlobalSetting,
  getProjectSetting, getAllProjectSettings, setProjectSetting, deleteProjectSetting
} from './db'
```

**Step 2: Add IPC handlers inside registerIpcHandlers()**

```ts
// Settings
ipcMain.handle('settings:get-all-global', () => getAllGlobalSettings())
ipcMain.handle('settings:get-global', (_e, key: string) => getGlobalSetting(key))
ipcMain.handle('settings:set-global', (_e, key: string, value: string) => setGlobalSetting(key, value))
ipcMain.handle('settings:delete-global', (_e, key: string) => deleteGlobalSetting(key))
ipcMain.handle('settings:get-all-project', (_e, dbPath: string) => getAllProjectSettings(dbPath))
ipcMain.handle('settings:get-project', (_e, dbPath: string, key: string) => getProjectSetting(dbPath, key))
ipcMain.handle('settings:set-project', (_e, dbPath: string, key: string, value: string) => setProjectSetting(dbPath, key, value))
ipcMain.handle('settings:delete-project', (_e, dbPath: string, key: string) => deleteProjectSetting(dbPath, key))
```

**Step 3: Commit**

```
git add src/main/ipc-handlers.ts
git commit -m "feat(settings): add IPC handlers for settings CRUD"
```

---

### Task 5: Expose settings IPC in preload

**Files:**
- Modify: `src/preload/index.ts` (add `settings` namespace in `contextBridge.exposeInMainWorld`)
- Modify: TypeScript declarations file for `window.api`

**Step 1: Add settings namespace**

Add alongside existing namespaces (`projects`, `tasks`, `pipeline`, `workshop`, `git`, `fs`, `window`):

```ts
settings: {
  getAllGlobal: () => ipcRenderer.invoke('settings:get-all-global'),
  getGlobal: (key: string) => ipcRenderer.invoke('settings:get-global', key),
  setGlobal: (key: string, value: string) => ipcRenderer.invoke('settings:set-global', key, value),
  deleteGlobal: (key: string) => ipcRenderer.invoke('settings:delete-global', key),
  getAllProject: (dbPath: string) => ipcRenderer.invoke('settings:get-all-project', dbPath),
  getProject: (dbPath: string, key: string) => ipcRenderer.invoke('settings:get-project', dbPath, key),
  setProject: (dbPath: string, key: string, value: string) => ipcRenderer.invoke('settings:set-project', dbPath, key, value),
  deleteProject: (dbPath: string, key: string) => ipcRenderer.invoke('settings:delete-project', dbPath, key),
},
```

**Step 2: Update TypeScript declarations**

Find the type declarations file for `window.api` and add the `settings` type:

```ts
settings: {
  getAllGlobal: () => Promise<Record<string, string>>
  getGlobal: (key: string) => Promise<string | null>
  setGlobal: (key: string, value: string) => Promise<void>
  deleteGlobal: (key: string) => Promise<void>
  getAllProject: (dbPath: string) => Promise<Record<string, string>>
  getProject: (dbPath: string, key: string) => Promise<string | null>
  setProject: (dbPath: string, key: string, value: string) => Promise<void>
  deleteProject: (dbPath: string, key: string) => Promise<void>
}
```

**Step 3: Commit**

```
git add src/preload/index.ts
git commit -m "feat(settings): expose settings IPC in preload bridge"
```

---

### Task 6: Define settings types and defaults

**Files:**
- Create: `src/shared/settings.ts`

**Step 1: Create shared settings types and defaults**

```ts
import { STAGE_CONFIGS, type PipelineStage } from './constants'

// Setting Keys

export const SETTING_KEYS = {
  GLOBAL_MODEL: 'ai.globalModel',
  WORKSHOP_MODEL: 'ai.workshopModel',
  STAGE_MODEL_PREFIX: 'ai.stage.model.',
  STAGE_MAX_TURNS_PREFIX: 'pipeline.maxTurns.',
  STAGE_TIMEOUT_PREFIX: 'pipeline.timeout.',
  STAGE_AUTO_APPROVE_PREFIX: 'pipeline.autoApprove.',
  UI_ACTIVITY_FEED: 'ui.activityFeedDefault',
  UI_DENSITY: 'ui.density',
  UI_FONT_SIZE: 'ui.fontSize',
} as const

// Types

export type ModelOption = 'claude-opus-4-6' | 'claude-sonnet-4-6' | 'claude-haiku-4-5-20251001'

export const MODEL_OPTIONS: { value: ModelOption; label: string }[] = [
  { value: 'claude-opus-4-6', label: 'Claude Opus 4.6' },
  { value: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6' },
  { value: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5' },
]

export type UIDensity = 'comfortable' | 'compact'
export type UIFontSize = 'small' | 'medium' | 'large'

export interface SettingsState {
  globalModel: ModelOption
  workshopModel: ModelOption
  stageModels: Partial<Record<PipelineStage, ModelOption>>
  stageMaxTurns: Partial<Record<PipelineStage, number>>
  stageTimeouts: Partial<Record<PipelineStage, number>>
  stageAutoApprove: Partial<Record<PipelineStage, number | null>>
  activityFeedDefault: boolean
  density: UIDensity
  fontSize: UIFontSize
}

// Defaults (derived from STAGE_CONFIGS)

export const DEFAULT_SETTINGS: SettingsState = {
  globalModel: 'claude-opus-4-6',
  workshopModel: 'claude-sonnet-4-6',
  stageModels: {},
  stageMaxTurns: {},
  stageTimeouts: {},
  stageAutoApprove: {},
  activityFeedDefault: true,
  density: 'comfortable',
  fontSize: 'medium',
}

// Helpers

export function getEffectiveModel(stage: PipelineStage, settings: SettingsState): string {
  return settings.stageModels[stage] ?? settings.globalModel
}

export function getEffectiveMaxTurns(stage: PipelineStage, settings: SettingsState): number {
  return settings.stageMaxTurns[stage] ?? STAGE_CONFIGS[stage].maxTurns
}

export function getEffectiveTimeout(stage: PipelineStage, settings: SettingsState): number {
  return settings.stageTimeouts[stage] ?? STAGE_CONFIGS[stage].timeoutMs
}

export function getEffectiveAutoApprove(stage: PipelineStage, settings: SettingsState): number | null {
  const override = settings.stageAutoApprove[stage]
  if (override !== undefined) return override
  return STAGE_CONFIGS[stage].autoApproveThreshold
}
```

**Step 2: Commit**

```
git add src/shared/settings.ts
git commit -m "feat(settings): define settings types, keys, and defaults"
```

---

### Task 7: Create settingsStore (Zustand)

**Files:**
- Create: `src/renderer/src/stores/settingsStore.ts`

**Step 1: Create the store**

Follow the exact Zustand pattern used in other stores (layoutStore, taskStore, etc.). The store should:

- Extend `SettingsState` with actions
- Include `settingsModalOpen` boolean + `openSettingsModal`/`closeSettingsModal` toggles
- `loadGlobalSettings()` — reads all global settings via IPC, parses prefixed keys into the correct state shape
- `loadProjectSettings(dbPath)` — loads global first, then overlays project overrides
- Individual setters for each setting that persist via IPC immediately (no save button)
- `resetToDefaults()` — deletes all settings from global DB and resets state

All setters should: (1) call the IPC to persist, (2) update local Zustand state.

Import types from `src/shared/settings.ts`.

**Step 2: Commit**

```
git add src/renderer/src/stores/settingsStore.ts
git commit -m "feat(settings): create settingsStore with IPC persistence"
```

---

### Task 8: Build SettingsModal component

**Files:**
- Create: `src/renderer/src/components/Settings/SettingsModal.tsx`

**Step 1: Create the tabbed modal component**

Build a modal using the existing `Modal` wrapper pattern from `src/renderer/src/components/common/Modal.tsx`. The modal should:

- Use a wider container (`max-w-3xl`) than the default Modal
- Have a left sidebar with three tabs: AI Models, Pipeline, Preferences
- Render the active tab content panel on the right
- Match the Catppuccin dark theme (bg-surface, text-text-primary, border-border, accent-blue)
- Read `settingsModalOpen` from settingsStore — render nothing when closed

The component should be self-contained with internal tab state, importing from `settingsStore` for all data and actions.

**Tab 1 — AI Models:**
- "Global Default Model" dropdown with MODEL_OPTIONS
- Table of pipeline stages, each with a model dropdown (options: "Use Global Default" + MODEL_OPTIONS)
- "Workshop Model" dropdown

**Tab 2 — Pipeline:**
- Table with columns: Stage | Max Turns | Timeout (min) | Auto-Approve
- Number inputs for each, pre-filled from store (falling back to STAGE_CONFIGS defaults)
- "Reset to Defaults" button at bottom

**Tab 3 — Preferences:**
- Activity feed toggle (on/off)
- Density radio group (comfortable / compact)
- Font size radio group (small / medium / large)

All inputs should call the corresponding settingsStore action on change (immediate save, no separate "Save" button needed).

**Step 2: Commit**

```
git add src/renderer/src/components/Settings/SettingsModal.tsx
git commit -m "feat(settings): build tabbed SettingsModal component"
```

---

### Task 9: Wire Settings modal into TopBar

**Files:**
- Modify: `src/renderer/src/components/Dashboard/TopBar.tsx`

**Step 1: Import settingsStore and add onClick**

Add import:
```ts
import { useSettingsStore } from '../../stores/settingsStore'
```

Inside the component, add:
```ts
const openSettingsModal = useSettingsStore((s) => s.openSettingsModal)
```

Add `onClick` to the existing settings button (~line 126):
```tsx
<button
  onClick={openSettingsModal}
  className="text-text-secondary hover:text-text-primary transition-colors cursor-pointer p-1"
  aria-label="Settings"
>
```

**Step 2: Render SettingsModal**

Import and render the modal at the bottom of the TopBar return (alongside CreateTaskModal):
```tsx
import { SettingsModal } from '../Settings/SettingsModal'

// In return, after CreateTaskModal:
<SettingsModal />
```

The SettingsModal reads `settingsModalOpen` from the store internally and renders nothing when closed.

**Step 3: Commit**

```
git add src/renderer/src/components/Dashboard/TopBar.tsx
git commit -m "feat(settings): wire settings modal into TopBar gear icon"
```

---

### Task 10: Load settings on app startup

**Files:**
- Modify: `src/renderer/src/App.tsx`

**Step 1: Add useEffect to load settings**

```ts
import { useSettingsStore } from './stores/settingsStore'

// Inside App component:
const loadGlobalSettings = useSettingsStore((s) => s.loadGlobalSettings)

useEffect(() => {
  loadGlobalSettings()
}, [])
```

**Step 2: Commit**

```
git add src/renderer/src/App.tsx
git commit -m "feat(settings): load global settings on app startup"
```

---

### Task 11: Integrate settings into pipeline engine

**Files:**
- Modify: `src/main/pipeline-engine.ts`

**Step 1: Add helper to read effective settings for a stage**

Import DB helpers and settings types:
```ts
import { getGlobalSetting, getProjectSetting } from './db'
import { SETTING_KEYS } from '../shared/settings'
```

Create a helper function that reads the effective config for a stage, checking project overrides first, then global, then falling back to STAGE_CONFIGS:

```ts
function getEffectiveStageConfig(stage: PipelineStage, dbPath: string): StageConfig {
  const base = STAGE_CONFIGS[stage]

  const projectModel = getProjectSetting(dbPath, SETTING_KEYS.STAGE_MODEL_PREFIX + stage)
  const globalModel = getGlobalSetting(SETTING_KEYS.STAGE_MODEL_PREFIX + stage)
  const globalDefault = getGlobalSetting(SETTING_KEYS.GLOBAL_MODEL)

  const projectTurns = getProjectSetting(dbPath, SETTING_KEYS.STAGE_MAX_TURNS_PREFIX + stage)
  const globalTurns = getGlobalSetting(SETTING_KEYS.STAGE_MAX_TURNS_PREFIX + stage)

  const projectTimeout = getProjectSetting(dbPath, SETTING_KEYS.STAGE_TIMEOUT_PREFIX + stage)
  const globalTimeout = getGlobalSetting(SETTING_KEYS.STAGE_TIMEOUT_PREFIX + stage)

  const projectAutoApprove = getProjectSetting(dbPath, SETTING_KEYS.STAGE_AUTO_APPROVE_PREFIX + stage)
  const globalAutoApprove = getGlobalSetting(SETTING_KEYS.STAGE_AUTO_APPROVE_PREFIX + stage)

  return {
    ...base,
    model: projectModel ?? globalModel ?? globalDefault ?? base.model,
    maxTurns: Number(projectTurns ?? globalTurns ?? base.maxTurns),
    timeoutMs: Number(projectTimeout ?? globalTimeout ?? base.timeoutMs),
    autoApproveThreshold: projectAutoApprove != null
      ? (projectAutoApprove === 'null' ? null : Number(projectAutoApprove))
      : globalAutoApprove != null
        ? (globalAutoApprove === 'null' ? null : Number(globalAutoApprove))
        : base.autoApproveThreshold,
  }
}
```

**Step 2: Replace STAGE_CONFIGS reads in runStage()**

In `runStage()` (~line 326), replace:
```ts
const stageConfig = STAGE_CONFIGS[stage]
```
with:
```ts
const stageConfig = getEffectiveStageConfig(stage, task.dbPath)
```

Do the same for all other `STAGE_CONFIGS[stage]` usages (lines 157, 498). Pass `dbPath` through where needed.

**Step 3: Commit**

```
git add src/main/pipeline-engine.ts
git commit -m "feat(settings): pipeline engine reads user settings with fallback to defaults"
```

---

### Task 12: Integrate settings into workshop engine

**Files:**
- Modify: `src/main/workshop-engine.ts`

**Step 1: Replace hardcoded model strings**

Import DB helpers:
```ts
import { getGlobalSetting } from './db'
import { SETTING_KEYS } from '../shared/settings'
```

Create a helper:
```ts
function getWorkshopModel(): string {
  return getGlobalSetting(SETTING_KEYS.WORKSHOP_MODEL) ?? 'claude-sonnet-4-6'
}
```

Replace the hardcoded `'claude-sonnet-4-20250514'` at lines 188, 304, 393 with `getWorkshopModel()`.

(The haiku usages at lines 101, 252 are for lightweight utility tasks like naming/summarizing and can stay hardcoded.)

**Step 2: Commit**

```
git add src/main/workshop-engine.ts
git commit -m "feat(settings): workshop engine reads model from settings"
```

---

### Task 13: Apply UI preference settings

**Files:**
- Modify: `src/renderer/src/App.tsx`
- Modify: `src/renderer/src/index.css` (add density/font-size CSS custom properties)

**Step 1: Add CSS custom properties for density and font size**

In `index.css`, add utility classes:
```css
.density-comfortable { --spacing-scale: 1; }
.density-compact { --spacing-scale: 0.75; }

.font-size-small { font-size: 13px; }
.font-size-medium { font-size: 14px; }
.font-size-large { font-size: 16px; }
```

**Step 2: Apply classes in App.tsx based on settings**

Read `density` and `fontSize` from `settingsStore` and apply as className on the root div.

**Step 3: Apply activityFeedDefault**

When loading settings, if `activityFeedDefault` is false, set `layoutStore.activityFeedOpen` to false.

**Step 4: Commit**

```
git add src/renderer/src/App.tsx src/renderer/src/index.css
git commit -m "feat(settings): apply UI density and font size preferences"
```

---

### Task 14: Build and verify end-to-end

**Step 1: Build the app**

Run: `pnpm build` or `npm run build`
Expected: Clean build, no type errors

**Step 2: Manual test checklist**

- Click gear icon -> Settings modal opens
- Change global model -> persists after closing/reopening modal
- Change a pipeline stage model override -> verify it shows correctly
- Adjust pipeline max turns -> verify it saves
- Toggle UI preferences -> verify they apply immediately
- Close and reopen app -> verify all settings persisted

**Step 3: Final commit if any fixes needed**

```
git add -A
git commit -m "fix(settings): address integration issues from testing"
```
