//   session: id,project_path(=workspacePath),title,updated_at kolon; gerisi data
//            (provider,model,openFiles,activeFile,usage,mode,orchestra,goal,todos,
//   message: id,idx,role,content,model_msg_count kolon; gerisi data
//            (images(base64),pending,snapshotBase). parts AYRI tabloda.
//   part: (message_id, idx) positional key; data = tam Part nesnesi. Streaming'de
import type { Db } from "./driver"
import type { ModelMessage } from "ai"
import type { AgentMode, Message, Part, ProjectMeta, Session, SessionMeta, SessionUsage } from "@/store/types"
import type { PermissionRule } from "@/lib/permission/types"
import type { ProviderId } from "@/lib/providers"
import type { SessionUsageRow } from "@/lib/stats"

type SessionRow = {
  id: string
  project_path: string | null
  title: string
  updated_at: number
  data: string
  pinned: number
  unread: number
  archived: number
}

type MessageRow = {
  session_id: string
  id: string
  idx: number
  role: string
  content: string
  model_msg_count: number | null
  data: string
}

type PartRow = { message_id: string; idx: number; data: string }


function sessionToRow(s: Session): SessionRow {
  const { id, title, updatedAt, workspacePath, pinned, unread, archived, ...rest } = s
  const data = { ...rest } as Record<string, unknown>
  delete data.messages
  delete data.modelMessages
  return {
    id,
    project_path: workspacePath ?? null,
    title,
    updated_at: updatedAt,
    data: JSON.stringify(data),
    pinned: pinned ? 1 : 0,
    unread: unread ? 1 : 0,
    archived: archived ? 1 : 0,
  }
}

function rowToSession(r: SessionRow): Session {
  const data = JSON.parse(r.data) as Omit<
    Session,
    "id" | "title" | "updatedAt" | "workspacePath" | "messages" | "modelMessages" | "pinned" | "unread" | "archived"
  >
  const s: Session = {
    ...data,
    id: r.id,
    title: r.title,
    updatedAt: r.updated_at,
    workspacePath: r.project_path ?? undefined,
    messages: [],
  }
  if (r.pinned) s.pinned = true
  if (r.unread) s.unread = true
  if (r.archived) s.archived = true
  return s
}

function messageToRow(sid: string, idx: number, m: Message): MessageRow {
  const { id, role, content, modelMsgCount, ...rest } = m
  const data = { ...rest } as Record<string, unknown>
  delete data.parts
  return {
    session_id: sid,
    id,
    idx,
    role,
    content,
    model_msg_count: modelMsgCount ?? null,
    data: JSON.stringify(data),
  }
}

function rowToMessage(r: MessageRow): Message {
  const data = JSON.parse(r.data) as Omit<Message, "id" | "role" | "content" | "modelMsgCount" | "parts">
  return {
    ...data,
    id: r.id,
    role: r.role as Message["role"],
    content: r.content,
    modelMsgCount: r.model_msg_count ?? undefined,
    pending: false,
    compacting: false,
  }
}

// ─── Part'lar ──────────────────────────────────────────────────────────────────

export async function persistParts(
  db: Db,
  sid: string,
  mid: string,
  parts: Part[],
  dirtyFrom = 0,
): Promise<void> {
  for (let i = Math.max(0, dirtyFrom); i < parts.length; i++) {
    await db.exec(
      `INSERT INTO part (session_id, message_id, idx, type, data) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(session_id, message_id, idx) DO UPDATE SET type = excluded.type, data = excluded.data`,
      [sid, mid, i, parts[i].type, JSON.stringify(parts[i])],
    )
  }
  await db.exec(`DELETE FROM part WHERE session_id = ? AND message_id = ? AND idx >= ?`, [
    sid,
    mid,
    parts.length,
  ])
}

const PART_ID_CHUNK = 500

async function attachParts(db: Db, sid: string, msgs: Message[]): Promise<Message[]> {
  if (msgs.length === 0) return msgs
  const ids = msgs.map((m) => m.id)
  const byMsg = new Map<string, Part[]>()
  for (let off = 0; off < ids.length; off += PART_ID_CHUNK) {
    const batch = ids.slice(off, off + PART_ID_CHUNK)
    const placeholders = batch.map(() => "?").join(",")
    const rows = await db.select<PartRow>(
      `SELECT message_id, idx, data FROM part
       WHERE session_id = ? AND message_id IN (${placeholders})
       ORDER BY message_id, idx`,
      [sid, ...batch],
    )
    for (const r of rows) {
      let arr = byMsg.get(r.message_id)
      if (!arr) {
        arr = []
        byMsg.set(r.message_id, arr)
      }
      arr.push(JSON.parse(r.data) as Part)
    }
  }
  for (const m of msgs) {
    const p = byMsg.get(m.id)
    if (p && p.length > 0) m.parts = p
  }
  return msgs
}

