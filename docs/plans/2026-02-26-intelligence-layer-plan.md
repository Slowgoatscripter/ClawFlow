# Intelligence Layer Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a unified Intelligence Layer to ClawFlow — domain knowledge store, FDRL, validation hooks, two-strike intelligence, native skills system, and auto-merge on completion.

**Architecture:** Six features wired into one data flow. Knowledge store is the foundation. FDRL feeds it. Skills guide agents. Validation hooks enforce quality. Two-strike makes rejections smarter. Auto-merge closes the loop.

**Tech Stack:** Electron + better-sqlite3, TypeScript, React + Zustand, ClawFlow SDK pipeline

**Design Doc:** `docs/plans/2026-02-26-intelligence-layer-design.md`

---

## Phase 1: Data Foundation

### Task 1: Domain Knowledge Database Schema

**Files:**
- Modify: `src/main/db.ts` (after line 210, add new table + migration)
- Create: `src/shared/knowledge-types.ts`

**Step 1: Create knowledge types**

Create `src/shared/knowledge-types.ts`:

```ts
export type KnowledgeCategory = 'business_rule' | 'architecture' | 'api_quirk' | 'lesson_learned' | 'convention'
export type KnowledgeSource = 'workshop' | 'pipeline' | 'manual' | 'fdrl'
export type KnowledgeStatus = 'candidate' | 'active' | 'archived'

export interface KnowledgeEntry {
  id: string
  key: string
  summary: string
  content: string
  category: KnowledgeCategory
  tags: string[]
  source: KnowledgeSource
  sourceId: string | null
  status: KnowledgeStatus
  tokenEstimate: number
  createdAt: string
  updatedAt: string
}
```

**Step 2: Add domain_knowledge table to project DB**

In `src/main/db.ts`, inside `initProjectDb()` after the `task_dependencies` CREATE TABLE block (after line 210), add:

```ts
db.exec(`
  CREATE TABLE IF NOT EXISTS domain_knowledge (
    id TEXT PRIMARY KEY,
    key TEXT NOT NULL,
    summary TEXT NOT NULL,
    content TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT 'convention',
    tags TEXT DEFAULT '[]',
    source TEXT NOT NULL DEFAULT 'manual',
    source_id TEXT,
    status TEXT NOT NULL DEFAULT 'active',
    token_estimate INTEGER DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )
`)
```

**Step 3: Add global_knowledge table to global DB**

In `src/main/db.ts`, inside `getGlobalDb()` after the `settings` CREATE TABLE block (after line 43), add the same CREATE TABLE but named `global_knowledge`.

**Step 4: Build and verify no errors**

Run: `npm run build`
Expected: Clean build, no type errors.

**Step 5: Commit**

```bash
git add src/shared/knowledge-types.ts src/main/db.ts
git commit -m "feat(intelligence): add domain_knowledge and global_knowledge DB tables"
```

---

### Task 2: KnowledgeEngine Service

**Files:**
- Create: `src/main/knowledge-engine.ts`

**Step 1: Create the KnowledgeEngine**

Create `src/main/knowledge-engine.ts`:

```ts
import { v4 as uuidv4 } from 'uuid'
import { getGlobalDb, getProjectDb } from './db'
import { KnowledgeEntry, KnowledgeCategory, KnowledgeSource, KnowledgeStatus } from '../shared/knowledge-types'

// ── CRUD ──

export function createKnowledgeEntry(
  dbPath: string,
  entry: {
    key: string
    summary: string
    content: string
    category: KnowledgeCategory
    tags?: string[]
    source: KnowledgeSource
    sourceId?: string
    status?: KnowledgeStatus
  }
): KnowledgeEntry {
  const db = getProjectDb(dbPath)
  const id = uuidv4()
  const now = new Date().toISOString()
  const tokenEstimate = Math.ceil(entry.content.length / 4)
  const status = entry.status ?? 'active'
  const tags = JSON.stringify(entry.tags ?? [])

  db.prepare(`
    INSERT INTO domain_knowledge (id, key, summary, content, category, tags, source, source_id, status, token_estimate, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, entry.key, entry.summary, entry.content, entry.category, tags, entry.source, entry.sourceId ?? null, status, tokenEstimate, now, now)

  return getKnowledgeEntry(dbPath, id)!
}

export function createGlobalKnowledgeEntry(
  entry: {
    key: string
    summary: string
    content: string
    category: KnowledgeCategory
    tags?: string[]
    source: KnowledgeSource
    sourceId?: string
  }
): KnowledgeEntry {
  const db = getGlobalDb()
  const id = uuidv4()
  const now = new Date().toISOString()
  const tokenEstimate = Math.ceil(entry.content.length / 4)
  const tags = JSON.stringify(entry.tags ?? [])

  db.prepare(`
    INSERT INTO global_knowledge (id, key, summary, content, category, tags, source, source_id, status, token_estimate, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)
  `).run(id, entry.key, entry.summary, entry.content, entry.category, tags, entry.source, entry.sourceId ?? null, tokenEstimate, now, now)

  return getGlobalKnowledgeEntry(id)!
}

export function getKnowledgeEntry(dbPath: string, id: string): KnowledgeEntry | null {
  const db = getProjectDb(dbPath)
  const row = db.prepare('SELECT * FROM domain_knowledge WHERE id = ?').get(id) as any
  return row ? rowToEntry(row) : null
}

export function getGlobalKnowledgeEntry(id: string): KnowledgeEntry | null {
  const db = getGlobalDb()
  const row = db.prepare('SELECT * FROM global_knowledge WHERE id = ?').get(id) as any
  return row ? rowToEntry(row) : null
}

export function getKnowledgeByKey(dbPath: string, key: string): KnowledgeEntry | null {
  const db = getProjectDb(dbPath)
  const row = db.prepare('SELECT * FROM domain_knowledge WHERE key = ? AND status = ?').get(key, 'active') as any
  return row ? rowToEntry(row) : null
}

export function listKnowledge(dbPath: string, options?: { category?: KnowledgeCategory; status?: KnowledgeStatus }): KnowledgeEntry[] {
  const db = getProjectDb(dbPath)
  let query = 'SELECT * FROM domain_knowledge WHERE 1=1'
  const params: any[] = []

  if (options?.category) { query += ' AND category = ?'; params.push(options.category) }
  if (options?.status) { query += ' AND status = ?'; params.push(options.status) }
  else { query += " AND status != 'archived'" }

  query += ' ORDER BY updated_at DESC'
  return (db.prepare(query).all(...params) as any[]).map(rowToEntry)
}

export function listGlobalKnowledge(): KnowledgeEntry[] {
  const db = getGlobalDb()
  return (db.prepare("SELECT * FROM global_knowledge WHERE status = 'active' ORDER BY updated_at DESC").all() as any[]).map(rowToEntry)
}

