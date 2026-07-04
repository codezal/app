//
import { create } from "zustand"
import { createId } from "@/lib/id"
import { sendDesktopNotification } from "@/lib/notify"

export type QuestionOption = { label: string; description?: string; recommended?: boolean }

export type QuestionItem = {
  question: string
  header?: string
  body?: string
  options?: QuestionOption[]
  multiple?: boolean
  custom?: boolean
}

export type QuestionRequest = {
  id: string
  // Hangi session/worker sordu — paralel orkestrada attribution + abort cleanup.
  sessionId: string
  questions: QuestionItem[]
  resolve: (answers: string[][]) => void
}

type QuestionsState = {
  queue: QuestionRequest[]
  panelHeight: number
  ask: (sessionId: string, questions: QuestionItem[]) => Promise<string[][]>
  answer: (id: string, answers: string[][]) => void
  cancel: (id: string) => void
  cancelBySession: (sessionId: string) => void
  setPanelHeight: (h: number) => void
}

export const NO_ANSWER = "(kullanıcı cevap vermedi)"

function resolveEmpty(req: QuestionRequest): void {
  req.resolve(req.questions.map(() => [NO_ANSWER]))
}

export const useQuestionsStore = create<QuestionsState>((set, get) => ({
  queue: [],
  panelHeight: 0,

  ask: (sessionId, questions) => {
    const normalized = questions.map((q) =>
      q.options && q.options.some((o) => o.recommended)
        ? {
            ...q,
            options: [
              ...q.options.filter((o) => o.recommended),
              ...q.options.filter((o) => !o.recommended),
            ],
          }
        : q,
    )
    if (typeof document !== "undefined" && !document.hasFocus()) {
      void sendDesktopNotification(
        "Codezal — yanıtınız bekleniyor",
        normalized[0]?.question,
      )
    }
    return new Promise<string[][]>((resolve) => {
      const id = createId("question")
      set((st) => ({
        queue: [...st.queue, { id, sessionId, questions: normalized, resolve }],
      }))
    })
  },

  answer: (id, answers) => {
    const req = get().queue.find((r) => r.id === id)
    if (!req) return
    req.resolve(answers)
    set((st) => ({ queue: st.queue.filter((r) => r.id !== id) }))
  },

  cancel: (id) => {
    const req = get().queue.find((r) => r.id === id)
    if (!req) return
    resolveEmpty(req)
    set((st) => ({ queue: st.queue.filter((r) => r.id !== id) }))
  },

  cancelBySession: (sessionId) => {
    const affected = get().queue.filter((r) => r.sessionId === sessionId)
    if (affected.length === 0) return
    for (const req of affected) resolveEmpty(req)
    set((st) => ({ queue: st.queue.filter((r) => r.sessionId !== sessionId) }))
  },

  setPanelHeight: (h) => set((st) => (st.panelHeight === h ? st : { panelHeight: h })),
}))