// ─── Session ────────────────────────────────────────────────────────────────

export async function listSessionMetas(db: Db): Promise<SessionMeta[]> {
  const rows = await db.select<
    Pick<SessionRow, "id" | "title" | "updated_at" | "project_path" | "pinned" | "unread" | "archived" | "data">
  >(
    `SELECT id, title, updated_at, project_path, pinned, unread, archived, data
     FROM session ORDER BY updated_at DESC`,
  )
  return rows.map((r) => {
    const m: SessionMeta = {
      id: r.id,
      title: r.title,
      updatedAt: r.updated_at,
      workspacePath: r.project_path ?? undefined,
    }
    if (r.pinned) m.pinned = true
    if (r.unread) m.unread = true
    if (r.archived) m.archived = true
    try {
      const d = JSON.parse(r.data) as {
        forkParentId?: string
        routineId?: string
        handle?: string
        lastUserMessageAt?: number
      }
      if (d.forkParentId) m.forkParentId = d.forkParentId
      if (d.routineId) m.routineId = d.routineId
      // handle data blob'da — peer adresleme (resolveHandle) + sidebar rozeti
      if (d.handle) m.handle = d.handle
      // sidebar sıralaması + sağdaki tarih bu alana bakar (yoksa updatedAt fallback)
      if (typeof d.lastUserMessageAt === "number") m.lastUserMessageAt = d.lastUserMessageAt
    } catch {
      // Intentionally ignored.
    }
    return m
  })
}

export async function listSessionsByRoutineId(
  db: Db,
  routineId: string,
): Promise<SessionMeta[]> {
  const escaped = JSON.stringify(routineId).replace(/[\\%_]/g, "\\$&")
  const rows = await db.select<
    Pick<SessionRow, "id" | "title" | "updated_at" | "project_path" | "pinned" | "unread" | "archived" | "data">
  >(
    `SELECT id, title, updated_at, project_path, pinned, unread, archived, data
     FROM session WHERE data LIKE ? ESCAPE '\\' ORDER BY updated_at DESC`,
    [`%"routineId":${escaped}%`],
  )
  return rows.map((r) => {
    const m: SessionMeta = {
      id: r.id,
      title: r.title,
      updatedAt: r.updated_at,
      workspacePath: r.project_path ?? undefined,
    }
    if (r.pinned) m.pinned = true
    if (r.unread) m.unread = true
    if (r.archived) m.archived = true
    try {
      const d = JSON.parse(r.data) as {
        forkParentId?: string
        routineId?: string
        lastUserMessageAt?: number
      }
      if (d.forkParentId) m.forkParentId = d.forkParentId
      if (d.routineId) m.routineId = d.routineId
      if (typeof d.lastUserMessageAt === "number") m.lastUserMessageAt = d.lastUserMessageAt
    } catch {
      // bozuk data → skip
    }
    return m
  })
}

export async function loadSessionScalar(db: Db, id: string): Promise<Session | null> {
  const rows = await db.select<SessionRow>(`SELECT * FROM session WHERE id = ?`, [id])
  return rows[0] ? rowToSession(rows[0]) : null
}


export async function listSessionUsage(db: Db): Promise<SessionUsageRow[]> {
  const rows = await db.select<Pick<SessionRow, "id" | "updated_at" | "project_path" | "data">>(
    `SELECT id, updated_at, project_path, data FROM session`,
  )
  const out: SessionUsageRow[] = []
  for (const r of rows) {
    let d: {
      provider?: string
      model?: string
      mode?: AgentMode
      reasoningEffort?: string
      usage?: SessionUsage
    }
    try {
      d = JSON.parse(r.data)
    } catch {
      continue
    }
    const u = d.usage
    out.push({
      id: r.id,
      updatedAt: r.updated_at,
      projectPath: r.project_path ?? undefined,
      provider: (d.provider ?? "unknown") as ProviderId,
      model: d.model ?? "unknown",
      mode: d.mode ?? "build",
      reasoningEffort: d.reasoningEffort,
      inputTokens: u?.inputTokens ?? 0,
      outputTokens: u?.outputTokens ?? 0,
      cacheReadTokens: u?.cacheReadTokens ?? 0,
      cacheWriteTokens: u?.cacheWriteTokens ?? 0,
      reasoningTokens: u?.reasoningTokens ?? 0,
      costUsd: u?.costUsd ?? 0,
      turns: u?.turns ?? 0,
    })
  }
  return out
}