export function updateKnowledgeEntry(
  dbPath: string,
  id: string,
  updates: Partial<Pick<KnowledgeEntry, 'content' | 'summary' | 'tags' | 'status' | 'category'>>
): KnowledgeEntry | null {
  const db = getProjectDb(dbPath)
  const sets: string[] = ['updated_at = ?']
  const params: any[] = [new Date().toISOString()]

  if (updates.content !== undefined) {
    sets.push('content = ?', 'token_estimate = ?')
    params.push(updates.content, Math.ceil(updates.content.length / 4))
  }
  if (updates.summary !== undefined) { sets.push('summary = ?'); params.push(updates.summary) }
  if (updates.tags !== undefined) { sets.push('tags = ?'); params.push(JSON.stringify(updates.tags)) }
  if (updates.status !== undefined) { sets.push('status = ?'); params.push(updates.status) }
  if (updates.category !== undefined) { sets.push('category = ?'); params.push(updates.category) }

  params.push(id)
  db.prepare(`UPDATE domain_knowledge SET ${sets.join(', ')} WHERE id = ?`).run(...params)
  return getKnowledgeEntry(dbPath, id)
}

export function deleteKnowledgeEntry(dbPath: string, id: string): void {
  const db = getProjectDb(dbPath)
  db.prepare('DELETE FROM domain_knowledge WHERE id = ?').run(id)
}

// ── Candidate management (FDRL) ──

export function listCandidates(dbPath: string, taskId?: number): KnowledgeEntry[] {
  const db = getProjectDb(dbPath)
  let query = "SELECT * FROM domain_knowledge WHERE status = 'candidate'"
  const params: any[] = []
  if (taskId !== undefined) {
    query += ' AND source_id = ?'
    params.push(String(taskId))
  }
  query += ' ORDER BY created_at DESC'
  return (db.prepare(query).all(...params) as any[]).map(rowToEntry)
}

export function promoteCandidate(dbPath: string, id: string, global: boolean): KnowledgeEntry | null {
  const entry = updateKnowledgeEntry(dbPath, id, { status: 'active' })
  if (entry && global) {
    createGlobalKnowledgeEntry({
      key: entry.key,
      summary: entry.summary,
      content: entry.content,
      category: entry.category,
      tags: entry.tags,
      source: entry.source,
      sourceId: entry.sourceId ?? undefined
    })
  }
  return entry
}

export function discardCandidate(dbPath: string, id: string): void {
  updateKnowledgeEntry(dbPath, id, { status: 'archived' })
}

// ── Summary Index ──

export function buildKnowledgeIndex(dbPath: string): string {
  const projectEntries = listKnowledge(dbPath, { status: 'active' })
  const globalEntries = listGlobalKnowledge()

  if (projectEntries.length === 0 && globalEntries.length === 0) return ''

  let index = `## Domain Knowledge Index\nProject: ${projectEntries.length} entries | Global: ${globalEntries.length} entries\n`

  if (projectEntries.length > 0) {
    index += '\n### Project Knowledge\n'
    for (const e of projectEntries) {
      index += `- [${e.key}] ${e.summary}\n`
    }
  }

  if (globalEntries.length > 0) {
    index += '\n### Global Knowledge\n'
    for (const e of globalEntries) {
      index += `- [${e.key}] ${e.summary}\n`
    }
  }

  index += '\nUse fetch_knowledge(key_or_id) to read full details on any entry.\n'
  return index
}

// ── Helpers ──

function rowToEntry(row: any): KnowledgeEntry {
  return {
    id: row.id,
    key: row.key,
    summary: row.summary,
    content: row.content,
    category: row.category,
    tags: JSON.parse(row.tags || '[]'),
    source: row.source,
    sourceId: row.source_id,
    status: row.status,
    tokenEstimate: row.token_estimate,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}
```

**Step 2: Add uuid dependency (if not present)**

Run: `pnpm add uuid && pnpm add -D @types/uuid`

**Step 3: Build and verify**

Run: `npm run build`
Expected: Clean build.

**Step 4: Commit**

```bash
git add src/main/knowledge-engine.ts package.json pnpm-lock.yaml
git commit -m "feat(intelligence): add KnowledgeEngine service with CRUD, candidates, and index builder"
```

---

### Task 3: Skill Loader Service

**Files:**
- Create: `src/main/skill-loader.ts`
- Create: `src/shared/skill-types.ts`

**Step 1: Create skill types**

Create `src/shared/skill-types.ts`:

```ts
export interface SkillInfo {
  name: string
  hasCore: boolean
  hasExtended: boolean
  coreTokenEstimate: number
  extendedTokenEstimate: number
}

export const STAGE_SKILL_MAP: Record<string, string> = {
  brainstorm: 'brainstorming',
  design_review: 'design-review',
  plan: 'writing-plans',
  implement: 'test-driven-development',
  code_review: 'code-review',
  verify: 'verification',
  done: 'completion'
}
```

**Step 2: Create the SkillLoader**

Create `src/main/skill-loader.ts`:

```ts
import * as fs from 'fs'
import * as path from 'path'
import { homedir } from 'os'
import { SkillInfo, STAGE_SKILL_MAP } from '../shared/skill-types'
import { getGlobalSetting, getProjectSetting } from './db'

const SKILLS_DIR = path.join(homedir(), '.clawflow', 'skills')
const DEFAULTS_DIR = path.join(__dirname, '..', 'skills', 'defaults')

// ── Initialization ──

export function ensureSkillsSeeded(): void {
  if (!fs.existsSync(SKILLS_DIR)) {
    fs.mkdirSync(SKILLS_DIR, { recursive: true })
  }

  if (!fs.existsSync(DEFAULTS_DIR)) return

  const defaults = fs.readdirSync(DEFAULTS_DIR).filter(f =>
    fs.statSync(path.join(DEFAULTS_DIR, f)).isDirectory()
  )

  for (const skillName of defaults) {
    const targetDir = path.join(SKILLS_DIR, skillName)
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true })
      const srcDir = path.join(DEFAULTS_DIR, skillName)
      for (const file of fs.readdirSync(srcDir)) {
        fs.copyFileSync(path.join(srcDir, file), path.join(targetDir, file))
      }
    }
  }
}

// ── Loading ──

export function loadSkillCore(stage: string, dbPath?: string): string {
  const skillName = getSkillForStage(stage, dbPath)
  if (!skillName) return ''

  const corePath = path.join(SKILLS_DIR, skillName, 'core.md')
  if (!fs.existsSync(corePath)) return ''

  return fs.readFileSync(corePath, 'utf-8')
}

export function loadSkillExtended(skillName: string): string {
  const extPath = path.join(SKILLS_DIR, skillName, 'extended.md')
  if (!fs.existsSync(extPath)) return ''

  return fs.readFileSync(extPath, 'utf-8')
}

export function getSkillForStage(stage: string, dbPath?: string): string | null {
  // Check per-project override first
  if (dbPath) {
    const override = getProjectSetting(dbPath, `pipeline.skill.${stage}`)
    if (override) return override
  }

  // Check global override
  const globalOverride = getGlobalSetting(`pipeline.skill.${stage}`)
  if (globalOverride) return globalOverride

  // Default mapping
  return STAGE_SKILL_MAP[stage] ?? null
}

// ── Listing ──

