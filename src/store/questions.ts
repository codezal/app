// Soru-cevap kuyruğu — agent kullanıcıya interaktif soru sorar.
// approvals.ts pattern'ine benzer; tek fark: cevap "allow/deny" değil,
// serbest metin veya seçenek listesinden seçim.
import { create } from "zustand"

export type QuestionRequest = {
  id: string
  prompt: string
  // Verilirse seçenek listesi olarak render edilir; aksi takdirde serbest metin.
  choices?: string[]
  // Cevap çağrılınca queue'dan düşer
  resolve: (answer: string) => void
}

type QuestionsState = {
  queue: QuestionRequest[]
  ask: (prompt: string, choices?: string[]) => Promise<string>
  answer: (id: string, value: string) => void
  // Kullanıcı kapatırsa boş cevap dönsün (agent bilgilensin)
  cancel: (id: string) => void
}

export const useQuestionsStore = create<QuestionsState>((set, get) => ({
  queue: [],

  ask: (prompt, choices) => {
    return new Promise<string>((resolve) => {
      const id = crypto.randomUUID()
      set((st) => ({
        queue: [...st.queue, { id, prompt, choices, resolve }],
      }))
    })
  },

  answer: (id, value) => {
    const req = get().queue.find((r) => r.id === id)
    if (!req) return
    req.resolve(value)
    set((st) => ({ queue: st.queue.filter((r) => r.id !== id) }))
  },

  cancel: (id) => {
    const req = get().queue.find((r) => r.id === id)
    if (!req) return
    req.resolve("(kullanıcı cevap vermedi)")
    set((st) => ({ queue: st.queue.filter((r) => r.id !== id) }))
  },
}))
