// Codex reader — ~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl + archived_sessions/
import type { HarnessMessage, HarnessRole, HarnessThread, SessionSource } from "../types"
import { capText, deriveTitle, extractText, stripExt } from "../normalize"
import { dirExists, makeFileSource, walkFiles } from "../io"

export function extractCodexMessage(payload: unknown): { role: HarnessRole; text: string } | null {
  if (!payload || typeof payload !== "object") return null
  const p = payload as Record<string, unknown>
  const ptype = typeof p.type === "string" ? p.type : ""

  // response_item: {type:"message", role, content:[{type:"input_text"|"output_text",text}]}
  if (ptype === "message" && typeof p.role === "string") {
    const role: HarnessRole =
      p.role === "assistant" ? "assistant" : p.role === "system" ? "system" : "user"
    const text = extractText(p.content).trim()
    return text ? { role, text } : null
  }
  if (ptype === "user_message") {
    const text = extractText(p.message ?? p.text ?? p.content).trim()
    return text ? { role: "user", text } : null
  }
  if (ptype === "agent_message") {
    const text = extractText(p.message ?? p.text ?? p.content).trim()
    return text ? { role: "assistant", text } : null
  }
  return null
}

function unwrapPayload(raw: unknown): unknown {
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw)
    } catch {
      return undefined
    }
  }
  return raw
}

export function parseCodexRollout(text: string, filePath: string): HarnessThread | null {
  let nativeId = ""
  let cwd: string | undefined
  let firstTs: number | undefined
  let lastTs: number | undefined
  const fromItems: HarnessMessage[] = []
  const fromEvents: HarnessMessage[] = []

  for (const line of text.split(/\r?\n/)) {
    const t = line.trim()
    if (!t) continue
    let ev: Record<string, unknown>
    try {
      ev = JSON.parse(t) as Record<string, unknown>
    } catch {
      continue
    }
    const payload = unwrapPayload(ev.payload)
    const ts = typeof ev.timestamp === "string" ? Date.parse(ev.timestamp) : NaN
    const tsv = Number.isFinite(ts) ? ts : undefined

    if (ev.type === "session_meta" && payload && typeof payload === "object") {
      const pm = payload as Record<string, unknown>
      if (typeof pm.id === "string" && !nativeId) nativeId = pm.id
      const c = pm.cwd ?? pm.cwd_path ?? pm.workdir
      if (typeof c === "string" && !cwd) cwd = c
      continue
    }

    const msg = extractCodexMessage(payload)
    if (!msg) continue
    const entry: HarnessMessage = { role: msg.role, text: capText(msg.text), ts: tsv }
    if (ev.type === "response_item") fromItems.push(entry)
    else fromEvents.push(entry)
    if (tsv != null) {
      if (firstTs == null) firstTs = tsv
      lastTs = tsv
    }
  }

  const messages = fromItems.length > 0 ? fromItems : fromEvents
  if (messages.length === 0) return null
  if (!nativeId) nativeId = stripExt(filePath.split(/[/\\]/).pop() || filePath)
  return {
    id: `codex:${nativeId}`,
    harness: "codex",
    nativeId,
    projectPath: cwd,
    title: deriveTitle(messages),
    startedAt: firstTs,
    updatedAt: lastTs,
    sourceRef: filePath,
    messages,
  }
}

export async function discoverCodex(roots: string[]): Promise<SessionSource[]> {
  const sources: SessionSource[] = []
  for (const root of roots) {
    if (!(await dirExists(root))) continue
    for (const file of await walkFiles(root, ".jsonl", 6)) {
      if (!file.includes("rollout-")) continue
      sources.push(await makeFileSource(file, parseCodexRollout))
    }
  }
  return sources
}