export function listSkills(): SkillInfo[] {
  if (!fs.existsSync(SKILLS_DIR)) return []

  return fs.readdirSync(SKILLS_DIR)
    .filter(f => fs.statSync(path.join(SKILLS_DIR, f)).isDirectory())
    .map(name => {
      const corePath = path.join(SKILLS_DIR, name, 'core.md')
      const extPath = path.join(SKILLS_DIR, name, 'extended.md')
      const hasCore = fs.existsSync(corePath)
      const hasExtended = fs.existsSync(extPath)

      return {
        name,
        hasCore,
        hasExtended,
        coreTokenEstimate: hasCore ? Math.ceil(fs.readFileSync(corePath, 'utf-8').length / 4) : 0,
        extendedTokenEstimate: hasExtended ? Math.ceil(fs.readFileSync(extPath, 'utf-8').length / 4) : 0
      }
    })
}

// ── Editing (Workshop only) ──

export function editSkill(skillName: string, tier: 'core' | 'extended', content: string): void {
  const skillDir = path.join(SKILLS_DIR, skillName)
  fs.mkdirSync(skillDir, { recursive: true })
  const filePath = path.join(skillDir, `${tier}.md`)
  fs.writeFileSync(filePath, content, 'utf-8')
}

export function viewSkill(skillName: string, tier?: 'core' | 'extended'): { core?: string; extended?: string } {
  const result: { core?: string; extended?: string } = {}
  const skillDir = path.join(SKILLS_DIR, skillName)

  if (!tier || tier === 'core') {
    const p = path.join(skillDir, 'core.md')
    if (fs.existsSync(p)) result.core = fs.readFileSync(p, 'utf-8')
  }
  if (!tier || tier === 'extended') {
    const p = path.join(skillDir, 'extended.md')
    if (fs.existsSync(p)) result.extended = fs.readFileSync(p, 'utf-8')
  }

  return result
}
```

**Step 3: Build and verify**

Run: `npm run build`
Expected: Clean build.

**Step 4: Commit**

```bash
git add src/main/skill-loader.ts src/shared/skill-types.ts
git commit -m "feat(intelligence): add SkillLoader service with tiered loading and editing"
```

---

### Task 4: TemplateEngine Integration

**Files:**
- Modify: `src/main/template-engine.ts` (constructPrompt at lines 140-169)

**Step 1: Update constructPrompt() to inject knowledge index and tiered skills**

In `src/main/template-engine.ts`, add imports at the top:

```ts
import { buildKnowledgeIndex } from './knowledge-engine'
import { loadSkillCore } from './skill-loader'
```

Update `constructPrompt()` signature to accept `dbPath`:

```ts
export function constructPrompt(
  stage: PipelineStage,
  task: Task,
  projectPath?: string,
  dependencyContext?: string,
  dbPath?: string
): string
```

Replace the skill loading line (line 148):

```ts
// Old: const skillContent = loadSkillContent(config.skill)
// New: tiered skill loading — ClawFlow native first, fallback to ~/.claude/skills/
const skillCore = dbPath ? loadSkillCore(stage, dbPath) : ''
const skillContent = skillCore || loadSkillContent(config.skill)
```

After the skill injection block and before richHandoff/dependencyContext prepends, add knowledge index:

```ts
// Inject domain knowledge index
if (dbPath) {
  const knowledgeIndex = buildKnowledgeIndex(dbPath)
  if (knowledgeIndex) {
    prompt = `\n\n---\n${knowledgeIndex}\n---\n\n` + prompt
  }
}
```

**Step 2: Update caller in PipelineEngine**

In `src/main/pipeline-engine.ts`, the `constructPrompt()` call (~line 688) — add `this.dbPath` as fifth arg:

```ts
constructPrompt(stage, updatedTask, this.projectPath, dependencyContext, this.dbPath)
```

**Step 3: Build and verify**

Run: `npm run build`
Expected: Clean build.

**Step 4: Commit**

```bash
git add src/main/template-engine.ts src/main/pipeline-engine.ts
git commit -m "feat(intelligence): integrate knowledge index and tiered skills into prompt construction"
```

---

### Task 5: IPC Handlers & Preload Bridge

**Files:**
- Modify: `src/main/index.ts` (add IPC handler registration functions)
- Modify: `src/preload/index.ts` (expose knowledge/skills API to renderer)

**Step 1: Add knowledge IPC handlers**

In `src/main/index.ts`, create `registerKnowledgeIpc()`:

```ts
import {
  createKnowledgeEntry, listKnowledge, getKnowledgeEntry, getKnowledgeByKey,
  updateKnowledgeEntry, deleteKnowledgeEntry, listCandidates, promoteCandidate,
  discardCandidate, listGlobalKnowledge, createGlobalKnowledgeEntry
} from './knowledge-engine'

function registerKnowledgeIpc(): void {
  ipcMain.handle('knowledge:list', (_e, dbPath: string, options?: any) => listKnowledge(dbPath, options))
  ipcMain.handle('knowledge:get', (_e, dbPath: string, id: string) => getKnowledgeEntry(dbPath, id))
  ipcMain.handle('knowledge:getByKey', (_e, dbPath: string, key: string) => getKnowledgeByKey(dbPath, key))
  ipcMain.handle('knowledge:create', (_e, dbPath: string, entry: any) => createKnowledgeEntry(dbPath, entry))
  ipcMain.handle('knowledge:update', (_e, dbPath: string, id: string, updates: any) => updateKnowledgeEntry(dbPath, id, updates))
  ipcMain.handle('knowledge:delete', (_e, dbPath: string, id: string) => deleteKnowledgeEntry(dbPath, id))
  ipcMain.handle('knowledge:listCandidates', (_e, dbPath: string, taskId?: number) => listCandidates(dbPath, taskId))
  ipcMain.handle('knowledge:promote', (_e, dbPath: string, id: string, global: boolean) => promoteCandidate(dbPath, id, global))
  ipcMain.handle('knowledge:discard', (_e, dbPath: string, id: string) => discardCandidate(dbPath, id))
  ipcMain.handle('knowledge:listGlobal', () => listGlobalKnowledge())
  ipcMain.handle('knowledge:createGlobal', (_e, entry: any) => createGlobalKnowledgeEntry(entry))
}
```

**Step 2: Add skills IPC handlers**

```ts
import { listSkills, viewSkill, editSkill, loadSkillExtended } from './skill-loader'

