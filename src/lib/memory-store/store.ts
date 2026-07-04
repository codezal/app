// Runtime learned-memory bridge. New learned facts are stored in SQLite; the old
// `.codezal/memories.json` / `~/.codezal/memories.json` files are imported once
// per scope as a compatibility path.
import { exists, readTextFile } from "@tauri-apps/plugin-fs"
import { homeDir } from "@tauri-apps/api/path"
import type { Db } from "@/lib/db/driver"
import { getMeta, setMeta } from "@/lib/db/schema"
import {
  archiveMemoryEntriesByText,
  insertMemoryEntry,
  loadMemoryContextBlockFromDb,
  type MemoryEntrySource,
} from "@/lib/db/memory-db"
import {
  type MemoryEntry,
  type MemoryScope,
  type MemoryLayer,
  type MemoryStoreFile,
} from "./types"

function joinPath(...parts: string[]): string {
  return parts
    .map((p, i) => (i === 0 ? p.replace(/[\\/]+$/, "") : p.replace(/^[\\/]+|[\\/]+$/g, "")))
    .filter(Boolean)
    .join("/")
}

async function resolveRuntimeDb(): Promise<Db | null> {
  try {
    const mod = await import("@/lib/db")
    return mod.db
  } catch {
    return null
  }
}

async function legacyStorePath(scope: MemoryScope, workspace?: string): Promise<string | null> {
  if (scope === "project") {
    if (!workspace) return null
    return joinPath(workspace, ".codezal", "memories.json")
  }
  try {
    return joinPath(await homeDir(), ".codezal", "memories.json")
  } catch {
    return null
  }
}

function isValidEntry(e: unknown): e is MemoryEntry {
  const o = e as MemoryEntry
  return (
    !!o &&
    typeof o.id === "string" &&
    typeof o.text === "string" &&
    (o.layer === "identity" || o.layer === "pinned" || o.layer === "episode") &&
    typeof o.createdAt === "number"
  )
}

async function readLegacyEntries(path: string): Promise<MemoryEntry[]> {
  try {
    if (!(await exists(path))) return []
    const parsed = JSON.parse(await readTextFile(path)) as MemoryStoreFile
    if (!parsed || !Array.isArray(parsed.entries)) return []
    return parsed.entries.filter(isValidEntry)
  } catch {
    return []
  }
}

function importKey(scope: MemoryScope, workspace?: string): string {
  return scope === "global"
    ? "memory_json_imported:global"
    : `memory_json_imported:project:${workspace?.replace(/[\\/]+$/, "") ?? ""}`
}

async function importLegacyIfNeeded(db: Db, scope: MemoryScope, workspace?: string): Promise<void> {
  const key = importKey(scope, workspace)
  if (await getMeta(db, key)) return
  const path = await legacyStorePath(scope, workspace)
  if (path) {
    const entries = await readLegacyEntries(path)
    for (const e of entries) {
      await insertMemoryEntry(db, {
        id: e.id,
        scope: e.scope,
        workspace,
        text: e.text,
        category: e.category,
        layer: e.layer,
        source: "legacy_json",
        createdAt: e.createdAt,
        lastUsedAt: e.lastUsedAt,
        useCount: e.useCount,
        baseSalience: e.baseSalience,
      })
    }
  }
  await setMeta(db, key, "1")
}

export interface CaptureInput {
  scope: MemoryScope
  text: string
  workspace?: string
  category?: string
  layer?: MemoryLayer
  baseSalience?: number
  source?: MemoryEntrySource
}

export async function captureMemory(input: CaptureInput, dbArg?: Db): Promise<void> {
  const db = dbArg ?? (await resolveRuntimeDb())
  if (!db) return
  await importLegacyIfNeeded(db, input.scope, input.workspace)
  await insertMemoryEntry(db, {
    scope: input.scope,
    workspace: input.workspace,
    text: input.text,
    category: input.category,
    layer: input.layer,
    baseSalience: input.baseSalience,
    source: input.source ?? "manual",
  })
}

export async function forgetMemory(input: {
  scope: MemoryScope
  text: string
  workspace?: string
}, dbArg?: Db): Promise<void> {
  const db = dbArg ?? (await resolveRuntimeDb())
  if (!db) return
  await archiveMemoryEntriesByText(db, input)
}

export async function loadMemoryContextBlock(opts: {
  workspace?: string
  query?: string
  now?: number
  budgetTokens?: number
  db?: Db
}): Promise<string> {
  const db = opts.db ?? (await resolveRuntimeDb())
  if (!db) return ""
  await Promise.all([
    opts.workspace ? importLegacyIfNeeded(db, "project", opts.workspace) : Promise.resolve(),
    importLegacyIfNeeded(db, "global"),
  ])
  return loadMemoryContextBlockFromDb(db, opts)
}
