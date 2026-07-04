// Learned-memory query layer. Markdown files remain user-editable rule sources;
// durable learned facts live here so recall, undo, inspection, and consolidation
// share one transactional store.
import type { Db } from "./driver"
import { createId } from "@/lib/id"
import { consolidate, renderMemoryBlock, selectForContext } from "@/lib/memory-store/core"
import {
  DEFAULT_MEMORY_CONFIG,
  type MemoryEntry,
  type MemoryLayer,
  type MemoryScope,
} from "@/lib/memory-store/types"

export type MemoryEntrySource =
  | "manual"
  | "remember_tool"
  | "auto_learn"
  | "legacy_json"

type MemoryRow = {
  id: string
  scope: MemoryScope
  project_path: string | null
  text: string
  category: string | null
  layer: MemoryLayer
  source: MemoryEntrySource
  created_at: number
  last_used_at: number
  use_count: number
  base_salience: number
  archived: number
}

export type InsertMemoryEntryInput = {
  id?: string
  scope: MemoryScope
  workspace?: string
  text: string
  category?: string
  layer?: MemoryLayer
  source?: MemoryEntrySource
  createdAt?: number
  lastUsedAt?: number
  useCount?: number
  baseSalience?: number
}

function projectPath(scope: MemoryScope, workspace?: string): string | null {
  if (scope === "global") return null
  const ws = workspace?.replace(/[\\/]+$/, "")
  return ws || null
}

function scopeWhere(scope: MemoryScope, workspace?: string): { sql: string; params: unknown[] } {
  const path = projectPath(scope, workspace)
  if (path === null) return { sql: "scope = ? AND project_path IS NULL", params: [scope] }
  return { sql: "scope = ? AND project_path = ?", params: [scope, path] }
}

function rowToEntry(r: MemoryRow): MemoryEntry {
  return {
    id: r.id,
    text: r.text,
    layer: r.layer,
    scope: r.scope,
    category: r.category ?? undefined,
    createdAt: r.created_at,
    lastUsedAt: r.last_used_at,
    useCount: r.use_count,
    baseSalience: r.base_salience,
  }
}

function entryToParams(e: MemoryEntry, source: MemoryEntrySource, workspace?: string): unknown[] {
  return [
    e.id,
    e.scope,
    projectPath(e.scope, workspace),
    e.text,
    e.category ?? null,
    e.layer,
    source,
    e.createdAt,
    e.lastUsedAt,
    e.useCount,
    e.baseSalience,
    0,
  ]
}

async function insertRow(db: Db, entry: MemoryEntry, source: MemoryEntrySource, workspace?: string): Promise<void> {
  await db.exec(
    `INSERT INTO memory_entry
      (id, scope, project_path, text, category, layer, source, created_at, last_used_at, use_count, base_salience, archived)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       scope = excluded.scope,
       project_path = excluded.project_path,
       text = excluded.text,
       category = excluded.category,
       layer = excluded.layer,
       source = excluded.source,
       created_at = excluded.created_at,
       last_used_at = excluded.last_used_at,
       use_count = excluded.use_count,
       base_salience = excluded.base_salience,
       archived = excluded.archived`,
    entryToParams(entry, source, workspace),
  )
}

export async function listMemoryEntries(
  db: Db,
  opts: { scope: MemoryScope; workspace?: string; includeArchived?: boolean },
): Promise<MemoryEntry[]> {
  const rows = await listMemoryRows(db, opts)
  return rows.map(rowToEntry)
}

async function listMemoryRows(
  db: Db,
  opts: { scope: MemoryScope; workspace?: string; includeArchived?: boolean },
): Promise<MemoryRow[]> {
  const where = scopeWhere(opts.scope, opts.workspace)
  return db.select<MemoryRow>(
    `SELECT * FROM memory_entry
     WHERE ${where.sql}${opts.includeArchived ? "" : " AND archived = 0"}
     ORDER BY last_used_at DESC, created_at DESC`,
    where.params,
  )
}

async function replaceActiveEntries(
  db: Db,
  scope: MemoryScope,
  workspace: string | undefined,
  entries: MemoryEntry[],
  sourceForId: Map<string, MemoryEntrySource>,
  fallbackSource: MemoryEntrySource,
): Promise<void> {
  const where = scopeWhere(scope, workspace)
  await db.tx(async (t) => {
    await t.exec(`DELETE FROM memory_entry WHERE ${where.sql} AND archived = 0`, where.params)
    for (const e of entries) {
      await t.exec(
        `INSERT INTO memory_entry
          (id, scope, project_path, text, category, layer, source, created_at, last_used_at, use_count, base_salience, archived)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        entryToParams(e, sourceForId.get(e.id) ?? fallbackSource, workspace),
      )
    }
  })
}

export async function insertMemoryEntry(db: Db, input: InsertMemoryEntryInput): Promise<string | null> {
  const text = input.text.trim()
  if (!text) return null
  if (input.scope === "project" && !projectPath(input.scope, input.workspace)) return null
  const now = input.createdAt ?? Date.now()
  const entry: MemoryEntry = {
    id: input.id ?? createId("memory"),
    text,
    layer: input.layer ?? "episode",
    scope: input.scope,
    category: input.category?.trim() || undefined,
    createdAt: now,
    lastUsedAt: input.lastUsedAt ?? now,
    useCount: input.useCount ?? 0,
    baseSalience: Math.max(0, Math.min(1, input.baseSalience ?? 0.65)),
  }
  const source = input.source ?? "manual"
  await insertRow(db, entry, source, input.workspace)

  const rows = await listMemoryRows(db, { scope: input.scope, workspace: input.workspace })
  const sourceForId = new Map(rows.map((r) => [r.id, r.source] as const))
  const existing = rows.map(rowToEntry)
  const { entries } = consolidate(existing, now, DEFAULT_MEMORY_CONFIG)
  await replaceActiveEntries(db, input.scope, input.workspace, entries, sourceForId, source)
  return entry.id
}

export async function archiveMemoryEntriesByText(db: Db, opts: {
  scope: MemoryScope
  workspace?: string
  text: string
}): Promise<void> {
  const text = opts.text.trim()
  if (!text) return
  const where = scopeWhere(opts.scope, opts.workspace)
  await db.exec(
    `UPDATE memory_entry
     SET archived = 1
     WHERE ${where.sql} AND archived = 0 AND text = ?`,
    [...where.params, text],
  )
}

export async function loadMemoryContextBlockFromDb(db: Db, opts: {
  workspace?: string
  query?: string
  now?: number
  budgetTokens?: number
}): Promise<string> {
  const now = opts.now ?? Date.now()
  const [projectEntries, globalEntries] = await Promise.all([
    opts.workspace ? listMemoryEntries(db, { scope: "project", workspace: opts.workspace }) : Promise.resolve([]),
    listMemoryEntries(db, { scope: "global" }),
  ])
  const selected = selectForContext([...projectEntries, ...globalEntries], {
    now,
    query: opts.query,
    budgetTokens: opts.budgetTokens ?? DEFAULT_MEMORY_CONFIG.budgetTokens,
  })
  if (selected.length === 0) return ""
  void refreshMemoryUsage(db, selected.map((e) => e.id), now).catch(() => undefined)
  return renderMemoryBlock(selected)
}

async function refreshMemoryUsage(db: Db, ids: string[], now: number): Promise<void> {
  if (ids.length === 0) return
  await db.tx(async (t) => {
    for (const id of ids) {
      await t.exec(
        `UPDATE memory_entry
         SET use_count = use_count + 1, last_used_at = ?
         WHERE id = ? AND archived = 0`,
        [now, id],
      )
    }
  })
}