function registerSkillIpc(): void {
  ipcMain.handle('skills:list', () => listSkills())
  ipcMain.handle('skills:view', (_e, name: string, tier?: 'core' | 'extended') => viewSkill(name, tier))
  ipcMain.handle('skills:edit', (_e, name: string, tier: 'core' | 'extended', content: string) => editSkill(name, tier, content))
  ipcMain.handle('skills:fetchExtended', (_e, name: string) => loadSkillExtended(name))
}
```

Call both in `app.whenReady()` alongside existing registrations.

**Step 3: Update preload bridge**

In `src/preload/index.ts`, add to `contextBridge.exposeInMainWorld('api', { ... })`:

```ts
knowledge: {
  list: (dbPath: string, options?: any) => ipcRenderer.invoke('knowledge:list', dbPath, options),
  get: (dbPath: string, id: string) => ipcRenderer.invoke('knowledge:get', dbPath, id),
  getByKey: (dbPath: string, key: string) => ipcRenderer.invoke('knowledge:getByKey', dbPath, key),
  create: (dbPath: string, entry: any) => ipcRenderer.invoke('knowledge:create', dbPath, entry),
  update: (dbPath: string, id: string, updates: any) => ipcRenderer.invoke('knowledge:update', dbPath, id, updates),
  delete: (dbPath: string, id: string) => ipcRenderer.invoke('knowledge:delete', dbPath, id),
  listCandidates: (dbPath: string, taskId?: number) => ipcRenderer.invoke('knowledge:listCandidates', dbPath, taskId),
  promote: (dbPath: string, id: string, global: boolean) => ipcRenderer.invoke('knowledge:promote', dbPath, id, global),
  discard: (dbPath: string, id: string) => ipcRenderer.invoke('knowledge:discard', dbPath, id),
  listGlobal: () => ipcRenderer.invoke('knowledge:listGlobal'),
  createGlobal: (entry: any) => ipcRenderer.invoke('knowledge:createGlobal', entry),
},
skills: {
  list: () => ipcRenderer.invoke('skills:list'),
  view: (name: string, tier?: 'core' | 'extended') => ipcRenderer.invoke('skills:view', name, tier),
  edit: (name: string, tier: 'core' | 'extended', content: string) => ipcRenderer.invoke('skills:edit', name, tier, content),
  fetchExtended: (name: string) => ipcRenderer.invoke('skills:fetchExtended', name),
},
```

**Step 4: Update the `ElectronAPI` type declarations** with matching interface definitions.

**Step 5: Build and verify**

Run: `npm run build`
Expected: Clean build.

**Step 6: Commit**

```bash
git add src/main/index.ts src/preload/index.ts
git commit -m "feat(intelligence): add IPC handlers and preload bridge for knowledge and skills"
```

---

### Task 6: Workshop Agent Tools — Knowledge & Skills

**Files:**
- Modify: `src/main/workshop-engine.ts` (handleToolCalls switch at lines 591-650)
- Modify: `src/templates/workshop-agent.md` (tool documentation)

**Step 1: Add imports to WorkshopEngine**

```ts
import {
  createKnowledgeEntry, getKnowledgeEntry, getKnowledgeByKey,
  updateKnowledgeEntry, listKnowledge
} from './knowledge-engine'
import { loadSkillExtended, editSkill, viewSkill } from './skill-loader'
```

**Step 2: Add tool cases to handleToolCalls() switch**

After the existing `load_skill` case, add:

```ts
case 'save_knowledge': {
  const entry = createKnowledgeEntry(this.dbPath, {
    key: toolInput.key,
    summary: toolInput.summary,
    content: toolInput.content,
    category: toolInput.category ?? 'convention',
    tags: toolInput.tags ?? [],
    source: 'workshop',
    sourceId: sessionId
  })
  createWorkshopMessage(this.dbPath, sessionId, 'system',
    `Saved knowledge: [${entry.key}] ${entry.summary}`, 'system_event', { knowledgeId: entry.id })
  this.emit('stream', { type: 'tool_event', event: 'knowledge_saved', data: entry, sessionId })
  break
}
case 'update_knowledge': {
  const updated = updateKnowledgeEntry(this.dbPath, toolInput.id, {
    content: toolInput.content,
    summary: toolInput.summary,
    tags: toolInput.tags
  })
  if (updated) {
    createWorkshopMessage(this.dbPath, sessionId, 'system',
      `Updated knowledge: [${updated.key}] ${updated.summary}`, 'system_event', { knowledgeId: updated.id })
  }
  break
}
case 'list_knowledge': {
  const entries = listKnowledge(this.dbPath, { category: toolInput.category })
  const formatted = entries.map(e => `- [${e.key}] (${e.category}) ${e.summary}`).join('\n')
  createWorkshopMessage(this.dbPath, sessionId, 'system',
    `## Knowledge Entries\n\n${formatted || 'No entries found.'}`, 'system_event', {})
  break
}
case 'fetch_knowledge': {
  const entry = getKnowledgeByKey(this.dbPath, toolInput.key_or_id)
    ?? getKnowledgeEntry(this.dbPath, toolInput.key_or_id)
  const message = entry
    ? `## Knowledge: ${entry.key}\n\n**Category:** ${entry.category}\n**Tags:** ${entry.tags.join(', ')}\n\n${entry.content}`
    : `Knowledge entry not found: ${toolInput.key_or_id}`
  createWorkshopMessage(this.dbPath, sessionId, 'system', message, 'system_event', {})
  break
}
case 'fetch_skill_detail': {
  const content = loadSkillExtended(toolInput.skill_name)
  const message = content
    ? `## Skill Extended: ${toolInput.skill_name}\n\n${content}`
    : `No extended content found for skill: ${toolInput.skill_name}`
  createWorkshopMessage(this.dbPath, sessionId, 'system', message, 'system_event', { skillName: toolInput.skill_name })
  break
}
case 'edit_skill': {
  editSkill(toolInput.skill_name, toolInput.tier, toolInput.content)
  createWorkshopMessage(this.dbPath, sessionId, 'system',
    `Updated skill ${toolInput.skill_name}/${toolInput.tier}.md`, 'system_event', { skillName: toolInput.skill_name })
  break
}
case 'view_skill': {
  const result = viewSkill(toolInput.skill_name, toolInput.tier)
  let message = `## Skill: ${toolInput.skill_name}\n\n`
  if (result.core) message += `### Core\n\n${result.core}\n\n`
  if (result.extended) message += `### Extended\n\n${result.extended}\n\n`
  if (!result.core && !result.extended) message += 'Skill not found.'
  createWorkshopMessage(this.dbPath, sessionId, 'system', message, 'system_event', { skillName: toolInput.skill_name })
  break
}
```

**Step 3: Document new tools in workshop-agent.md**

In `src/templates/workshop-agent.md`, add to the tools section:

```markdown
### Knowledge Management

**save_knowledge** — Save domain knowledge for future agent sessions.
<tool_call name="save_knowledge">
{"key": "short-identifier", "summary": "One-line description", "content": "Full details in markdown", "category": "business_rule|architecture|api_quirk|lesson_learned|convention", "tags": ["relevant", "tags"]}
</tool_call>

**update_knowledge** — Update an existing knowledge entry.
<tool_call name="update_knowledge">
{"id": "entry-uuid", "content": "Updated content", "summary": "Updated summary", "tags": ["updated", "tags"]}
</tool_call>

**list_knowledge** — Browse knowledge entries, optionally by category.
<tool_call name="list_knowledge">
{"category": "architecture"}
</tool_call>

**fetch_knowledge** — Get full details of a knowledge entry by key or ID.
<tool_call name="fetch_knowledge">
{"key_or_id": "api-date-format"}
</tool_call>

### Skills Management

**fetch_skill_detail** — Load extended content of a ClawFlow skill.
<tool_call name="fetch_skill_detail">
{"skill_name": "test-driven-development"}
</tool_call>

**edit_skill** — Modify a ClawFlow skill's core or extended content.
<tool_call name="edit_skill">
{"skill_name": "brainstorming", "tier": "core", "content": "Updated skill content..."}
</tool_call>

