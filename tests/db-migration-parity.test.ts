// DB migration drift guard — the check-migrations equivalent for our SQLite layer.
//
// applySchema() maintains TWO hand-written column lists that must stay in sync:
//   1. the DDL `CREATE TABLE` (what a FRESH install gets)
//   2. the `migrate()` `ALTER TABLE ADD COLUMN`s (what an EXISTING user's DB gets)
//
// If a column is added to a CREATE but its ALTER is forgotten, a fresh install
// works while every existing user hits a runtime "no such column" SQL crash on
// the next session read/write. These tests catch that drift at dev time by
// upgrading a simulated old DB and asserting it ends up identical to a fresh one.
import { describe, it, expect } from "vitest"
import { nodeDb } from "./helpers/node-db"
import { applySchema, getMeta, SCHEMA_VERSION } from "@/lib/db/schema"

// The pre-migration (v1) shape of every table that migrate() later alters.
// This is a FIXED historical baseline — never update it to match new columns.
// When a future migration targets a new table, add that table's v1 shape here.
const V1_SESSION = `CREATE TABLE session (
  id TEXT PRIMARY KEY,
  project_path TEXT,
  title TEXT NOT NULL DEFAULT '',
  updated_at INTEGER NOT NULL,
  data TEXT NOT NULL
)`
const V1_PROJECT = `CREATE TABLE project (
  path TEXT PRIMARY KEY,
  name TEXT,
  color TEXT,
  sort INTEGER NOT NULL DEFAULT 0
)`

async function columns(db: ReturnType<typeof nodeDb>, table: string): Promise<string[]> {
  const rows = await db.select<{ name: string }>(`PRAGMA table_info(${table})`)
  return rows.map((r) => r.name).sort()
}

// Build a DB that started life at v1 and was upgraded by applySchema()'s
// migrate(). Pre-creating the old tables means CREATE ... IF NOT EXISTS no-ops
// (keeping the column-poor v1 tables), so only the ALTERs can add the rest —
// exactly what happens on a real existing user's machine.
async function upgradedFromV1(): Promise<ReturnType<typeof nodeDb>> {
  const db = nodeDb()
  await db.exec(V1_SESSION)
  await db.exec(V1_PROJECT)
  await applySchema(db)
  return db
}

describe("DB migration parity (fresh vs upgraded)", () => {
  it("an upgraded v1 DB has the same columns as a fresh DB", async () => {
    const fresh = nodeDb()
    await applySchema(fresh)
    const upgraded = await upgradedFromV1()
    try {
      // If these differ, a column exists in a CREATE TABLE but its
      // ALTER TABLE ADD COLUMN is missing from migrate() (or vice versa).
      expect(await columns(upgraded, "session")).toEqual(await columns(fresh, "session"))
      expect(await columns(upgraded, "project")).toEqual(await columns(fresh, "project"))
    } finally {
      fresh.close()
      upgraded.close()
    }
  })

  it("migration preserves existing rows and defaults the new columns", async () => {
    const db = nodeDb()
    await db.exec(V1_SESSION)
    // A row written by the old app, before the flag columns existed.
    await db.exec(`INSERT INTO session (id, title, updated_at, data) VALUES ('s1', 'hi', 5, '{}')`)
    await applySchema(db)
    try {
      const rows = await db.select<Record<string, unknown>>(
        `SELECT id, title, updated_at, pinned, unread, archived FROM session WHERE id = 's1'`,
      )
      expect(rows[0]).toMatchObject({
        id: "s1",
        title: "hi",
        updated_at: 5,
        pinned: 0,
        unread: 0,
        archived: 0,
      })
    } finally {
      db.close()
    }
  })

  it("applySchema is idempotent on an already-upgraded DB", async () => {
    const db = await upgradedFromV1()
    try {
      await applySchema(db) // second run must not throw or duplicate columns
      expect(await getMeta(db, "schema_version")).toBe(String(SCHEMA_VERSION))
    } finally {
      db.close()
    }
  })
})
