import type {
  HarnessMessage,
  HarnessRole,
  HarnessThread,
  SessionSource,
} from "../types"
import { capText, deriveTitle, safeJsonParse, stripExt } from "../normalize"
import { childPath, dirExists, fileMtime, readTextSafe, walkFiles } from "../io"
import { queryExternalSqlite } from "../external-sqlite"

function roleOf(data: Record<string, unknown>): HarnessRole {
  const r = data.role
  return r === "assistant" ? "assistant" : r === "system" ? "system" : "user"
}

export function parseOpencodePartText(part: unknown): string {
  if (!part || typeof part !== "object") return ""
  const p = part as Record<string, unknown>
  if (p.type === "text" && typeof p.text === "string") return p.text
  return ""
}


type OcSessionRow = {
  id: string
  title?: string | null
  directory?: string | null
  time_created?: number | null
  time_updated?: number | null
}
type OcMessageRow = { id: string; time_created?: number | null; data: string }
type OcPartRow = { message_id: string; data: string }

export function buildOpencodeThreadFromRows(
  session: OcSessionRow,
  messageRows: OcMessageRow[],
  partRows: OcPartRow[],
  sourceRef: string,
): HarnessThread | null {
  const partsByMsg = new Map<string, string[]>()
  for (const pr of partRows) {
    const txt = parseOpencodePartText(safeJsonParse(pr.data))
    if (!txt) continue
    const arr = partsByMsg.get(pr.message_id) ?? []
    arr.push(txt)
    partsByMsg.set(pr.message_id, arr)
  }

  const messages: HarnessMessage[] = []
  let firstTs: number | undefined
  let lastTs: number | undefined
  for (const mr of messageRows) {
    const text = (partsByMsg.get(mr.id) ?? []).join("\n").trim()
    if (!text) continue
    const role = roleOf(safeJsonParse(mr.data))
    const tsv = typeof mr.time_created === "number" ? mr.time_created : undefined
    messages.push({ role, text: capText(text), ts: tsv })
    if (tsv != null) {
      if (firstTs == null) firstTs = tsv
      lastTs = tsv
    }
  }
  if (messages.length === 0) return null

  const title = session.title?.trim() ? session.title.trim() : deriveTitle(messages)
  return {
    id: `opencode:${session.id}`,
    harness: "opencode",
    nativeId: session.id,
    projectPath: session.directory ?? undefined,
    title,
    startedAt: session.time_created ?? firstTs,
    updatedAt: session.time_updated ?? lastTs,
    sourceRef,
    messages,
  }
}

async function discoverOpencodeSqlite(dbPath: string): Promise<SessionSource[]> {
  let sessions: OcSessionRow[]
  try {
    sessions = await queryExternalSqlite<OcSessionRow>(
      dbPath,
      `SELECT id, title, directory, time_created, time_updated FROM session ORDER BY time_updated DESC`,
    )
  } catch {
    return [] // db kilitli/okunamaz → sessizce atla
  }
  return sessions.map((s) => ({
    nativeId: s.id,
    sourceRef: dbPath,
    mtime: s.time_updated ?? 0,
    load: async () => {
      const joined = await queryExternalSqlite<{
        mid: string
        mt: number | null
        mdata: string
        pdata: string | null
      }>(
        dbPath,
        `SELECT m.id AS mid, m.time_created AS mt, m.data AS mdata, p.data AS pdata
         FROM message m
         LEFT JOIN part p ON p.message_id = m.id AND p.session_id = m.session_id
         WHERE m.session_id = ?
         ORDER BY m.time_created, p.time_created`,
        [s.id],
      )
      const msgMap = new Map<string, OcMessageRow>()
      const partRows: OcPartRow[] = []
      for (const r of joined) {
        if (!msgMap.has(r.mid)) msgMap.set(r.mid, { id: r.mid, time_created: r.mt, data: r.mdata })
        if (r.pdata != null) partRows.push({ message_id: r.mid, data: r.pdata })
      }
      return buildOpencodeThreadFromRows(s, [...msgMap.values()], partRows, dbPath)
    },
  }))
}

// ---- LEGACY: JSON (storage/session/{info,message,part}) ----

export type OpencodeRawMessage = { role: unknown; time?: unknown; parts: unknown[] }