**view_skill** — View current skill content.
<tool_call name="view_skill">
{"skill_name": "brainstorming", "tier": "core"}
</tool_call>
```

**Step 4: Build and verify**

Run: `npm run build`
Expected: Clean build.

**Step 5: Commit**

```bash
git add src/main/workshop-engine.ts src/templates/workshop-agent.md
git commit -m "feat(intelligence): add knowledge and skill tools to Workshop agent"
```

---

### Task 7: Pipeline Agent Tools

**Files:**
- Modify: `src/main/sdk-manager.ts` (add tool call parsing after result)
- Modify: `src/templates/implement-agent.md` (add tool docs)
- Modify: `src/templates/verify-agent.md` (add tool docs)

**Step 1: Add tool documentation to implement template**

Append to `src/templates/implement-agent.md`:

```markdown
## Available Tools

### Knowledge

Check the Domain Knowledge Index above before writing tests — existing lessons may inform your implementation.

**fetch_knowledge** — Read full details of a domain knowledge entry.
<tool_call name="fetch_knowledge">
{"key_or_id": "api-date-format"}
</tool_call>

**save_knowledge** — Save a discovery as a candidate knowledge entry (reviewed by user later).
<tool_call name="save_knowledge">
{"key": "short-identifier", "summary": "One-line description", "content": "Full details", "category": "api_quirk", "tags": ["relevant"]}
</tool_call>

**fetch_skill_detail** — Load extended guidance for the current skill.
<tool_call name="fetch_skill_detail">
{"skill_name": "test-driven-development"}
</tool_call>
```

Add the same block (minus `save_knowledge`) to `src/templates/verify-agent.md`.

**Step 2: Add tool call parsing to SdkManager**

In `src/main/sdk-manager.ts`, add import:

```ts
import { createKnowledgeEntry } from './knowledge-engine'
```

After the SDK `query()` resolves and `result` is obtained (the returned result object), add parsing:

```ts
// Parse XML tool calls from agent output (knowledge/skill tools)
const toolCallRegex = /<tool_call name="(\w+)">([\s\S]*?)<\/tool_call>/g
let toolMatch
while ((toolMatch = toolCallRegex.exec(result.output ?? '')) !== null) {
  const toolName = toolMatch[1]
  let toolInput: any
  try { toolInput = JSON.parse(toolMatch[2].trim()) } catch { continue }

  if (toolName === 'save_knowledge' && params.dbPath) {
    createKnowledgeEntry(params.dbPath, {
      key: toolInput.key,
      summary: toolInput.summary,
      content: toolInput.content,
      category: toolInput.category ?? 'lesson_learned',
      tags: toolInput.tags ?? [],
      source: 'pipeline',
      sourceId: String(params.taskId),
      status: 'candidate'  // Pipeline saves are always candidates
    })
  }
}
```

**Note:** Add `dbPath` and `taskId` to the SDK runner params interface.

**Step 3: Build and verify**

Run: `npm run build`
Expected: Clean build.

**Step 4: Commit**

```bash
git add src/main/sdk-manager.ts src/templates/implement-agent.md src/templates/verify-agent.md
git commit -m "feat(intelligence): add knowledge and skill tools to pipeline agents"
```

---

## Phase 2: FDRL & Validation

### Task 8: FDRL Capture in PipelineEngine

**Files:**
- Modify: `src/main/pipeline-engine.ts` (rejectStage at lines 290-336, done handling)

**Step 1: Add FDRL imports**

```ts
import { createKnowledgeEntry, listCandidates } from './knowledge-engine'
```

**Step 2: Add FDRL capture to rejectStage()**

After the rejection counter increment (after line 310), before circuit breaker check, add:

```ts
// FDRL: Auto-capture rejection as candidate lesson
const autoKey = `${task.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').substring(0, 40)}-${currentStage}-rej-${updates.planReviewCount ?? updates.implReviewCount ?? 1}`
createKnowledgeEntry(this.dbPath, {
  key: autoKey,
  summary: feedback.split(/[.!?\n]/)[0].trim().substring(0, 100),
  content: `## Stage Rejection: ${currentStage}\n\n**Task:** ${task.title}\n**Feedback:**\n\n${feedback}`,
  category: 'lesson_learned',
  tags: [currentStage, 'rejection'],
  source: 'fdrl',
  sourceId: String(taskId),
  status: 'candidate'
})
```

**Step 3: Include candidates in circuit-breaker emit**

Modify the circuit breaker emit (line 320):

```ts
if (isCircuitBreakerTripped(updatedTask)) {
  const candidates = listCandidates(this.dbPath, taskId)
  updateTask(this.dbPath, taskId, { status: 'blocked' })
  this.emit('circuit-breaker', { taskId, reason: `...`, candidates })
  return this.getTaskOrThrow(taskId)
}
```

**Step 4: Emit candidates on task completion**

In the done-handling block (~line 852), before setting status to `done`:

```ts
const remainingCandidates = listCandidates(this.dbPath, taskId)
if (remainingCandidates.length > 0) {
  this.emit('task:review-candidates', { taskId, candidates: remainingCandidates })
}
```

**Step 5: Build and verify**

Run: `npm run build`
Expected: Clean build.

**Step 6: Commit**

```bash
git add src/main/pipeline-engine.ts
git commit -m "feat(intelligence): add FDRL capture to stage rejections and circuit breakers"
```

---

### Task 9: Two-Strike Intelligence

**Files:**
- Modify: `src/main/pipeline-engine.ts`

**Step 1: Add rejection history Map to PipelineEngine class**

```ts
private rejectionHistory: Map<string, string[]> = new Map()
```

**Step 2: Add similarity detection method**

```ts
private detectSimilarRejection(taskId: number, stage: string, feedback: string): { similar: boolean; previous?: string } {
  const key = `${taskId}-${stage}`
  const history = this.rejectionHistory.get(key) ?? []

  if (history.length === 0) {
    this.rejectionHistory.set(key, [feedback])
    return { similar: false }
  }

  const lastFeedback = history[history.length - 1]

  // Extract significant terms (words 4+ chars, lowercased)
  const extractTerms = (text: string): Set<string> =>
    new Set(text.toLowerCase().match(/\b[a-z]{4,}\b/g) ?? [])

  const currentTerms = extractTerms(feedback)
  const previousTerms = extractTerms(lastFeedback)

  let overlap = 0
  for (const term of currentTerms) {
    if (previousTerms.has(term)) overlap++
  }

  const similarity = currentTerms.size > 0 ? overlap / currentTerms.size : 0
  history.push(feedback)
  this.rejectionHistory.set(key, history)

  return { similar: similarity > 0.5, previous: lastFeedback }
}
```

**Step 3: Inject two-strike prompt in rejectStage()**

Before the final `runStage()` call in `rejectStage()`, add:

```ts
const detection = this.detectSimilarRejection(taskId, currentStage, feedback)
let enhancedFeedback = feedback

if (detection.similar && detection.previous) {
  enhancedFeedback = `## Two-Strike Protocol

Your previous two attempts at this stage were rejected for similar reasons:
- Previous: ${detection.previous.split('\n')[0].substring(0, 200)}
- Current: ${feedback.split('\n')[0].substring(0, 200)}

Before proceeding, you MUST:
1. Explain why your previous approach failed
2. List 3 fundamentally different strategies to solve this
3. Choose the best strategy and explain why
4. Only then proceed with implementation

## Original Feedback

${feedback}`
}

