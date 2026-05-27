import { create } from "zustand"
import {
  deleteSession as fsDelete,
  loadSession as fsLoad,
  saveSession as fsSave,
} from "@/lib/storage"
import { restoreMessage } from "@/lib/snapshots"
import type { ProviderId } from "@/lib/providers"
import type { ModelMessage } from "ai"
import type { AgentMode, Message, Session, SessionMeta } from "./types"

// Persist edilen index: hangi sessionlar var, hangi sırada.
// Sessionların kendisi ayrı JSON dosyalarda; bu sadece liste.
type SessionIndex = { order: string[] }

function newId(): string {
  return crypto.randomUUID()
}

function makeEmptySession(
  provider: ProviderId,
  model: string,
  workspacePath?: string,
): Session {
  const now = Date.now()
  return {
    id: newId(),
    title: "Yeni sohbet",
    createdAt: now,
    updatedAt: now,
    messages: [],
    provider,
    model,
    workspacePath,
    mode: "build",
  }
}

type SessionsState = {
  // İndeks ve aktif session
  index: SessionMeta[]
  activeId: string | null
  // Aktif session full data (mesajlar dahil)
  active: Session | null
  loaded: boolean

  // Persist edilmiş tüm sessionları index olarak yükle
  loadAll: () => Promise<void>

  // Yeni session oluştur, aktif yap
  create: (provider: ProviderId, model: string, workspacePath?: string) => Promise<string>

  // Mevcut session yükle, aktif yap
  open: (id: string) => Promise<void>

  // Aktif session'a mesaj ekle (UI-only, persist debounced ayrı)
  pushMessage: (msg: Message) => void

  // Aktif sessiondaki bir mesajı patchle (streaming için)
  patchMessage: (id: string, patch: Partial<Message>) => void

  // Aktif sessionun title vs alanlarını güncelle
  updateActiveMeta: (
    patch: Partial<Pick<Session, "title" | "provider" | "model" | "workspacePath">>,
  ) => void

  // AI SDK ham model mesajlarını ekle/güncelle (stream sonu)
  appendModelMessages: (newOnes: ModelMessage[]) => void

  // Token/cost kümülatif güncelle. lastInputTokens / effectiveContextTokens
  // overwrite edilir (kümülatif değil — ctx % hesabı bunlara bakar).
  addUsage: (delta: {
    inputTokens: number
    outputTokens: number
    cacheReadTokens?: number
    cacheWriteTokens?: number
    reasoningTokens?: number
    costUsd: number
    lastInputTokens?: number
    effectiveContextTokens?: number
  }) => void

  // ModelMessages diziisini tamamen değiştir (compaction sonrası kullanılır)
  replaceModelMessages: (msgs: ModelMessage[]) => void

  // Sadece efektif bağlam tahminini güncelle (send öncesi)
  setEffectiveContextTokens: (n: number) => void

  // Mevcut session'ı çatalla: bu mesaja kadar olan geçmişle yeni session
  forkAt: (messageId: string) => Promise<string>

  // Mesaj sil (yalnızca aktif session içinde)
  deleteMessage: (id: string) => void

  // Tüm mesajları sil (aktif session)
  clearMessages: () => void

  // Mesaj içeriği güncelle
  editMessage: (id: string, content: string) => void

  // Bu mesaja kadar tüm sonrasını sil (re-generate için)
  truncateAfter: (messageId: string) => void

  // Bu session içinde dosya tab'ı aç (varsa aktif et)
  openFile: (path: string) => void
  // Dosya tab'ını kapat
  closeFile: (path: string) => void
  // Aktif dosya tab'ı (null = sohbet görünümü)
  setActiveFile: (path: string | null) => void

  // Aktif session'ın agent modunu değiştir (plan/build)
  setMode: (mode: AgentMode) => void

  // Bir assistant mesajına snapshot path'leri iliştir (mutasyon tool'ları çağırınca)
  addSnapshotPaths: (messageId: string, paths: string[]) => void

  // Bu mesajın etkilediği dosyaları snapshot'tan geri yükle ve mesajı + sonrasını sil.
  // Dönüş: kaç dosya restore edildi.
  revertToBeforeMessage: (messageId: string) => Promise<{ restored: number; deleted: number }>

  // Aktif session'ı diske yaz (debounce çağrılır)
  persistActive: () => Promise<void>

  // Sessionu sil
  remove: (id: string) => Promise<void>

  // Tümünü temizle (debug için)
  clear: () => Promise<void>
}

