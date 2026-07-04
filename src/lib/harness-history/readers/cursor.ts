// Modern Cursor `cursorDiskKV` tablosu: key `composerData:<id>` + `bubbleId:<id>:<bid>`.
// #9 (Blob): value kolonu BLOB olabilir → CAST(value AS TEXT) ile TEXT'e zorla,
import type { HarnessMessage, HarnessRole, HarnessThread, SessionSource } from "../types"
import { capText, deriveTitle, safeJsonParse } from "../normalize"
import { childPath, dirExists, listSubdirs, readTextSafe } from "../io"
import { queryExternalSqlite } from "../external-sqlite"

function num(x: unknown): number | undefined {
  return typeof x === "number" ? x : undefined
}

// Cursor bubble `type`: 1 = user, 2 = assistant.
function cursorRole(type: unknown): HarnessRole {
  return type === 2 ? "assistant" : "user"
}

export function parseCursorComposer(
  composer: Record<string, unknown>,
  bubblesById: Map<string, Record<string, unknown>>,
  sourceRef: string,
  projectPath: string | undefined,
): HarnessThread | null {
  const composerId = typeof composer.composerId === "string" ? composer.composerId : ""
  if (!composerId) return null

  const messages: HarnessMessage[] = []
  const pushBubble = (b: Record<string, unknown>) => {
    const text = typeof b.text === "string" ? b.text.trim() : ""
    if (text) messages.push({ role: cursorRole(b.type), text: capText(text) })
  }

  const headers = composer.fullConversationHeadersOnly
  const inline = composer.conversation
  if (Array.isArray(headers)) {
    for (const h of headers) {
      const bid = h && typeof h === "object" ? String((h as Record<string, unknown>).bubbleId ?? "") : ""
      const b = bubblesById.get(bid)
      if (b) pushBubble(b)
    }
  } else if (Array.isArray(inline)) {
    for (const it of inline) {
      if (it && typeof it === "object") pushBubble(it as Record<string, unknown>)
    }
  } else {
    for (const b of bubblesById.values()) pushBubble(b)
  }
  if (messages.length === 0) return null

  const createdAt = num(composer.createdAt)
  const name =
    typeof composer.name === "string" && composer.name.trim()
      ? composer.name.trim()
      : deriveTitle(messages)
  return {
    id: `cursor:${composerId}`,
    harness: "cursor",
    nativeId: composerId,
    projectPath,
    title: name,
    startedAt: createdAt,
    updatedAt: num(composer.lastUpdatedAt) ?? createdAt,
    sourceRef,
    messages,
  }
}

async function readCursorWorkspacePath(wsDir: string): Promise<string | undefined> {
  const wj = await readTextSafe(childPath(wsDir, "workspace.json"))
  if (!wj) return undefined
  try {
    const o = JSON.parse(wj) as Record<string, unknown>
    if (typeof o.folder === "string") {
      return decodeURI(o.folder.replace(/^file:\/\//, ""))
    }
  } catch {
    // bozuk → yolsuz
  }
  return undefined
}

async function discoverCursorDb(
  dbPath: string,
  projectPath: string | undefined,
): Promise<SessionSource[]> {
  let rows: { key: string; value: string }[]
  try {
    rows = await queryExternalSqlite<{ key: string; value: string }>(
      dbPath,
      `SELECT CAST(key AS TEXT) AS key, CAST(value AS TEXT) AS value FROM cursorDiskKV
       WHERE key LIKE 'composerData:%' OR key LIKE 'bubbleId:%'`,
    )
  } catch {
    return []
  }

  const composers = new Map<string, Record<string, unknown>>()
  const bubbles = new Map<string, Map<string, Record<string, unknown>>>()
  for (const r of rows) {
    if (r.key.startsWith("composerData:")) {
      composers.set(r.key.slice("composerData:".length), safeJsonParse(r.value))
    } else if (r.key.startsWith("bubbleId:")) {
      const rest = r.key.slice("bubbleId:".length) // <composerId>:<bubbleId>
      const sep = rest.indexOf(":")
      if (sep < 0) continue
      const cid = rest.slice(0, sep)
      const bid = rest.slice(sep + 1)
      const bj = safeJsonParse(r.value)
      if (!bj.bubbleId) bj.bubbleId = bid
      const m = bubbles.get(cid) ?? new Map<string, Record<string, unknown>>()
      m.set(bid, bj)
      bubbles.set(cid, m)
    }
  }

  const sources: SessionSource[] = []
  for (const [cid, composer] of composers) {
    const bub = bubbles.get(cid) ?? new Map<string, Record<string, unknown>>()
    sources.push({
      nativeId: cid,
      sourceRef: dbPath,
      mtime: num(composer.lastUpdatedAt) ?? 0,
      load: async () => parseCursorComposer(composer, bub, dbPath, projectPath),
    })
  }
  return sources
}

export async function discoverCursor(roots: string[]): Promise<SessionSource[]> {
  const out: SessionSource[] = []
  for (const userRoot of roots) {
    const globalDb = childPath(childPath(userRoot, "globalStorage"), "state.vscdb")
    if (await dirExists(globalDb)) {
      out.push(...(await discoverCursorDb(globalDb, undefined)))
    }
    const wsRoot = childPath(userRoot, "workspaceStorage")
    for (const hash of await listSubdirs(wsRoot)) {
      const wsDir = childPath(wsRoot, hash)
      const wdb = childPath(wsDir, "state.vscdb")
      if (await dirExists(wdb)) {
        out.push(...(await discoverCursorDb(wdb, await readCursorWorkspacePath(wsDir))))
      }
    }
  }
  return out
}
