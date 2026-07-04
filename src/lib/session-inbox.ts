//

import type { SessionMeta } from "@/store/types"

export type InboxMsg = {
  fromLabel: string
  text: string
  at: number
}

const inbox = new Map<string, InboxMsg[]>()

export function enqueueInbox(sid: string, msg: InboxMsg): void {
  const q = inbox.get(sid)
  if (q) q.push(msg)
  else inbox.set(sid, [msg])
}

export function hasInbox(sid: string): boolean {
  return (inbox.get(sid)?.length ?? 0) > 0
}

export function takeInbox(sid: string): InboxMsg | undefined {
  const q = inbox.get(sid)
  if (!q || q.length === 0) return undefined
  const msg = q.shift()
  if (q.length === 0) inbox.delete(sid)
  return msg
}

// Test izolasyonu.
export function clearInbox(): void {
  inbox.clear()
}

export function normHandle(raw: string): string | null {
  const h = raw.trim().replace(/^@+/, "").trim().toLowerCase()
  if (!h || !/^[a-z0-9][a-z0-9_-]*$/.test(h)) return null
  return h
}

export function resolveHandle(
  metas: ReadonlyArray<Pick<SessionMeta, "id" | "handle">>,
  rawHandle: string,
  excludeId?: string,
): string | undefined {
  const want = normHandle(rawHandle)
  if (!want) return undefined
  for (const m of metas) {
    if (m.id === excludeId) continue
    if (m.handle && normHandle(m.handle) === want) return m.id
  }
  return undefined
}

export function handleTaken(
  metas: ReadonlyArray<Pick<SessionMeta, "id" | "handle">>,
  rawHandle: string,
  selfId: string,
): boolean {
  return resolveHandle(metas, rawHandle, selfId) !== undefined
}

export function listPeers(
  metas: ReadonlyArray<Pick<SessionMeta, "id" | "title" | "handle">>,
  selfId?: string,
): Array<{ id: string; title: string; handle: string }> {
  const out: Array<{ id: string; title: string; handle: string }> = []
  for (const m of metas) {
    if (m.id === selfId) continue
    if (m.handle) out.push({ id: m.id, title: m.title, handle: m.handle })
  }
  return out
}

export function framePeerMessage(fromLabel: string, text: string): string {
  return `[from ${fromLabel}] ${text}`
}

// determinizmi. ---
const RATE_WINDOW_MS = 60_000
const RATE_MAX = 12
const rateLog = new Map<string, number[]>()

export function rateOk(fromSid: string, toSid: string, now: number): boolean {
  const key = `${fromSid}->${toSid}`
  const arr = (rateLog.get(key) ?? []).filter((t) => now - t < RATE_WINDOW_MS)
  if (arr.length >= RATE_MAX) {
    rateLog.set(key, arr)
    return false
  }
  arr.push(now)
  rateLog.set(key, arr)
  return true
}

// Test izolasyonu.
export function clearRateLog(): void {
  rateLog.clear()
}
