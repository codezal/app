// Multiple terminal sessions. Each terminal owns its output and process state.
import { create } from "zustand"
import { createId } from "@/lib/id"
import type { TerminalCliId } from "@/lib/terminal-cli"

export type TermEntry =
  | { kind: "cmd"; cwd: string; cmd: string }
  | { kind: "out"; text: string; isErr?: boolean }
  | { kind: "exit"; code: number }
  | { kind: "info"; text: string }

export type TerminalSession = {
  id: string
  name: string
  chatSessionId: string
  workspacePath?: string
  toolId?: TerminalCliId
  launchCommand?: string
  // Null when there is no running command kill handle.
  killHandle: { kill: () => Promise<void> } | null
  running: boolean
  entries: TermEntry[]
  history: string[]
}

type State = {
  sessions: TerminalSession[]
  activeId: string | null

  ensureOne: (chatSessionId: string, workspacePath?: string) => string
  hydrate: (
    sessions: {
      id: string
      name: string
      chatSessionId?: string
      workspacePath?: string
      toolId?: TerminalCliId
      launchCommand?: string
      history?: string[]
    }[],
    activeId: string | null,
  ) => void
  create: (
    chatSessionId: string,
    workspacePath?: string,
    options?: {
      id?: string
      name?: string
      toolId?: TerminalCliId
      launchCommand?: string
    },
  ) => string
  remove: (id: string) => void
  rename: (id: string, name: string) => void
  setActive: (id: string) => void
  patch: (id: string, patch: Partial<TerminalSession>) => void
  appendEntry: (id: string, entry: TermEntry) => void
  pushHistory: (id: string, cmd: string) => void
  clear: (id: string) => void
}

const MAX_OUTPUT = 200_000

function nextTerminalName(sessions: TerminalSession[], preferred?: string): string {
  const names = new Set(sessions.map((session) => session.name))
  if (preferred) {
    if (!names.has(preferred)) return preferred
    let suffix = 2
    while (names.has(`${preferred} ${suffix}`)) suffix += 1
    return `${preferred} ${suffix}`
  }

  let suffix = 1
  while (names.has(`Terminal ${suffix}`)) suffix += 1
  return `Terminal ${suffix}`
}

export const useTerminalsStore = create<State>((set, get) => ({
  sessions: [],
  activeId: null,

  ensureOne: (chatSessionId, workspacePath) => {
    const st = get()
    const own = st.sessions.filter(
      (s) => s.chatSessionId === chatSessionId && s.workspacePath === workspacePath,
    )
    if (own.length > 0) {
      const act = own.some((s) => s.id === st.activeId) ? st.activeId! : own[0].id
      if (act !== st.activeId) set({ activeId: act })
      return act
    }

    const staleIds = new Set(
      st.sessions
        .filter((s) => s.chatSessionId === chatSessionId && s.workspacePath !== workspacePath)
        .map((s) => s.id),
    )
    if (staleIds.size > 0) {
      set((s) => ({ sessions: s.sessions.filter((terminal) => !staleIds.has(terminal.id)) }))
    }
    return get().create(chatSessionId, workspacePath)
  },

  hydrate: (sessions, activeId) => {
    const restored = sessions.reduce<TerminalSession[]>((out, s) => {
      if (!s.chatSessionId) return out
      out.push({
        id: s.id,
        name: s.name,
        chatSessionId: s.chatSessionId,
        workspacePath: s.workspacePath,
        toolId: s.toolId,
        launchCommand: s.launchCommand,
        killHandle: null,
        running: false,
        entries: [],
        history: s.history ?? [],
      })
      return out
    }, [])
    if (restored.length === 0) return
    set((current) => {
      const restoredIds = new Set(restored.map((session) => session.id))
      const merged = [
        ...restored,
        ...current.sessions.filter((session) => !restoredIds.has(session.id)),
      ]
      const nextActiveId =
        current.activeId && merged.some((session) => session.id === current.activeId)
          ? current.activeId
          : activeId && merged.some((session) => session.id === activeId)
            ? activeId
            : merged[0]?.id ?? null
      return { sessions: merged, activeId: nextActiveId }
    })
  },

  create: (chatSessionId, workspacePath, options) => {
    const id = options?.id ?? createId("terminal")
    const scopedSessions = get().sessions.filter(
      (session) =>
        session.chatSessionId === chatSessionId && session.workspacePath === workspacePath,
    )
    const session: TerminalSession = {
      id,
      name: nextTerminalName(scopedSessions, options?.name),
      chatSessionId,
      workspacePath,
      toolId: options?.toolId,
      launchCommand: options?.launchCommand,
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
      const removed = st.sessions.find((session) => session.id === id)
      const next = st.sessions.filter((s) => s.id !== id)
      const scoped = removed
        ? next.filter(
            (session) =>
              session.chatSessionId === removed.chatSessionId &&
              session.workspacePath === removed.workspacePath,
          )
        : []
      const active =
        st.activeId === id
          ? (scoped[scoped.length - 1] ?? next[next.length - 1])?.id ?? null
          : st.activeId
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
