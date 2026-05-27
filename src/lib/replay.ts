// Transcript replay — geçmiş session'ın user prompt'larını yeni session'da sırayla tekrar çalıştır.
// Kullanım: bug'a geri dön, modelle değişiklik dene, davranış farkını gör.
//
// Strateji:
// - Diskten session yükle (loadSession), user mesajlarını sırayla çıkar (text content).
// - Caller "newSessionFn" ile yeni boş session oluşturur ve aktif yapar.
// - "sendFn" ile her prompt'u sırayla onSend gibi çalıştırır.
// - Her send arasında stream'in bitmesini bekleyici callback (waitIdle) opsiyonel.
//
// Limit: tool çıktıları yeniden üretilir — model deterministik değilse farklı sonuç çıkar (amacı bu).
import { loadSession } from "./storage"
import type { Session } from "@/store/types"

const EMPTY_SESSION: Session = {
  id: "",
  title: "",
  createdAt: 0,
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

// Session'ın user mesajlarını sırayla text olarak çıkar.
// Tool sonuçları, assistant cevapları atılır — sadece kullanıcının yazdıkları.
export function extractUserPrompts(session: Session): string[] {
  const out: string[] = []
  for (const m of session.messages) {
    if (m.role !== "user") continue
    const text = m.content.trim()
    if (text) out.push(text)
  }
  return out
}

// İmza: çağıran handler
export type ReplayHandlers = {
  // Yeni boş session oluştur, original'in workspace + provider/model'ini taşı.
  newSession: (provider: string, model: string, workspace?: string) => Promise<void>
  // onSend benzeri — bir prompt gönder. Stream bitmeden dönmez.
  sendAndWait: (prompt: string) => Promise<void>
  // İlerleme bildirimi (UI overlay için).
  onProgress?: (current: number, total: number, prompt: string) => void
  // İptal mekanizması.
  signal?: AbortSignal
}

// Asıl replay akışı.
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
