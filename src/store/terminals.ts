// Birden fazla terminal session — Claude Code stili.
// Her terminal kendi entries, history, running state'ini tutar.
import { create } from "zustand"

export type TermEntry =
  | { kind: "cmd"; cwd: string; cmd: string }
  | { kind: "out"; text: string; isErr?: boolean }
  | { kind: "exit"; code: number }
  | { kind: "info"; text: string }

export type TerminalSession = {
  id: string
  name: string
  // null = running command kill handle
  killHandle: { kill: () => Promise<void> } | null
  running: boolean
  entries: TermEntry[]
  history: string[]
}

type State = {
  sessions: TerminalSession[]
  activeId: string | null

  ensureOne: () => string // hiç yoksa oluştur, id döner
  create: () => string
  remove: (id: string) => void
  rename: (id: string, name: string) => void
  setActive: (id: string) => void
  patch: (id: string, patch: Partial<TerminalSession>) => void
  appendEntry: (id: string, entry: TermEntry) => void
  pushHistory: (id: string, cmd: string) => void
  clear: (id: string) => void
}

const MAX_OUTPUT = 200_000

function newId(): string {
  return crypto.randomUUID()
}

export const useTerminalsStore = create<State>((set, get) => ({
  sessions: [],
  activeId: null,

  ensureOne: () => {
    const st = get()
    if (st.sessions.length > 0) {
      if (!st.activeId) set({ activeId: st.sessions[0].id })
      return st.activeId ?? st.sessions[0].id
    }
    return get().create()
  },

  create: () => {
    const id = newId()
    const n = get().sessions.length + 1
    const session: TerminalSession = {
      id,
      name: `Terminal ${n}`,
      killHandle: null,
      running: false,
      entries: [],
      history: [],
    }
    set((st) => ({
      sessions: [...st.sessions, session],
      activeId: id,
    }))
    return id
  },

  remove: (id) => {
    set((st) => {
      const next = st.sessions.filter((s) => s.id !== id)
      const active =
        st.activeId === id ? next[next.length - 1]?.id ?? null : st.activeId
      return { sessions: next, activeId: active }
    })
  },

  rename: (id, name) => {
    set((st) => ({
      sessions: st.sessions.map((s) => (s.id === id ? { ...s, name } : s)),
    }))
  },

  setActive: (id) => set({ activeId: id }),

  patch: (id, patch) => {
    set((st) => ({
      sessions: st.sessions.map((s) => (s.id === id ? { ...s, ...patch } : s)),
    }))
  },

  appendEntry: (id, entry) => {
    set((st) => ({
      sessions: st.sessions.map((s) => {
        if (s.id !== id) return s
        const next = [...s.entries, entry]
        // çıktı boyut limiti
        let total = 0
        for (let i = next.length - 1; i >= 0; i--) {
          const e = next[i]
          if (e.kind === "out") total += e.text.length
          if (total > MAX_OUTPUT) return { ...s, entries: next.slice(i + 1) }
        }
        return { ...s, entries: next }
      }),
    }))
  },

  pushHistory: (id, cmd) => {
    set((st) => ({
      sessions: st.sessions.map((s) => {
        if (s.id !== id) return s
        if (s.history[s.history.length - 1] === cmd) return s
        return { ...s, history: [...s.history, cmd] }
      }),
    }))
  },

  clear: (id) => {
    set((st) => ({
      sessions: st.sessions.map((s) =>
        s.id === id ? { ...s, entries: [] } : s,
      ),
    }))
  },
}))