export async function countAllMessages(db: Db): Promise<number> {
  const r = await db.select<{ n: number }>(`SELECT COUNT(*) AS n FROM message`)
  return Number(r[0]?.n ?? 0)
}


export async function persistModelMessages(
  db: Db,
  sid: string,
  msgs: ModelMessage[],
  dirtyFrom = 0,
): Promise<void> {
  for (let i = Math.max(0, dirtyFrom); i < msgs.length; i++) {
    await db.exec(
      `INSERT INTO model_message (session_id, idx, data) VALUES (?, ?, ?)
       ON CONFLICT(session_id, idx) DO UPDATE SET data = excluded.data`,
      [sid, i, JSON.stringify(msgs[i])],
    )
  }
  await db.exec(`DELETE FROM model_message WHERE session_id = ? AND idx >= ?`, [sid, msgs.length])
}

export async function loadModelMessages(db: Db, sid: string): Promise<ModelMessage[]> {
  const rows = await db.select<{ data: string }>(
    `SELECT data FROM model_message WHERE session_id = ? ORDER BY idx ASC`,
    [sid],
  )
  return rows.map((r) => JSON.parse(r.data) as ModelMessage)
}

export async function upsertSessionRow(db: Db, s: Session): Promise<void> {
  const r = sessionToRow(s)
  await db.exec(
    `INSERT INTO session (id, project_path, title, updated_at, data, pinned, unread, archived)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       project_path = excluded.project_path,
       title = excluded.title,
       updated_at = excluded.updated_at,
       data = excluded.data,
       pinned = excluded.pinned,
       unread = excluded.unread,
       archived = excluded.archived`,
    [r.id, r.project_path, r.title, r.updated_at, r.data, r.pinned, r.unread, r.archived],
  )
}

export type SessionColumnPatch = {
  title?: string
  workspacePath?: string
  pinned?: boolean
  unread?: boolean
  archived?: boolean
}

export async function updateSessionColumns(
  db: Db,
  id: string,
  patch: SessionColumnPatch,
): Promise<void> {
  const sets: string[] = []
  const vals: unknown[] = []
  if ("title" in patch) {
    sets.push("title = ?")
    vals.push(patch.title ?? "")
  }
  if ("workspacePath" in patch) {
    sets.push("project_path = ?")
    vals.push(patch.workspacePath ?? null)
  }
  if ("pinned" in patch) {
    sets.push("pinned = ?")
    vals.push(patch.pinned ? 1 : 0)
  }
  if ("unread" in patch) {
    sets.push("unread = ?")
    vals.push(patch.unread ? 1 : 0)
  }
  if ("archived" in patch) {
    sets.push("archived = ?")
    vals.push(patch.archived ? 1 : 0)
  }
  if (sets.length === 0) return
  vals.push(id)
  await db.exec(`UPDATE session SET ${sets.join(", ")} WHERE id = ?`, vals)
}

export async function deleteSessionRow(db: Db, id: string): Promise<void> {
  await db.tx(async (t) => {
    await t.exec(`DELETE FROM message WHERE session_id = ?`, [id])
    await t.exec(`DELETE FROM session WHERE id = ?`, [id])
  })
}

export async function deleteSessionsOlderThan(db: Db, cutoffMs: number): Promise<number> {
  const rows = await db.select<{ id: string }>(
    `SELECT id FROM session WHERE updated_at < ? AND pinned = 0 AND archived = 0`,
    [cutoffMs],
  )
  if (rows.length === 0) return 0
  await db.tx(async (t) => {
    for (const r of rows) {
      await t.exec(`DELETE FROM message WHERE session_id = ?`, [r.id])
      await t.exec(`DELETE FROM session WHERE id = ?`, [r.id])
    }
  })
  return rows.length
}

// ─── Message ──────────────────────────────────────────────────────────────────

export async function countMessages(db: Db, sid: string): Promise<number> {
  const rows = await db.select<{ n: number }>(
    `SELECT COUNT(*) AS n FROM message WHERE session_id = ?`,
    [sid],
  )
  return rows[0]?.n ?? 0
}