await this.runStage(taskId, currentStage, enhancedFeedback)
```

**Step 4: Clear rejection history on stage completion**

In the stage completion handling (after `stage:complete` emit):

```ts
this.rejectionHistory.delete(`${taskId}-${stage}`)
```

**Step 5: Build and verify**

Run: `npm run build`
Expected: Clean build.

**Step 6: Commit**

```bash
git add src/main/pipeline-engine.ts
git commit -m "feat(intelligence): add two-strike pattern detection with 3-strategies prompt"
```

---

### Task 10: Validation Hook Runner

**Files:**
- Create: `src/main/hook-runner.ts`
- Create: `src/shared/hook-types.ts`

**Step 1: Create hook types**

Create `src/shared/hook-types.ts`:

```ts
export interface ValidationHook {
  name: string
  command: string
  args?: string[]      // command arguments (use execFile for safety)
  cwd?: string         // defaults to project path; supports {{project_path}} substitution
  timeout?: number     // ms, default 30000
  required: boolean    // if true, failure blocks stage transition
}

export interface HookResult {
  name: string
  success: boolean
  output: string
  duration: number
}

export interface HookPreset {
  name: string
  description: string
  hooks: Record<string, ValidationHook[]>
}

export const HOOK_PRESETS: HookPreset[] = [
  {
    name: 'typescript',
    description: 'TypeScript type checking after implementation',
    hooks: {
      'post.implement': [
        { name: 'TypeScript Check', command: 'npx', args: ['tsc', '--noEmit'], timeout: 30000, required: true }
      ]
    }
  },
  {
    name: 'full-js',
    description: 'TypeScript + ESLint + Tests',
    hooks: {
      'post.implement': [
        { name: 'TypeScript Check', command: 'npx', args: ['tsc', '--noEmit'], timeout: 30000, required: true },
        { name: 'ESLint', command: 'npx', args: ['eslint', 'src/', '--quiet'], timeout: 60000, required: false }
      ],
      'post.code_review': [
        { name: 'Test Suite', command: 'npm', args: ['test'], timeout: 120000, required: true }
      ]
    }
  },
  {
    name: 'python',
    description: 'Python compile check + pytest',
    hooks: {
      'post.implement': [
        { name: 'Python Compile', command: 'python', args: ['-m', 'py_compile'], timeout: 15000, required: true }
      ],
      'post.code_review': [
        { name: 'Pytest', command: 'pytest', args: [], timeout: 120000, required: true }
      ]
    }
  }
]
```

**Step 2: Create the HookRunner**

Create `src/main/hook-runner.ts`. **Security note:** Use `execFile` (not `exec`) to prevent shell injection:

```ts
import { execFile } from 'child_process'
import { ValidationHook, HookResult } from '../shared/hook-types'
import { getProjectSetting, getGlobalSetting } from './db'

export async function runHook(hook: ValidationHook, projectPath: string, worktreePath?: string): Promise<HookResult> {
  const cwd = (hook.cwd ?? '{{project_path}}').replace('{{project_path}}', worktreePath ?? projectPath)
  const timeout = hook.timeout ?? 30000
  const start = Date.now()

  return new Promise<HookResult>((resolve) => {
    const args = hook.args ?? []
    execFile(hook.command, args, { cwd, timeout }, (error, stdout, stderr) => {
      resolve({
        name: hook.name,
        success: !error,
        output: (stdout + '\n' + stderr).trim(),
        duration: Date.now() - start
      })
    })
  })
}

export async function runHooks(hooks: ValidationHook[], projectPath: string, worktreePath?: string): Promise<{
  allPassed: boolean
  results: HookResult[]
  failedRequired: HookResult[]
}> {
  const results: HookResult[] = []
  const failedRequired: HookResult[] = []

  for (const hook of hooks) {
    const result = await runHook(hook, projectPath, worktreePath)
    results.push(result)
    if (!result.success && hook.required) {
      failedRequired.push(result)
    }
  }

  return { allPassed: failedRequired.length === 0, results, failedRequired }
}

export function getHooksForStage(dbPath: string, timing: 'pre' | 'post', stage: string): ValidationHook[] {
  const key = `pipeline.hooks.${timing}.${stage}`

  const projectHooks = getProjectSetting(dbPath, key)
  if (projectHooks) {
    try { return JSON.parse(projectHooks) } catch { /* fall through */ }
  }

  const globalHooks = getGlobalSetting(key)
  if (globalHooks) {
    try { return JSON.parse(globalHooks) } catch { /* fall through */ }
  }

  return []
}
```

**Step 3: Build and verify**

Run: `npm run build`
Expected: Clean build.

**Step 4: Commit**

```bash
git add src/main/hook-runner.ts src/shared/hook-types.ts
git commit -m "feat(intelligence): add HookRunner with execFile for safe stage-boundary validation"
```

---

### Task 11: Pipeline Hooks Integration

**Files:**
- Modify: `src/main/pipeline-engine.ts` (runStage method)

**Step 1: Add imports**

```ts
import { getHooksForStage, runHooks } from './hook-runner'
```

**Step 2: Add pre-hooks at top of runStage()**

After the guard and `stage:start` emit (~line 634):

```ts
// Pre-stage validation hooks
const preHooks = getHooksForStage(this.dbPath, 'pre', stage)
if (preHooks.length > 0) {
  const worktreePath = this.taskWorktrees.get(taskId)
  const hookResults = await runHooks(preHooks, this.projectPath, worktreePath)
  if (!hookResults.allPassed) {
    const failMessages = hookResults.failedRequired.map(r => `**${r.name}:** ${r.output}`).join('\n\n')
    appendAgentLog(this.dbPath, taskId, {
      action: 'hook:pre-stage-failed',
      details: `Pre-hooks failed for ${stage}:\n${failMessages}`,
      timestamp: new Date().toISOString()
    })
    this.emit('stage:error', { taskId, stage, error: `Pre-stage hooks failed:\n${failMessages}` })
    updateTask(this.dbPath, taskId, { status: 'blocked' })
    return
  }
}
```

**Step 3: Add post-hooks after SDK result**

After `result` is obtained (~line 756), before handoff parsing:

```ts
// Post-stage validation hooks
const postHooks = getHooksForStage(this.dbPath, 'post', stage)
if (postHooks.length > 0) {
  const worktreePath = this.taskWorktrees.get(taskId)
  const hookResults = await runHooks(postHooks, this.projectPath, worktreePath)
  if (!hookResults.allPassed) {
    const failMessages = hookResults.failedRequired.map(r => `**${r.name}:** ${r.output}`).join('\n\n')
    appendAgentLog(this.dbPath, taskId, {
      action: 'hook:post-stage-failed',
      details: `Post-hooks failed for ${stage}:\n${failMessages}`,
      timestamp: new Date().toISOString()
    })
    // Treat as rejection — feeds into FDRL
    await this.rejectStage(taskId, `Validation hook failed:\n\n${failMessages}`)
    return
  }
}
```

**Step 4: Build and verify**

Run: `npm run build`
Expected: Clean build.

**Step 5: Commit**

```bash
git add src/main/pipeline-engine.ts
git commit -m "feat(intelligence): integrate pre/post validation hooks into pipeline stage execution"
```

---

### Task 12: Auto-Merge on Task Completion

**Files:**
- Modify: `src/main/pipeline-engine.ts` (done handling in storeStageOutput)
- Modify: `src/main/db.ts` (add auto_merge column migration)
- Modify: `src/templates/completion-agent.md`

**Step 1: Add auto_merge column**

In `migrateTasksTable()` in `src/main/db.ts`:

```ts
if (!colNames.has('auto_merge')) db.prepare("ALTER TABLE tasks ADD COLUMN auto_merge INTEGER DEFAULT 1").run()
```

**Step 2: Guard merge with auto_merge flag**

In `storeStageOutput()` where the existing merge logic is (~line 957), wrap with:

```ts
if (stage === 'done' && this.gitEngine) {
  const task = this.getTaskOrThrow(taskId)
  if (task.autoMerge !== false) {
    const mergeResult = await this.gitEngine.merge(taskId)
    if (mergeResult.success) {
      await this.gitEngine.cleanupWorktree(taskId)
      this.taskWorktrees.delete(taskId)
      this.emit('task:merged', { taskId })
    } else {
      updateTask(this.dbPath, taskId, { status: 'blocked', pauseReason: 'merge_conflict' })
      this.emit('stage:error', { taskId, stage: 'done', error: 'Merge conflict — resolve manually and retry' })
      return
    }
  }
}
```

**Step 3: Update completion template**

Replace `src/templates/completion-agent.md`:

```markdown
# Completion Agent

