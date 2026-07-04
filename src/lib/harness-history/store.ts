import type { Db } from "@/lib/db/driver"
import { cosine } from "@/lib/embedding"
import type { HarnessKind, HarnessMessage, HarnessThread, ThreadHit } from "./types"

const DDL: string[] = [
  `CREATE TABLE IF NOT EXISTS hh_thread (
    id TEXT PRIMARY KEY,
    harness TEXT NOT NULL,
    native_id TEXT NOT NULL,
    project_path TEXT,
    title TEXT NOT NULL DEFAULT '',
    started_at INTEGER,
    updated_at INTEGER,
    message_count INTEGER NOT NULL DEFAULT 0,
    source_ref TEXT NOT NULL,
    mtime INTEGER NOT NULL DEFAULT 0,
    indexed_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS hh_thread_updated ON hh_thread (updated_at DESC)`,
  `CREATE INDEX IF NOT EXISTS hh_thread_harness ON hh_thread (harness)`,
  `CREATE TABLE IF NOT EXISTS hh_message (
    thread_id TEXT NOT NULL,
    idx INTEGER NOT NULL,
    role TEXT NOT NULL,
    text TEXT NOT NULL,
    ts INTEGER,
    PRIMARY KEY (thread_id, idx),
    FOREIGN KEY (thread_id) REFERENCES hh_thread (id) ON DELETE CASCADE
  )`,
  `CREATE VIRTUAL TABLE IF NOT EXISTS hh_fts USING fts5(
    text, title, thread_id UNINDEXED, harness UNINDEXED,
    tokenize = 'unicode61 remove_diacritics 2'
  )`,
  `CREATE TABLE IF NOT EXISTS hh_vec (
    thread_id TEXT PRIMARY KEY,
    dim INTEGER NOT NULL,
    vec TEXT NOT NULL,
    FOREIGN KEY (thread_id) REFERENCES hh_thread (id) ON DELETE CASCADE
  )`,
]

export async function ensureHistorySchema(db: Db): Promise<void> {
  for (const stmt of DDL) await db.exec(stmt)
}

export async function getIndexedMtimes(db: Db): Promise<Map<string, number>> {
  const rows = await db.select<{ id: string; mtime: number }>(`SELECT id, mtime FROM hh_thread`)
  return new Map(rows.map((r) => [r.id, r.mtime]))
}