export async function nextMessageSeq(db: Db, sid: string): Promise<number> {
  const rows = await db.select<{ m: number | null }>(
    `SELECT MAX(idx) AS m FROM message WHERE session_id = ?`,
    [sid],
  )
  return (rows[0]?.m ?? -1) + 1
}

export async function loadMessagesPage(
  db: Db,
  sid: string,
  opts: { beforeIdx?: number; limit: number },
): Promise<{ messages: Message[]; oldestIdx: number | null; hasOlder: boolean }> {
  const before = opts.beforeIdx ?? Number.MAX_SAFE_INTEGER
  const rows = await db.select<MessageRow>(
    `SELECT * FROM message WHERE session_id = ? AND idx < ? ORDER BY idx DESC LIMIT ?`,
    [sid, before, opts.limit + 1],
  )
  const hasOlder = rows.length > opts.limit
  const page = hasOlder ? rows.slice(0, opts.limit) : rows
  const oldestIdx = page.length ? (page[page.length - 1]!.idx ?? null) : null
  const messages = await attachParts(db, sid, page.reverse().map(rowToMessage))
  return { messages, oldestIdx, hasOlder }
}

export async function loadAllMessages(db: Db, sid: string): Promise<Message[]> {
  const rows = await db.select<MessageRow>(
    `SELECT * FROM message WHERE session_id = ? ORDER BY idx ASC`,
    [sid],
  )
  return attachParts(db, sid, rows.map(rowToMessage))
}

export async function firstUserMessage(db: Db, sid: string): Promise<Message | null> {
  const rows = await db.select<MessageRow>(
    `SELECT * FROM message WHERE session_id = ? AND role = 'user' ORDER BY idx ASC LIMIT 1`,
    [sid],
  )
  return rows[0] ? rowToMessage(rows[0]) : null
}

export async function userMessages(db: Db, sid: string): Promise<Message[]> {
  const rows = await db.select<MessageRow>(
    `SELECT * FROM message WHERE session_id = ? AND role = 'user' ORDER BY idx ASC`,
    [sid],
  )
  return rows.map(rowToMessage)
}

export async function messageById(db: Db, sid: string, mid: string): Promise<Message | null> {
  const rows = await db.select<MessageRow>(
    `SELECT * FROM message WHERE session_id = ? AND id = ?`,
    [sid, mid],
  )
  if (!rows[0]) return null
  const [m] = await attachParts(db, sid, [rowToMessage(rows[0])])
  return m
}

export async function messageIdx(db: Db, sid: string, mid: string): Promise<number | null> {
  const rows = await db.select<{ idx: number }>(
    `SELECT idx FROM message WHERE session_id = ? AND id = ?`,
    [sid, mid],
  )
  return rows[0]?.idx ?? null
}

export async function insertMessageInto(
  t: Db,
  sid: string,
  idx: number,
  m: Message,
): Promise<void> {
  const r = messageToRow(sid, idx, m)
  await t.exec(
    `INSERT INTO message (session_id, id, idx, role, content, model_msg_count, data)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(session_id, id) DO UPDATE SET
       idx = excluded.idx,
       role = excluded.role,
       content = excluded.content,
       model_msg_count = excluded.model_msg_count,
       data = excluded.data`,
    [r.session_id, r.id, r.idx, r.role, r.content, r.model_msg_count, r.data],
  )
  await persistParts(t, sid, m.id, m.parts ?? [], 0)
}

export async function insertMessage(db: Db, sid: string, idx: number, m: Message): Promise<void> {
  await db.tx((t) => insertMessageInto(t, sid, idx, m))
}

export async function updateMessageRow(db: Db, sid: string, m: Message): Promise<void> {
  const { id, role, content, modelMsgCount, ...rest } = m
  const data = { ...rest } as Record<string, unknown>
  delete data.parts
  await db.exec(
    `UPDATE message SET role = ?, content = ?, model_msg_count = ?, data = ?
     WHERE session_id = ? AND id = ?`,
    [role, content, modelMsgCount ?? null, JSON.stringify(data), sid, id],
  )
}

export async function deleteMessage(db: Db, sid: string, mid: string): Promise<void> {
  await db.exec(`DELETE FROM message WHERE session_id = ? AND id = ?`, [sid, mid])
}

export async function deleteMessagesFromIdx(db: Db, sid: string, fromIdx: number): Promise<void> {
  await db.exec(`DELETE FROM message WHERE session_id = ? AND idx >= ?`, [sid, fromIdx])
}