> **Finisher** `sonnet` · {{timestamp}}

You are the Completion agent for ClawFlow. Wrap up the task.

## Task

**Title:** {{title}}
**Description:** {{description}}

## Implementation Summary

{{implementation_summary}}

## Verification Result

{{verify_result}}

## Instructions

1. Summarize what was accomplished in 3-5 bullet points
2. Confirm all tests pass and the implementation is complete
3. Note any follow-up work or technical debt discovered

Do NOT ask about merging, branching, or git operations. The pipeline handles merging automatically.
```

**Step 4: Build and verify**

Run: `npm run build`
Expected: Clean build.

**Step 5: Commit**

```bash
git add src/main/pipeline-engine.ts src/main/db.ts src/templates/completion-agent.md
git commit -m "feat(intelligence): add auto-merge on completion with conflict handling"
```

---

## Phase 3: UI & Default Skills

### Task 13: Knowledge Zustand Store

**Files:**
- Create: `src/renderer/src/stores/knowledgeStore.ts`

**Step 1: Create the store**

```ts
import { create } from 'zustand'
import { KnowledgeEntry } from '../../../shared/knowledge-types'

interface KnowledgeState {
  entries: KnowledgeEntry[]
  globalEntries: KnowledgeEntry[]
  candidates: KnowledgeEntry[]
  loading: boolean
  loadKnowledge: (dbPath: string) => Promise<void>
  loadCandidates: (dbPath: string, taskId?: number) => Promise<void>
  createEntry: (dbPath: string, entry: any) => Promise<KnowledgeEntry>
  updateEntry: (dbPath: string, id: string, updates: any) => Promise<void>
  deleteEntry: (dbPath: string, id: string) => Promise<void>
  promoteCandidate: (dbPath: string, id: string, global: boolean) => Promise<void>
  discardCandidate: (dbPath: string, id: string) => Promise<void>
}

export const useKnowledgeStore = create<KnowledgeState>((set) => ({
  entries: [],
  globalEntries: [],
  candidates: [],
  loading: false,

  loadKnowledge: async (dbPath) => {
    set({ loading: true })
    const [entries, globalEntries] = await Promise.all([
      window.api.knowledge.list(dbPath),
      window.api.knowledge.listGlobal()
    ])
    set({ entries, globalEntries, loading: false })
  },

  loadCandidates: async (dbPath, taskId?) => {
    const candidates = await window.api.knowledge.listCandidates(dbPath, taskId)
    set({ candidates })
  },

  createEntry: async (dbPath, entry) => {
    const created = await window.api.knowledge.create(dbPath, entry)
    set(state => ({ entries: [created, ...state.entries] }))
    return created
  },

  updateEntry: async (dbPath, id, updates) => {
    const updated = await window.api.knowledge.update(dbPath, id, updates)
    set(state => ({ entries: state.entries.map(e => e.id === id ? updated : e) }))
  },

  deleteEntry: async (dbPath, id) => {
    await window.api.knowledge.delete(dbPath, id)
    set(state => ({ entries: state.entries.filter(e => e.id !== id) }))
  },

  promoteCandidate: async (dbPath, id, global) => {
    await window.api.knowledge.promote(dbPath, id, global)
    set(state => ({ candidates: state.candidates.filter(c => c.id !== id) }))
  },

  discardCandidate: async (dbPath, id) => {
    await window.api.knowledge.discard(dbPath, id)
    set(state => ({ candidates: state.candidates.filter(c => c.id !== id) }))
  }
}))
```

**Step 2: Build and verify**

Run: `npm run build`

**Step 3: Commit**

```bash
git add src/renderer/src/stores/knowledgeStore.ts
git commit -m "feat(intelligence): add knowledge Zustand store"
```

---

### Task 14: InterventionPanel FDRL Section

**Files:**
- Modify: `src/renderer/src/components/TaskDetail/InterventionPanel.tsx`

**Step 1: Add FDRL candidate review section**

When circuit breaker is active and candidates exist, render a "Lessons Learned" section below the existing circuit breaker UI:

- List each candidate: key, summary, content preview (truncated to ~200 chars)
- Three action buttons per candidate: **Confirm** (green accent), **Edit** (amber), **Discard** (red/muted)
- On Confirm: checkbox "Apply to all projects?" then call `promoteCandidate(dbPath, id, global)`
- On Edit: inline textarea pre-filled with content, save calls `updateEntry` then `promoteCandidate`
- On Discard: call `discardCandidate(dbPath, id)`
- "Add New Lesson" button at bottom opens inline form (key, summary, content, category dropdown)

Use `useKnowledgeStore` for all actions. Follow the Midnight Neon theme (glass surfaces, neon accents).

**Step 2: Wire pipeline:review-candidates event**

In `pipelineStore.setupListeners()`, listen for `pipeline:review-candidates` and set a flag that the TaskDetail view can check.

**Step 3: Build and verify**

Run: `npm run build`

**Step 4: Commit**

```bash
git add src/renderer/src/components/ src/renderer/src/stores/pipelineStore.ts
git commit -m "feat(intelligence): add FDRL candidate review to InterventionPanel"
```

---

### Task 15: Settings UI — Validation Hooks

**Files:**
- Modify: `src/shared/settings.ts` (add hook setting keys)
- Modify: Settings modal component (add hooks section)

**Step 1: Add hook setting keys to settings.ts**

```ts
// Add to SETTING_KEYS:
HOOK_PRE_PREFIX: 'pipeline.hooks.pre.',
HOOK_POST_PREFIX: 'pipeline.hooks.post.',
HOOK_PRESET: 'pipeline.hooks.preset',
```

**Step 2: Create hooks configuration panel**

Add a "Validation Hooks" tab/section to the Settings modal (under project settings):
- **Preset selector**: dropdown with `HOOK_PRESETS` names (None, TypeScript, Full JS, Python)
- Selecting a preset auto-populates hooks list
- **Custom hooks list**: each row shows name, command + args, stage, required toggle
- **Add hook button**: opens inline form (name, command, args, stage trigger dropdown, required toggle, timeout)
- Save to project settings as JSON via `pipeline.hooks.pre.<stage>` and `pipeline.hooks.post.<stage>` keys

**Step 3: Build and verify**

Run: `npm run build`

**Step 4: Commit**

```bash
git add src/shared/settings.ts src/renderer/src/components/
git commit -m "feat(intelligence): add validation hooks configuration to Settings modal"
```

---

### Task 16: Default Skills Seeding

**Files:**
- Create: `src/skills/defaults/brainstorming/core.md` and `extended.md`
- Create: `src/skills/defaults/test-driven-development/core.md` and `extended.md`
- Create: `src/skills/defaults/writing-plans/core.md` and `extended.md`
- Create: `src/skills/defaults/design-review/core.md` and `extended.md`
- Create: `src/skills/defaults/code-review/core.md` and `extended.md`
- Create: `src/skills/defaults/verification/core.md` and `extended.md`
- Create: `src/skills/defaults/completion/core.md` and `extended.md`
- Modify: `src/main/index.ts` (call ensureSkillsSeeded on startup)
- Modify: `electron.vite.config.ts` (include skills in build)

**Step 1: Write core.md files (200-500 tokens each)**

Each core.md contains essential rules for that pipeline stage, written for ClawFlow context. Example:

`src/skills/defaults/test-driven-development/core.md`:
```markdown
# TDD — Core Rules

