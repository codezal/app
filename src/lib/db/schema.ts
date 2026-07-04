import type { Db } from "./driver"

export const SCHEMA_VERSION = 6

// parts AYRI tablo (positional key message_id+idx) — streaming'de incremental upsert
const DDL: string[] = [
  `CREATE TABLE IF NOT EXISTS project (
    path TEXT PRIMARY KEY,
    name TEXT,
    color TEXT,
    sort INTEGER NOT NULL DEFAULT 0,
    default_provider TEXT,
    default_model TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS session (
    id TEXT PRIMARY KEY,
    project_path TEXT,
    title TEXT NOT NULL DEFAULT '',
    updated_at INTEGER NOT NULL,
    data TEXT NOT NULL,
    pinned INTEGER NOT NULL DEFAULT 0,
    unread INTEGER NOT NULL DEFAULT 0,
    archived INTEGER NOT NULL DEFAULT 0
  )`,
  `CREATE INDEX IF NOT EXISTS session_updated ON session (updated_at DESC)`,
  `CREATE INDEX IF NOT EXISTS session_project ON session (project_path)`,
  `CREATE TABLE IF NOT EXISTS message (
    session_id TEXT NOT NULL,
    id TEXT NOT NULL,
    idx INTEGER NOT NULL,
    role TEXT NOT NULL,
    content TEXT NOT NULL DEFAULT '',
    model_msg_count INTEGER,
    data TEXT NOT NULL,
    PRIMARY KEY (session_id, id),
    FOREIGN KEY (session_id) REFERENCES session (id) ON DELETE CASCADE
  )`,
  `CREATE INDEX IF NOT EXISTS message_order ON message (session_id, idx)`,
  `CREATE TABLE IF NOT EXISTS part (
    session_id TEXT NOT NULL,
    message_id TEXT NOT NULL,
    idx INTEGER NOT NULL,
    type TEXT NOT NULL,
    data TEXT NOT NULL,
    PRIMARY KEY (session_id, message_id, idx),
    FOREIGN KEY (session_id, message_id) REFERENCES message (session_id, id) ON DELETE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS model_message (
    session_id TEXT NOT NULL,
    idx INTEGER NOT NULL,
    data TEXT NOT NULL,
    PRIMARY KEY (session_id, idx),
    FOREIGN KEY (session_id) REFERENCES session (id) ON DELETE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS app_meta (
    key TEXT PRIMARY KEY,
    value TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS project_permission (
    project_path TEXT PRIMARY KEY,
    data TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS memory_entry (
    id TEXT PRIMARY KEY,
    scope TEXT NOT NULL,
    project_path TEXT,
    text TEXT NOT NULL,
    category TEXT,
    layer TEXT NOT NULL DEFAULT 'episode',
    source TEXT NOT NULL DEFAULT 'manual',
    created_at INTEGER NOT NULL,
    last_used_at INTEGER NOT NULL,
    use_count INTEGER NOT NULL DEFAULT 0,
    base_salience REAL NOT NULL DEFAULT 0.65,
    archived INTEGER NOT NULL DEFAULT 0
  )`,
  `CREATE INDEX IF NOT EXISTS memory_entry_scope_project ON memory_entry (scope, project_path, archived)`,
  `CREATE INDEX IF NOT EXISTS memory_entry_last_used ON memory_entry (last_used_at DESC)`,
]

export async function applySchema(db: Db): Promise<void> {
  for (const stmt of DDL) await db.exec(stmt)
  await migrate(db)
  await db.exec(
    `INSERT INTO app_meta (key, value) VALUES ('schema_version', ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    [String(SCHEMA_VERSION)],
  )
}

async function migrate(db: Db): Promise<void> {
  const cols = await db.select<{ name: string }>(`PRAGMA table_info(session)`)
  const have = new Set(cols.map((c) => c.name))
  for (const col of ["pinned", "unread", "archived"]) {
    if (!have.has(col)) {
      await db.exec(`ALTER TABLE session ADD COLUMN ${col} INTEGER NOT NULL DEFAULT 0`)
    }
  }
  const projCols = await db.select<{ name: string }>(`PRAGMA table_info(project)`)
  const projHave = new Set(projCols.map((c) => c.name))
  for (const col of ["default_provider", "default_model"]) {
    if (!projHave.has(col)) {
      await db.exec(`ALTER TABLE project ADD COLUMN ${col} TEXT`)
    }
  }
  const ver = Number((await getMeta(db, "schema_version")) ?? "0")
  if (ver < 4) {
    const rows = await db.select<{ id: string; data: string }>(`SELECT id, data FROM session`)
    for (const r of rows) {
      let data: Record<string, unknown>
      try {
        data = JSON.parse(r.data)
      } catch {
        continue
      }
      const mm = data.modelMessages
      if (!Array.isArray(mm) || mm.length === 0) continue
      await db.tx(async (t) => {
        for (let i = 0; i < mm.length; i++) {
          await t.exec(
            `INSERT INTO model_message (session_id, idx, data) VALUES (?, ?, ?)
             ON CONFLICT(session_id, idx) DO UPDATE SET data = excluded.data`,
            [r.id, i, JSON.stringify(mm[i])],
          )
        }
        delete data.modelMessages
        await t.exec(`UPDATE session SET data = ? WHERE id = ?`, [JSON.stringify(data), r.id])
      })
    }
  }
}

export async function getMeta(db: Db, key: string): Promise<string | null> {
  const rows = await db.select<{ value: string }>(`SELECT value FROM app_meta WHERE key = ?`, [key])
  return rows[0]?.value ?? null
}

export async function setMeta(db: Db, key: string, value: string): Promise<void> {
  await db.exec(
    `INSERT INTO app_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    [key, value],
  )
}