export async function modelBoundary(db: Db, sid: string, uptoIdx: number): Promise<number> {
  const rows = await db.select<{ n: number | null }>(
    `SELECT SUM(model_msg_count) AS n FROM message WHERE session_id = ? AND idx < ?`,
    [sid, uptoIdx],
  )
  return rows[0]?.n ?? 0
}

export async function forkCopy(
  db: Db,
  dst: Session,
  srcId: string,
  cutIdx: number,
): Promise<void> {
  await db.tx(async (t) => {
    await upsertSessionRow(t, dst)
    await t.exec(
      `INSERT INTO message (session_id, id, idx, role, content, model_msg_count, data)
       SELECT ?, id, idx, role, content, model_msg_count, data
       FROM message WHERE session_id = ? AND idx <= ?`,
      [dst.id, srcId, cutIdx],
    )
    await t.exec(
      `INSERT INTO part (session_id, message_id, idx, type, data)
       SELECT ?, p.message_id, p.idx, p.type, p.data
       FROM part p JOIN message m ON m.session_id = p.session_id AND m.id = p.message_id
       WHERE p.session_id = ? AND m.idx <= ?`,
      [dst.id, srcId, cutIdx],
    )
  })
}

// ─── Project ──────────────────────────────────────────────────────────────────

export async function listProjects(db: Db): Promise<{ path: string; meta: ProjectMeta }[]> {
  const rows = await db.select<{
    path: string
    name: string | null
    color: string | null
    default_provider: string | null
    default_model: string | null
  }>(`SELECT path, name, color, default_provider, default_model FROM project ORDER BY sort ASC`)
  return rows.map((r) => {
    const meta: ProjectMeta = {}
    if (r.name) meta.name = r.name
    if (r.color) meta.color = r.color
    if (r.default_provider) meta.defaultProvider = r.default_provider
    if (r.default_model) meta.defaultModel = r.default_model
    return { path: r.path, meta }
  })
}

export async function upsertProject(
  db: Db,
  path: string,
  meta: ProjectMeta,
  sort: number,
): Promise<void> {
  await db.exec(
    `INSERT INTO project (path, name, color, sort, default_provider, default_model)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(path) DO UPDATE SET
       name = excluded.name,
       color = excluded.color,
       sort = excluded.sort,
       default_provider = excluded.default_provider,
       default_model = excluded.default_model`,
    [path, meta.name ?? null, meta.color ?? null, sort, meta.defaultProvider ?? null, meta.defaultModel ?? null],
  )
}

export async function deleteProject(db: Db, path: string): Promise<void> {
  await db.exec(`DELETE FROM project WHERE path = ?`, [path])
  await db.exec(`DELETE FROM project_permission WHERE project_path = ?`, [path])
}

// ─── Project permission (L4 — "always" onaylanan izinler) ───────────────────────

export async function loadProjectPermission(db: Db, path: string): Promise<PermissionRule[]> {
  const rows = await db.select<{ data: string }>(
    `SELECT data FROM project_permission WHERE project_path = ?`,
    [path],
  )
  if (!rows[0]) return []
  try {
    const parsed = JSON.parse(rows[0].data)
    return Array.isArray(parsed) ? (parsed as PermissionRule[]) : []
  } catch {
    return []
  }
}

export async function saveProjectPermission(
  db: Db,
  path: string,
  rules: PermissionRule[],
  now: number,
): Promise<void> {
  await db.exec(
    `INSERT INTO project_permission (project_path, data, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(project_path) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`,
    [path, JSON.stringify(rules), now],
  )
}

export async function setProjectsOrder(db: Db, paths: string[]): Promise<void> {
  await db.tx(async (t) => {
    for (let i = 0; i < paths.length; i++) {
      await t.exec(`UPDATE project SET sort = ? WHERE path = ?`, [i, paths[i]])
    }
  })
}

// ─── Image GC ──────────────────────────────────────────────────────────────────

const IMAGE_REF_RE = /img[0-9A-Za-z]+\.[a-z0-9]+/g
export async function referencedImageRefs(db: Db): Promise<Set<string>> {
  const refs = new Set<string>()
  const add = (data: string): void => {
    const m = data.match(IMAGE_REF_RE)
    if (m) for (const r of m) refs.add(r)
  }
  for (const r of await db.select<{ data: string }>(
    `SELECT data FROM message WHERE data LIKE '%"ref":"img%'`,
  )) {
    add(r.data)
  }
  for (const r of await db.select<{ data: string }>(
    `SELECT data FROM session WHERE data LIKE '%"ref":"img%'`,
  )) {
    add(r.data)
  }
  return refs
}
