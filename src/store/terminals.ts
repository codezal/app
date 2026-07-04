// Birden fazla terminal session — Claude Code stili.
// Her terminal kendi entries, history, running state'ini tutar.
import { create } from "zustand"
import { createId } from "@/lib/id"

export type TermEntry =
  | { kind: "cmd"; cwd: string; cmd: string }
  | { kind: "out"; text: string; isErr?: boolean }
  | { kind: "exit"; code: number }
  | { kind: "info"; text: string }

export type TerminalSession = {
  id: string
  name: string
  chatSessionId?: string
  // null = running command kill handle
  killHandle: { kill: () => Promise<void> } | null
  running: boolean
  entries: TermEntry[]
  history: string[]
}

type State = {
  sessions: TerminalSession[]
  activeId: string | null

  ensureOne: (chatSessionId?: string) => string
  hydrate: (sessions: { id: string; name: string; history?: string[] }[], activeId: string | null) => void
  create: (chatSessionId?: string) => string
  remove: (id: string) => void
  rename: (id: string, name: string) => void
  setActive: (id: string) => void
  patch: (id: string, patch: Partial<TerminalSession>) => void
  appendEntry: (id: string, entry: TermEntry) => void
  pushHistory: (id: string, cmd: string) => void
  clear: (id: string) => void
}

const MAX_OUTPUT = 200_000


export const useTerminalsStore = create<State>((set, get) => ({
  sessions: [],
  activeId: null,

  ensureOne: (chatSessionId) => {
    const st = get()
    const own = st.sessions.filter((s) => s.chatSessionId === chatSessionId)
    if (own.length > 0) {
      const act = own.some((s) => s.id === st.activeId) ? st.activeId! : own[0].id
      if (act !== st.activeId) set({ activeId: act })
      return act
    }
    const orphan = st.sessions.find((s) => !s.chatSessionId)
    if (orphan) {
      set((s) => ({
        sessions: s.sessions.map((t) => (t.id === orphan.id ? { ...t, chatSessionId } : t)),
        activeId: orphan.id,
      }))
      return orphan.id
    }
    return get().create(chatSessionId)
  },

  hydrate: (sessions, activeId) => {
    if (sessions.length === 0) return
    const restored: TerminalSession[] = sessions.map((s) => ({
      id: s.id,
      name: s.name,
      killHandle: null,
      running: false,
      entries: [],
      history: s.history ?? [],
    }))
    const active = activeId && restored.some((s) => s.id === activeId) ? activeId : restored[0].id
    set({ sessions: restored, activeId: active })
  },

  create: (chatSessionId) => {
    const id = createId("terminal")
    const n = get().sessions.filter((s) => s.chatSessionId === chatSessionId).length + 1
    const session: TerminalSession = {
      id,
      name: `Terminal ${n}`,
      chatSessionId,
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
        let total = 0
        for (let i = next.length - 1; i >= 0; i--) {
          const e = next[i]
          if (e.kind === "out") total += e.text.length
          else if (e.kind === "cmd") total += e.cmd.length
          else if (e.kind === "info") total += e.text.length
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