export async function upsertThread(
  db: Db,
  thread: HarnessThread,
  mtime: number,
  indexedAt: number,
): Promise<void> {
  await db.tx(async (t) => {
    await t.exec(`DELETE FROM hh_fts WHERE thread_id = ?`, [thread.id])
    await t.exec(`DELETE FROM hh_thread WHERE id = ?`, [thread.id])
    await t.exec(
      `INSERT INTO hh_thread
        (id, harness, native_id, project_path, title, started_at, updated_at, message_count, source_ref, mtime, indexed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        thread.id,
        thread.harness,
        thread.nativeId,
        thread.projectPath ?? null,
        thread.title,
        thread.startedAt ?? null,
        thread.updatedAt ?? null,
        thread.messages.length,
        thread.sourceRef,
        mtime,
        indexedAt,
      ],
    )
    for (let i = 0; i < thread.messages.length; i++) {
      const m: HarnessMessage = thread.messages[i]
      await t.exec(`INSERT INTO hh_message (thread_id, idx, role, text, ts) VALUES (?, ?, ?, ?, ?)`, [
        thread.id,
        i,
        m.role,
        m.text,
        m.ts ?? null,
      ])
      await t.exec(`INSERT INTO hh_fts (text, title, thread_id, harness) VALUES (?, ?, ?, ?)`, [
        m.text,
        thread.title,
        thread.id,
        thread.harness,
      ])
    }
  })
}

export async function pruneMissing(
  db: Db,
  keepIds: Set<string>,
  harnesses: Set<HarnessKind>,
): Promise<number> {
  const rows = await db.select<{ id: string; harness: HarnessKind }>(
    `SELECT id, harness FROM hh_thread`,
  )
  const dead = rows.filter((r) => harnesses.has(r.harness) && !keepIds.has(r.id)).map((r) => r.id)
  if (dead.length === 0) return 0
  await db.tx(async (t) => {
    for (const id of dead) {
      await t.exec(`DELETE FROM hh_fts WHERE thread_id = ?`, [id])
      await t.exec(`DELETE FROM hh_thread WHERE id = ?`, [id])
    }
  })
  return dead.length
}

function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`)
}

export function buildFtsMatch(query: string): string {
  const tokens = query.toLowerCase().match(/[\p{L}\p{N}_]+/gu) ?? []
  const uniq = [...new Set(tokens)].filter((tk) => tk.length >= 2)
  if (uniq.length === 0) return ""
  return uniq.map((tk) => `"${tk.replace(/"/g, '""')}"`).join(" OR ")
}

export type SearchOpts = {
  limit?: number
  harness?: HarnessKind
  projectContains?: string
}

export async function searchThreads(
  db: Db,
  query: string,
  opts: SearchOpts = {},
): Promise<ThreadHit[]> {
  const match = buildFtsMatch(query)
  if (!match) return []
  const limit = opts.limit ?? 30
  const params: unknown[] = [match]
  let where = `hh_fts MATCH ?`
  if (opts.harness) {
    where += ` AND f.harness = ?`
    params.push(opts.harness)
  }
  if (opts.projectContains) {
    where += ` AND t.project_path LIKE ? ESCAPE '\\'`
    params.push(`%${escapeLike(opts.projectContains)}%`)
  }
  const fetch = Math.max(limit * 6, 120)
  params.push(fetch)
  const rows = await db.select<{
    threadId: string
    harness: HarnessKind
    title: string
    projectPath: string | null
    updatedAt: number | null
    score: number
    snippet: string
  }>(
    `SELECT f.thread_id AS threadId, f.harness AS harness, t.title AS title,
            t.project_path AS projectPath, t.updated_at AS updatedAt,
            bm25(hh_fts) AS score,
            snippet(hh_fts, 0, '[', ']', '…', 12) AS snippet
     FROM hh_fts f
     JOIN hh_thread t ON t.id = f.thread_id
     WHERE ${where}
     ORDER BY score
     LIMIT ?`,
    params,
  )
  const seen = new Set<string>()
  const hits: ThreadHit[] = []
  for (const r of rows) {
    if (seen.has(r.threadId)) continue
    seen.add(r.threadId)
    hits.push({
      threadId: r.threadId,
      harness: r.harness,
      title: r.title,
      projectPath: r.projectPath ?? undefined,
      updatedAt: r.updatedAt ?? undefined,
      score: r.score,
      snippet: r.snippet,
    })
    if (hits.length >= limit) break
  }
  return hits
}

export type ThreadRow = {
  threadId: string
  harness: HarnessKind
  title: string
  projectPath?: string
  updatedAt?: number
  messageCount: number
}

export async function listThreads(
  db: Db,
  opts: { limit?: number; harness?: HarnessKind; projectContains?: string } = {},
): Promise<ThreadRow[]> {
  const params: unknown[] = []
  let where = ``
  if (opts.harness) {
    where += `${where ? " AND" : " WHERE"} harness = ?`
    params.push(opts.harness)
  }
  if (opts.projectContains) {
    where += `${where ? " AND" : " WHERE"} project_path LIKE ? ESCAPE '\\'`
    params.push(`%${escapeLike(opts.projectContains)}%`)
  }
  params.push(opts.limit ?? 50)
  const rows = await db.select<{
    threadId: string
    harness: HarnessKind
    title: string
    projectPath: string | null
    updatedAt: number | null
    messageCount: number
  }>(
    `SELECT id AS threadId, harness, title, project_path AS projectPath,
            updated_at AS updatedAt, message_count AS messageCount
     FROM hh_thread${where}
     ORDER BY updated_at DESC
     LIMIT ?`,
    params,
  )
  return rows.map((r) => ({
    threadId: r.threadId,
    harness: r.harness,
    title: r.title,
    projectPath: r.projectPath ?? undefined,
    updatedAt: r.updatedAt ?? undefined,
    messageCount: r.messageCount,
  }))
}

export async function getThreadMessages(db: Db, threadId: string): Promise<HarnessMessage[]> {
  const rows = await db.select<{ role: string; text: string; ts: number | null }>(
    `SELECT role, text, ts FROM hh_message WHERE thread_id = ? ORDER BY idx`,
    [threadId],
  )
  return rows.map((r) => ({
    role: r.role as HarnessMessage["role"],
    text: r.text,
    ts: r.ts ?? undefined,
  }))
}

export async function historyStats(
  db: Db,
): Promise<{ harness: HarnessKind; threads: number; messages: number }[]> {
  return db.select<{ harness: HarnessKind; threads: number; messages: number }>(
    `SELECT harness, COUNT(*) AS threads, COALESCE(SUM(message_count), 0) AS messages
     FROM hh_thread GROUP BY harness`,
  )
}


export function threadEmbedText(thread: HarnessThread): string {
  const parts = [thread.title]
  let len = thread.title.length
  for (const m of thread.messages) {
    parts.push(m.text)
    len += m.text.length
    if (len > 2000) break
  }
  return parts.join("\n").slice(0, 2000)
}

export async function upsertThreadVector(db: Db, threadId: string, vec: number[]): Promise<void> {
  await db.exec(
    `INSERT INTO hh_vec (thread_id, dim, vec) VALUES (?, ?, ?)
     ON CONFLICT(thread_id) DO UPDATE SET dim = excluded.dim, vec = excluded.vec`,
    [threadId, vec.length, JSON.stringify(vec)],
  )
}

export async function hasVectors(db: Db): Promise<boolean> {
  const r = await db.select<{ n: number }>(`SELECT COUNT(*) AS n FROM hh_vec`)
  return (r[0]?.n ?? 0) > 0
}

export async function semanticRank(
  db: Db,
  queryVec: number[],
  opts: SearchOpts = {},
): Promise<{ threadId: string; score: number }[]> {
  let sql = `SELECT v.thread_id AS threadId, v.vec AS vec FROM hh_vec v`
  const params: unknown[] = []
  const conds: string[] = []
  if (opts.harness || opts.projectContains) {
    sql += ` JOIN hh_thread t ON t.id = v.thread_id`
    if (opts.harness) {
      conds.push(`t.harness = ?`)
      params.push(opts.harness)
    }
    if (opts.projectContains) {
      conds.push(`t.project_path LIKE ? ESCAPE '\\'`)
      params.push(`%${escapeLike(opts.projectContains)}%`)
    }
  }
  if (conds.length) sql += ` WHERE ${conds.join(" AND ")}`
  const rows = await db.select<{ threadId: string; vec: string }>(sql, params)
  const scored: { threadId: string; score: number }[] = []
  for (const r of rows) {
    let v: number[]
    try {
      v = JSON.parse(r.vec) as number[]
    } catch {
      continue
    }
    scored.push({ threadId: r.threadId, score: cosine(queryVec, v) })
  }
  scored.sort((a, b) => b.score - a.score)
  return scored.slice(0, opts.limit ?? 50)
}

async function threadMeta(
  db: Db,
  threadId: string,
): Promise<Omit<ThreadHit, "score"> | null> {
  const t = await db.select<{
    harness: HarnessKind
    title: string
    projectPath: string | null
    updatedAt: number | null
  }>(
    `SELECT harness, title, project_path AS projectPath, updated_at AS updatedAt
     FROM hh_thread WHERE id = ?`,
    [threadId],
  )
  if (!t[0]) return null
  const m = await db.select<{ text: string }>(
    `SELECT text FROM hh_message WHERE thread_id = ? ORDER BY idx LIMIT 1`,
    [threadId],
  )
  return {
    threadId,
    harness: t[0].harness,
    title: t[0].title,
    projectPath: t[0].projectPath ?? undefined,
    updatedAt: t[0].updatedAt ?? undefined,
    snippet: (m[0]?.text ?? "").slice(0, 120),
  }
}

export async function hybridSearch(
  db: Db,
  query: string,
  queryVec: number[] | null,
  opts: SearchOpts = {},
): Promise<ThreadHit[]> {
  const limit = opts.limit ?? 30
  const wide = Math.max(limit * 2, 50)
  const kw = await searchThreads(db, query, { ...opts, limit: wide })
  if (!queryVec) return kw.slice(0, limit)

  const sem = await semanticRank(db, queryVec, { ...opts, limit: wide })
  const k = 60
  const rrf = new Map<string, number>()
  kw.forEach((h, i) => rrf.set(h.threadId, (rrf.get(h.threadId) ?? 0) + 1 / (k + i)))
  sem.forEach((s, i) => rrf.set(s.threadId, (rrf.get(s.threadId) ?? 0) + 1 / (k + i)))

  const byId = new Map(kw.map((h) => [h.threadId, h]))
  const ranked = [...rrf.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit)
  const out: ThreadHit[] = []
  for (const [tid, r] of ranked) {
    const kwHit = byId.get(tid)
    if (kwHit) {
      out.push({ ...kwHit, score: -r })
      continue
    }
    const meta = await threadMeta(db, tid)
    if (meta) out.push({ ...meta, score: -r })
  }
  return out
}