// İndeks dosya I/O helper
async function readIndexFile(): Promise<SessionIndex> {
  return fsLoad<SessionIndex>("_index", { order: [] })
}
async function writeIndexFile(idx: SessionIndex): Promise<void> {
  await fsSave("_index", idx)
}

function metaOf(s: Session): SessionMeta {
  return {
    id: s.id,
    title: s.title,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
    workspacePath: s.workspacePath,
  }
}

// İlk mesajdan otomatik title üret
function autoTitleFromMessages(msgs: Message[]): string {
  const firstUser = msgs.find((m) => m.role === "user")
  if (!firstUser) return "Yeni sohbet"
  const text = firstUser.content.trim().replace(/\s+/g, " ")
  return text.length > 60 ? text.slice(0, 57) + "..." : text || "Yeni sohbet"
}

export const useSessionsStore = create<SessionsState>((set, get) => ({
  index: [],
  activeId: null,
  active: null,
  loaded: false,

  loadAll: async () => {
    const idx = await readIndexFile()
    // Index'teki id'lerin metalarını oku
    const metas: SessionMeta[] = []
    for (const id of idx.order) {
      const s = await fsLoad<Session | null>(id, null)
      if (s) metas.push(metaOf(s))
    }
    // En yeni üstte
    metas.sort((a, b) => b.updatedAt - a.updatedAt)
    set({ index: metas, loaded: true })
  },

  create: async (provider, model, workspacePath) => {
    const s = makeEmptySession(provider, model, workspacePath)
    await fsSave(s.id, s)
    const idx = await readIndexFile()
    await writeIndexFile({ order: [s.id, ...idx.order] })
    set((st) => ({
      index: [metaOf(s), ...st.index],
      activeId: s.id,
      active: s,
    }))
    return s.id
  },

  open: async (id) => {
    const s = await fsLoad<Session | null>(id, null)
    if (!s) return
    set({ activeId: id, active: s })
  },

  pushMessage: (msg) => {
    set((st) => {
      if (!st.active) return st
      const next: Session = {
        ...st.active,
        messages: [...st.active.messages, msg],
        updatedAt: Date.now(),
      }
      // İlk user mesajından sonra title yenile
      if (next.title === "Yeni sohbet") next.title = autoTitleFromMessages(next.messages)
      return { active: next }
    })
  },

  patchMessage: (id, patch) => {
    set((st) => {
      if (!st.active) return st
      return {
        active: {
          ...st.active,
          messages: st.active.messages.map((m) => (m.id === id ? { ...m, ...patch } : m)),
          updatedAt: Date.now(),
        },
      }
    })
  },

  updateActiveMeta: (patch) => {
    set((st) => {
      if (!st.active) return st
      return { active: { ...st.active, ...patch, updatedAt: Date.now() } }
    })
  },

  appendModelMessages: (newOnes) => {
    set((st) => {
      if (!st.active) return st
      return {
        active: {
          ...st.active,
          modelMessages: [...(st.active.modelMessages ?? []), ...newOnes],
          updatedAt: Date.now(),
        },
      }
    })
  },

  addUsage: (delta) => {
    set((st) => {
      if (!st.active) return st
      const cur = st.active.usage ?? {
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        reasoningTokens: 0,
        costUsd: 0,
        turns: 0,
      }
      return {
        active: {
          ...st.active,
          usage: {
            inputTokens: cur.inputTokens + delta.inputTokens,
            outputTokens: cur.outputTokens + delta.outputTokens,
            cacheReadTokens: (cur.cacheReadTokens ?? 0) + (delta.cacheReadTokens ?? 0),
            cacheWriteTokens: (cur.cacheWriteTokens ?? 0) + (delta.cacheWriteTokens ?? 0),
            reasoningTokens: (cur.reasoningTokens ?? 0) + (delta.reasoningTokens ?? 0),
            costUsd: cur.costUsd + delta.costUsd,
            turns: cur.turns + 1,
            // Overwrite: son turn'ün input'u ve efektif bağlam
            lastInputTokens: delta.lastInputTokens ?? delta.inputTokens,
            effectiveContextTokens:
              delta.effectiveContextTokens ?? cur.effectiveContextTokens,
          },
          updatedAt: Date.now(),
        },
      }
    })
  },

  replaceModelMessages: (msgs) => {
    set((st) => {
      if (!st.active) return st
      return {
        active: { ...st.active, modelMessages: msgs, updatedAt: Date.now() },
      }
    })
  },

  setEffectiveContextTokens: (n) => {
    set((st) => {
      if (!st.active) return st
      const cur = st.active.usage ?? {
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        reasoningTokens: 0,
        costUsd: 0,
        turns: 0,
      }
      return {
        active: {
          ...st.active,
          usage: { ...cur, effectiveContextTokens: n },
          updatedAt: Date.now(),
        },
      }
    })
  },

  openFile: (path) => {
    set((st) => {
      if (!st.active) return st
      const open = st.active.openFiles ?? []
      const exists = open.includes(path)
      return {
        active: {
          ...st.active,
          openFiles: exists ? open : [...open, path],
          activeFile: path,
          updatedAt: Date.now(),
        },
      }
    })
  },

  closeFile: (path) => {
    set((st) => {
      if (!st.active) return st
      const open = st.active.openFiles ?? []
      const idx = open.indexOf(path)
      if (idx === -1) return st
      const next = open.filter((p) => p !== path)
      let activeFile = st.active.activeFile
      if (activeFile === path) {
        // En yakın komşuya geç, yoksa sohbete
        activeFile = next[idx] ?? next[idx - 1] ?? null
      }
      return {
        active: {
          ...st.active,
          openFiles: next,
          activeFile,
          updatedAt: Date.now(),
        },
      }
    })
  },

  setActiveFile: (path) => {
    set((st) => {
      if (!st.active) return st
      return {
        active: { ...st.active, activeFile: path, updatedAt: Date.now() },
      }
    })
  },

  setMode: (mode) => {
    set((st) => {
      if (!st.active) return st
      return { active: { ...st.active, mode, updatedAt: Date.now() } }
    })
  },

  addSnapshotPaths: (messageId, paths) => {
    set((st) => {
      if (!st.active) return st
      return {
        active: {
          ...st.active,
          messages: st.active.messages.map((m) => {
            if (m.id !== messageId) return m
            const existing = new Set(m.snapshotPaths ?? [])
            for (const p of paths) existing.add(p)
            return { ...m, snapshotPaths: Array.from(existing) }
          }),
          updatedAt: Date.now(),
        },
      }
    })
  },

  revertToBeforeMessage: async (messageId) => {
    const st = get()
    if (!st.active) throw new Error("Aktif session yok")
    const session = st.active
    if (!session.workspacePath) throw new Error("Workspace bağlı değil — revert yapılamaz")
    const idx = session.messages.findIndex((m) => m.id === messageId)
    if (idx === -1) throw new Error("Mesaj bulunamadı")

    // Bu mesajın snapshot'larını workspace'e geri yaz
    const result = await restoreMessage(session.id, messageId, session.workspacePath)

    // Mesajı ve sonrasını sil — geçmiş tutarsız kalmasın
    set((s) => {
      if (!s.active) return s
      return {
        active: {
          ...s.active,
          messages: s.active.messages.slice(0, idx),
          modelMessages: (s.active.modelMessages ?? []).slice(0, idx),
          updatedAt: Date.now(),
        },
      }
    })
    return result
  },

  persistActive: async () => {
    const a = get().active
    if (!a) return
    await fsSave(a.id, a)
    // Index meta yenile — SIRA değiştirme (sadece in-place güncelle)
    set((st) => ({
      index: st.index.map((m) => (m.id === a.id ? metaOf(a) : m)),
    }))
  },

  forkAt: async (messageId) => {
    const a = get().active
    if (!a) throw new Error("Aktif session yok")
    const idx = a.messages.findIndex((m) => m.id === messageId)
    if (idx === -1) throw new Error("Mesaj bulunamadı")

    const now = Date.now()
    const forkId = newId()
    const forkMessages = a.messages.slice(0, idx + 1).map((m) => ({ ...m }))
    // modelMessages için aynı sayıda mesaj kes (ham model mesajı sayısı ≈ ui mesajı)
    const forkModelMsgs = (a.modelMessages ?? []).slice(0, idx + 1)
    const fork: Session = {
      id: forkId,
      title: a.title + " (çatal)",
      createdAt: now,
      updatedAt: now,
      messages: forkMessages,
      modelMessages: forkModelMsgs,
      provider: a.provider,
      model: a.model,
      workspacePath: a.workspacePath,
      openFiles: [],
      activeFile: null,
    }
    await fsSave(forkId, fork)
    const idxFile = await readIndexFile()
    await writeIndexFile({ order: [forkId, ...idxFile.order] })
    set((st) => ({
      index: [metaOf(fork), ...st.index],
      activeId: forkId,
      active: fork,
    }))
    return forkId
  },

  deleteMessage: (id) => {
    set((st) => {
      if (!st.active) return st
      return {
        active: {
          ...st.active,
          messages: st.active.messages.filter((m) => m.id !== id),
          updatedAt: Date.now(),
        },
      }
    })
  },

  clearMessages: () => {
    set((st) => {
      if (!st.active) return st
      return {
        active: {
          ...st.active,
          messages: [],
          modelMessages: [],
          updatedAt: Date.now(),
        },
      }
    })
  },

  editMessage: (id, content) => {
    set((st) => {
      if (!st.active) return st
      return {
        active: {
          ...st.active,
          messages: st.active.messages.map((m) =>
            m.id === id ? { ...m, content } : m,
          ),
          updatedAt: Date.now(),
        },
      }
    })
  },

  truncateAfter: (messageId) => {
    set((st) => {
      if (!st.active) return st
      const idx = st.active.messages.findIndex((m) => m.id === messageId)
      if (idx === -1) return st
      return {
        active: {
          ...st.active,
          messages: st.active.messages.slice(0, idx + 1),
          // modelMessages eşle (yaklaşık)
          modelMessages: (st.active.modelMessages ?? []).slice(0, idx + 1),
          updatedAt: Date.now(),
        },
      }
    })
  },

  remove: async (id) => {
    await fsDelete(id)
    const idx = await readIndexFile()
    await writeIndexFile({ order: idx.order.filter((x) => x !== id) })
    set((st) => {
      const nextIndex = st.index.filter((m) => m.id !== id)
      const wasActive = st.activeId === id
      return {
        index: nextIndex,
        activeId: wasActive ? null : st.activeId,
        active: wasActive ? null : st.active,
      }
    })
  },

  clear: async () => {
    const idx = await readIndexFile()
    for (const id of idx.order) await fsDelete(id)
    await writeIndexFile({ order: [] })
    set({ index: [], activeId: null, active: null })
  },
}))

// Debounced auto-persist: aktif session değişince ~600ms sonra diske yaz.
let persistTimer: number | undefined
useSessionsStore.subscribe((state, prev) => {
  if (state.active === prev.active) return
  if (!state.active) return
  if (persistTimer) clearTimeout(persistTimer)
  persistTimer = setTimeout(() => {
    void state.persistActive()
  }, 600) as unknown as number
})
