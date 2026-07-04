//
// Strateji:
//
import { loadSession } from "./storage"
import type { Session } from "@/store/types"

const EMPTY_SESSION: Session = {
  id: "",
  title: "",
  updatedAt: 0,
  messages: [],
  provider: "openai",
  model: "",
}

export async function fetchSessionForReplay(id: string): Promise<Session | null> {
  const s = await loadSession<Session>(id, EMPTY_SESSION)
  if (!s.id) return null
  return s
}

export function extractUserPrompts(session: Session): string[] {
  const out: string[] = []
  for (const m of session.messages) {
    if (m.role !== "user") continue
    const text = m.content.trim()
    if (text) out.push(text)
  }
  return out
}

export type ReplayHandlers = {
  newSession: (provider: string, model: string, workspace?: string) => Promise<void>
  sendAndWait: (prompt: string) => Promise<void>
  onProgress?: (current: number, total: number, prompt: string) => void
  signal?: AbortSignal
}

export async function replaySession(
  sessionId: string,
  h: ReplayHandlers,
): Promise<{ replayed: number; total: number; aborted: boolean }> {
  const orig = await fetchSessionForReplay(sessionId)
  if (!orig) throw new Error(`Session bulunamadı: ${sessionId}`)
  const prompts = extractUserPrompts(orig)
  if (prompts.length === 0) {
    throw new Error("Bu session'da kullanıcı mesajı yok — replay için içerik gerekli")
  }

  await h.newSession(orig.provider, orig.model, orig.workspacePath)

  let i = 0
  for (const p of prompts) {
    if (h.signal?.aborted) {
      return { replayed: i, total: prompts.length, aborted: true }
    }
    h.onProgress?.(i + 1, prompts.length, p)
    await h.sendAndWait(p)
    i++
  }
  return { replayed: i, total: prompts.length, aborted: false }
}