1. **Red → Green → Refactor.** Write a failing test first. Implement minimum code to pass. Refactor.
2. **One test at a time.** Don't write multiple tests before implementing.
3. **Commit after each green.** Every passing test gets a commit.
4. **Check domain knowledge** before writing tests — existing lessons may inform test cases.
5. **Touch ONLY what the plan requires.** Do NOT improve adjacent code.
6. **If a test fails unexpectedly**, investigate before changing the test.
7. **If stuck after 2 attempts**, use fetch_skill_detail("test-driven-development") for extended guidance.
```

**Step 2: Write extended.md files (1000-3000 tokens each)**

Detailed workflows, examples, edge case handling, checklists.

**Step 3: Call ensureSkillsSeeded() on startup**

In `src/main/index.ts`, inside `app.whenReady()`:

```ts
import { ensureSkillsSeeded } from './skill-loader'
// Inside the callback:
ensureSkillsSeeded()
```

**Step 4: Configure electron-vite to copy skills to build**

Ensure `src/skills/defaults/` gets included in the main process build output.

**Step 5: Build and verify**

Run: `npm run build`
Verify `~/.clawflow/skills/` is populated on launch.

**Step 6: Commit**

```bash
git add src/skills/ src/main/index.ts electron.vite.config.ts
git commit -m "feat(intelligence): add default skills and seed on first launch"
```

---

### Task 17: Wire Pipeline Events to Renderer

**Files:**
- Modify: `src/main/index.ts` (bridge events)
- Modify: `src/preload/index.ts` (expose new channels)
- Modify: `src/renderer/src/stores/pipelineStore.ts` (listen)

**Step 1: Bridge new events in main process**

```ts
currentEngine.on('task:review-candidates', (data) =>
  mainWindow?.webContents.send('pipeline:review-candidates', data))
currentEngine.on('task:merged', (data) =>
  mainWindow?.webContents.send('pipeline:task-merged', data))
```

**Step 2: Expose in preload**

```ts
onReviewCandidates: (callback) => {
  const handler = (_e, data) => callback(data)
  ipcRenderer.on('pipeline:review-candidates', handler)
  return () => { ipcRenderer.removeListener('pipeline:review-candidates', handler) }
},
onTaskMerged: (callback) => {
  const handler = (_e, data) => callback(data)
  ipcRenderer.on('pipeline:task-merged', handler)
  return () => { ipcRenderer.removeListener('pipeline:task-merged', handler) }
},
```

**Step 3: Listen in pipelineStore setupListeners()**

```ts
const cleanupCandidates = window.api.pipeline.onReviewCandidates((data) => {
  set({ pendingCandidateReview: data })
})
const cleanupMerged = window.api.pipeline.onTaskMerged((data) => {
  set(state => ({ streamEvents: [...state.streamEvents, { type: 'merged', ...data }] }))
})
```

Add cleanup calls to the returned function.

**Step 4: Build and verify**

Run: `npm run build`

**Step 5: Commit**

```bash
git add src/main/index.ts src/preload/index.ts src/renderer/src/stores/pipelineStore.ts
git commit -m "feat(intelligence): wire FDRL and merge events to renderer"
```

---

## Phase 4: Final Integration

### Task 18: Update All Stage Templates

**Files:**
- Modify: `src/templates/brainstorm-agent.md`
- Modify: `src/templates/plan-agent.md`
- Modify: `src/templates/design-review-agent.md`
- Modify: `src/templates/code-review-agent.md`
- Modify: `src/templates/verify-agent.md`

**Step 1: Add knowledge reference line**

Each template gets:

```markdown
Check the Domain Knowledge Index above before proceeding. Use fetch_knowledge() for details on any entry.
```

**Step 2: Add fetch_knowledge tool docs to all templates**

All stages benefit from reading knowledge. Add the `fetch_knowledge` tool call example.

**Step 3: Add save_knowledge to implement and verify only**

Only these two stages can discover things worth saving.

**Step 4: Build and verify**

Run: `npm run build`

**Step 5: Commit**

```bash
git add src/templates/
git commit -m "feat(intelligence): update all stage templates with knowledge and skill references"
```

---

### Task 19: End-to-End Verification

**Step 1: First-run seeding** — Launch app, verify `~/.clawflow/skills/` has 7 skill directories.

**Step 2: Manual knowledge** — Open Workshop, ask agent to save knowledge. Verify it appears.

**Step 3: Pipeline knowledge injection** — Create L1 task, check agent log for knowledge index in prompt.

**Step 4: FDRL flow** — Reject a stage, verify candidate created. Trigger circuit breaker, verify candidates in InterventionPanel.

**Step 5: Validation hooks** — Configure TypeScript hook, run implement stage, verify hook executes.

**Step 6: Two-strike** — Reject twice with similar feedback, verify third attempt has Two-Strike Protocol.

**Step 7: Auto-merge** — Complete a full task, verify worktree merges and cleans up.

**Step 8: Commit fixes**

```bash
git add -A
git commit -m "fix(intelligence): address issues from e2e verification"
```

---

## Implementation Order Summary

| Phase | Tasks | Dependencies |
|-------|-------|-------------|
| 1: Foundation | 1-7 | Sequential: schema → engine → loader → template → IPC → workshop tools → pipeline tools |
| 2: FDRL & Validation | 8-12 | 8-9 depend on Phase 1. 10-12 can parallel after 8. |
| 3: UI & Skills | 13-17 | 13-14 depend on Phase 1-2 IPC. 15-16 independent. 17 ties events. |
| 4: Integration | 18-19 | After all phases. |

**Total: 19 tasks across 4 phases.**