function timeMs(time: unknown): number | undefined {
  if (typeof time === "number") return time
  if (time && typeof time === "object") {
    const t = time as Record<string, unknown>
    const c = t.created ?? t.updated
    if (typeof c === "number") return c
  }
  return undefined
}

export function parseOpencodeSession(
  info: unknown,
  rawMsgs: OpencodeRawMessage[],
  sourceRef: string,
): HarnessThread | null {
  const meta = (info && typeof info === "object" ? info : {}) as Record<string, unknown>
  const nativeId =
    typeof meta.id === "string" && meta.id
      ? meta.id
      : stripExt(sourceRef.split(/[/\\]/).pop() || sourceRef)

  const messages: HarnessMessage[] = []
  let firstTs: number | undefined
  let lastTs: number | undefined
  for (const rm of rawMsgs) {
    const role: HarnessRole =
      rm.role === "assistant" ? "assistant" : rm.role === "system" ? "system" : "user"
    const text = rm.parts
      .map(parseOpencodePartText)
      .filter((s) => s.length > 0)
      .join("\n")
      .trim()
    if (!text) continue
    const tsv = timeMs(rm.time)
    messages.push({ role, text: capText(text), ts: tsv })
    if (tsv != null) {
      if (firstTs == null) firstTs = tsv
      lastTs = tsv
    }
  }
  if (messages.length === 0) return null

  const title =
    typeof meta.title === "string" && meta.title.trim() ? meta.title.trim() : deriveTitle(messages)
  const dir = typeof meta.directory === "string" ? meta.directory : undefined
  return {
    id: `opencode:${nativeId}`,
    harness: "opencode",
    nativeId,
    projectPath: dir,
    title,
    startedAt: firstTs ?? timeMs(meta.time),
    updatedAt: lastTs ?? timeMs(meta.time),
    sourceRef,
    messages,
  }
}

async function loadOpencodeMessages(storageRoot: string, sid: string): Promise<OpencodeRawMessage[]> {
  const msgDir = childPath(childPath(childPath(storageRoot, "session"), "message"), sid)
  const partRoot = childPath(childPath(childPath(storageRoot, "session"), "part"), sid)
  if (!(await dirExists(msgDir))) return []
  const msgFiles = (await walkFiles(msgDir, ".json", 1)).sort()
  const out: OpencodeRawMessage[] = []
  for (const mf of msgFiles) {
    const mText = await readTextSafe(mf)
    if (!mText) continue
    let mJson: Record<string, unknown>
    try {
      mJson = JSON.parse(mText) as Record<string, unknown>
    } catch {
      continue
    }
    const mid = stripExt(mf.split(/[/\\]/).pop() || mf)
    const parts: unknown[] = []
    for (const pf of (await walkFiles(childPath(partRoot, mid), ".json", 1)).sort()) {
      const pText = await readTextSafe(pf)
      if (!pText) continue
      try {
        parts.push(JSON.parse(pText))
      } catch {
        // Intentionally ignored.
      }
    }
    out.push({ role: mJson.role, time: mJson.time, parts })
  }
  return out
}

async function discoverOpencodeLegacy(storageRoot: string): Promise<SessionSource[]> {
  const infoDir = childPath(childPath(storageRoot, "session"), "info")
  if (!(await dirExists(infoDir))) return []
  const sources: SessionSource[] = []
  for (const infoFile of await walkFiles(infoDir, ".json", 1)) {
    const id = stripExt(infoFile.split(/[/\\]/).pop() || infoFile)
    sources.push({
      nativeId: id,
      sourceRef: infoFile,
      mtime: await fileMtime(infoFile),
      load: async () => {
        const infoText = await readTextSafe(infoFile)
        if (!infoText) return null
        let info: unknown
        try {
          info = JSON.parse(infoText)
        } catch {
          return null
        }
        const rawMsgs = await loadOpencodeMessages(storageRoot, id)
        return parseOpencodeSession(info, rawMsgs, infoFile)
      },
    })
  }
  return sources
}


export async function discoverOpencode(roots: string[]): Promise<SessionSource[]> {
  const out: SessionSource[] = []
  for (const dataRoot of roots) {
    const dbPath = childPath(dataRoot, "opencode.db")
    if (await dirExists(dbPath)) {
      out.push(...(await discoverOpencodeSqlite(dbPath)))
    } else {
      out.push(...(await discoverOpencodeLegacy(childPath(dataRoot, "storage"))))
    }
  }
  return out
}
