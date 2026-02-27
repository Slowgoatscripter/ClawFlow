import crypto from 'crypto'
import { getProjectDb, getGlobalDb } from './db'
import type {
  KnowledgeEntry,
  KnowledgeCategory,
  KnowledgeSource,
  KnowledgeStatus
} from '../shared/knowledge-types'

// Safe JSON parse — returns fallback on malformed input
function safeJsonParse<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback
  try { return JSON.parse(value) } catch { return fallback }
}

// ---------------------------------------------------------------------------
// Helper: DB row → KnowledgeEntry
// ---------------------------------------------------------------------------

export function rowToEntry(row: any): KnowledgeEntry {
  return {
    id: row.id,
    key: row.key,
    summary: row.summary,
    content: row.content,
    category: row.category as KnowledgeCategory,
    tags: safeJsonParse(row.tags, []),
    source: row.source as KnowledgeSource,
    sourceId: row.source_id ?? null,
    status: row.status as KnowledgeStatus,
    tokenEstimate: row.token_estimate ?? 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

// ---------------------------------------------------------------------------
// CRUD — Project (domain_knowledge)
// ---------------------------------------------------------------------------

export interface CreateKnowledgeInput {
  key: string
  summary: string
  content: string
  category?: KnowledgeCategory
  tags?: string[]
  source?: KnowledgeSource
  sourceId?: string | null
  status?: KnowledgeStatus
}

export function createKnowledgeEntry(
  dbPath: string,
  entry: CreateKnowledgeInput
): KnowledgeEntry {
  const db = getProjectDb(dbPath)
  const id = crypto.randomUUID()
  const now = new Date().toISOString()
  const tokenEstimate = Math.ceil(entry.content.length / 4)

  db.prepare(`
    INSERT INTO domain_knowledge
      (id, key, summary, content, category, tags, source, source_id, status, token_estimate, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    entry.key,
    entry.summary,
    entry.content,
    entry.category ?? 'convention',
    JSON.stringify(entry.tags ?? []),
    entry.source ?? 'manual',
    entry.sourceId ?? null,
    entry.status ?? 'active',
    tokenEstimate,
    now,
    now
  )

  return getKnowledgeEntry(dbPath, id)!
}

export function getKnowledgeEntry(
  dbPath: string,
  id: string
): KnowledgeEntry | null {
  const db = getProjectDb(dbPath)
  const row = db.prepare('SELECT * FROM domain_knowledge WHERE id = ?').get(id) as any
  return row ? rowToEntry(row) : null
}

export function getKnowledgeByKey(
  dbPath: string,
  key: string
): KnowledgeEntry | null {
  const db = getProjectDb(dbPath)
  const row = db
    .prepare("SELECT * FROM domain_knowledge WHERE key = ? AND status = 'active' LIMIT 1")
    .get(key) as any
  return row ? rowToEntry(row) : null
}

export function getKnowledgeByKeyAndStatus(
  dbPath: string,
  key: string,
  status: string
): KnowledgeEntry | null {
  const db = getProjectDb(dbPath)
  const row = db
    .prepare('SELECT * FROM domain_knowledge WHERE key = ? AND status = ? LIMIT 1')
    .get(key, status) as any
  return row ? rowToEntry(row) : null
}

export function createOrUpdateKnowledgeEntry(
  dbPath: string,
  entry: CreateKnowledgeInput
): KnowledgeEntry {
  const status = entry.status ?? 'active'
  const existing = getKnowledgeByKeyAndStatus(dbPath, entry.key, status)
  if (existing) {
    return updateKnowledgeEntry(dbPath, existing.id, {
      content: entry.content,
      summary: entry.summary,
      tags: entry.tags,
      category: entry.category
    })!
  }
  return createKnowledgeEntry(dbPath, entry)
}

export interface ListKnowledgeOptions {
  category?: KnowledgeCategory
  status?: KnowledgeStatus
  includeArchived?: boolean
}

export function listKnowledge(
  dbPath: string,
  options?: ListKnowledgeOptions
): KnowledgeEntry[] {
  const db = getProjectDb(dbPath)
  const conditions: string[] = []
  const params: any[] = []

  if (options?.category) {
    conditions.push('category = ?')
    params.push(options.category)
  }

  if (options?.status) {
    conditions.push('status = ?')
    params.push(options.status)
  } else if (!options?.includeArchived) {
    conditions.push("status != 'archived'")
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
  const rows = db
    .prepare(`SELECT * FROM domain_knowledge ${where} ORDER BY created_at DESC`)
    .all(...params) as any[]

  return rows.map(rowToEntry)
}

export interface UpdateKnowledgeInput {
  content?: string
  summary?: string
  tags?: string[]
  status?: KnowledgeStatus
  category?: KnowledgeCategory
}

export function updateKnowledgeEntry(
  dbPath: string,
  id: string,
  updates: UpdateKnowledgeInput
): KnowledgeEntry | null {
  const db = getProjectDb(dbPath)
  const setClauses: string[] = []
  const values: any[] = []

  if (updates.content !== undefined) {
    setClauses.push('content = ?')
    values.push(updates.content)
    setClauses.push('token_estimate = ?')
    values.push(Math.ceil(updates.content.length / 4))
  }
  if (updates.summary !== undefined) {
    setClauses.push('summary = ?')
    values.push(updates.summary)
  }
  if (updates.tags !== undefined) {
    setClauses.push('tags = ?')
    values.push(JSON.stringify(updates.tags))
  }
  if (updates.status !== undefined) {
    setClauses.push('status = ?')
    values.push(updates.status)
  }
  if (updates.category !== undefined) {
    setClauses.push('category = ?')
    values.push(updates.category)
  }

  if (setClauses.length === 0) return getKnowledgeEntry(dbPath, id)

  setClauses.push('updated_at = ?')
  values.push(new Date().toISOString())
  values.push(id)

  db.prepare(
    `UPDATE domain_knowledge SET ${setClauses.join(', ')} WHERE id = ?`
  ).run(...values)

  return getKnowledgeEntry(dbPath, id)
}

export function deleteKnowledgeEntry(dbPath: string, id: string): void {
  const db = getProjectDb(dbPath)
  db.prepare('DELETE FROM domain_knowledge WHERE id = ?').run(id)
}

// ---------------------------------------------------------------------------
// CRUD — Global (global_knowledge)
// ---------------------------------------------------------------------------

export function createGlobalKnowledgeEntry(
  entry: CreateKnowledgeInput
): KnowledgeEntry {
  const db = getGlobalDb()
  const id = crypto.randomUUID()
  const now = new Date().toISOString()
  const tokenEstimate = Math.ceil(entry.content.length / 4)

  db.prepare(`
    INSERT INTO global_knowledge
      (id, key, summary, content, category, tags, source, source_id, status, token_estimate, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    entry.key,
    entry.summary,
    entry.content,
    entry.category ?? 'convention',
    JSON.stringify(entry.tags ?? []),
    entry.source ?? 'manual',
    entry.sourceId ?? null,
    entry.status ?? 'active',
    tokenEstimate,
    now,
    now
  )

  return getGlobalKnowledgeEntry(id)!
}

export function getGlobalKnowledgeEntry(id: string): KnowledgeEntry | null {
  const db = getGlobalDb()
  const row = db.prepare('SELECT * FROM global_knowledge WHERE id = ?').get(id) as any
  return row ? rowToEntry(row) : null
}

export function listGlobalKnowledge(): KnowledgeEntry[] {
  const db = getGlobalDb()
  const rows = db
    .prepare("SELECT * FROM global_knowledge WHERE status = 'active' ORDER BY created_at DESC")
    .all() as any[]
  return rows.map(rowToEntry)
}

export function getGlobalKnowledgeByKey(key: string): KnowledgeEntry | null {
  const db = getGlobalDb()
  const row = db
    .prepare("SELECT * FROM global_knowledge WHERE key = ? AND status = 'active' LIMIT 1")
    .get(key) as any
  return row ? rowToEntry(row) : null
}

// ---------------------------------------------------------------------------
// Candidate Management (FDRL)
// ---------------------------------------------------------------------------

export function listCandidates(
  dbPath: string,
  taskId?: string
): KnowledgeEntry[] {
  const db = getProjectDb(dbPath)
  let sql = "SELECT * FROM domain_knowledge WHERE status = 'candidate'"
  const params: any[] = []

  if (taskId) {
    sql += ' AND source_id = ?'
    params.push(taskId)
  }

  sql += ' ORDER BY created_at DESC'
  const rows = db.prepare(sql).all(...params) as any[]
  return rows.map(rowToEntry)
}

export function promoteCandidate(
  dbPath: string,
  id: string,
  global: boolean = false
): KnowledgeEntry | null {
  const entry = updateKnowledgeEntry(dbPath, id, { status: 'active' })
  if (!entry) return null

  if (global) {
    const existingGlobal = getGlobalKnowledgeByKey(entry.key)
    if (!existingGlobal) {
      createGlobalKnowledgeEntry({
        key: entry.key,
        summary: entry.summary,
        content: entry.content,
        category: entry.category,
        tags: entry.tags,
        source: entry.source,
        sourceId: entry.sourceId,
        status: 'active'
      })
    }
  }

  return entry
}

export function discardCandidate(
  dbPath: string,
  id: string
): KnowledgeEntry | null {
  return updateKnowledgeEntry(dbPath, id, { status: 'archived' })
}

// ---------------------------------------------------------------------------
// Summary Index
// ---------------------------------------------------------------------------

export function buildKnowledgeIndex(dbPath: string): string {
  const projectEntries = listKnowledge(dbPath, { status: 'active' })
  const globalEntries = listGlobalKnowledge()

  if (projectEntries.length === 0 && globalEntries.length === 0) {
    return ''
  }

  const lines: string[] = [
    '## Domain Knowledge Index',
    `Project: ${projectEntries.length} entries | Global: ${globalEntries.length} entries`,
    ''
  ]

  if (projectEntries.length > 0) {
    lines.push('### Project Knowledge')
    for (const e of projectEntries) {
      lines.push(`- [${e.key}] ${e.summary}`)
    }
    lines.push('')
  }

  if (globalEntries.length > 0) {
    lines.push('### Global Knowledge')
    for (const e of globalEntries) {
      lines.push(`- [${e.key}] ${e.summary}`)
    }
    lines.push('')
  }

  lines.push('Use fetch_knowledge(key_or_id) to read full details on any entry.')

  return lines.join('\n')
}
