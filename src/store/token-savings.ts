
import { create } from "zustand"

export type SavingsSource = "compactOutput" | "toolDesc" | "historyHygiene"

export type SavingsBySource = Record<SavingsSource, number>

type Persisted = { tokens: number; bySource: SavingsBySource }

const PERSIST_KEY = "codezal:token-savings:v1"

function emptyBySource(): SavingsBySource {
  return { compactOutput: 0, toolDesc: 0, historyHygiene: 0 }
}

export function loadSavings(): Persisted {
  try {
    const raw = localStorage.getItem(PERSIST_KEY)
    if (!raw) return { tokens: 0, bySource: emptyBySource() }
    const o = JSON.parse(raw) as Partial<Persisted>
    const bs = (o.bySource ?? {}) as Partial<SavingsBySource>
    return {
      tokens: typeof o.tokens === "number" && o.tokens >= 0 ? o.tokens : 0,
      bySource: {
        compactOutput: bs.compactOutput ?? 0,
        toolDesc: bs.toolDesc ?? 0,
        historyHygiene: bs.historyHygiene ?? 0,
      },
    }
  } catch {
    return { tokens: 0, bySource: emptyBySource() }
  }
}

export function saveSavings(p: Persisted): void {
  try {
    localStorage.setItem(PERSIST_KEY, JSON.stringify(p))
  } catch {
    // Intentionally ignored.
  }
}

const SAVE_DEBOUNCE_MS = 1000
let flushTimer: ReturnType<typeof setTimeout> | null = null
let pending: Persisted | null = null

function scheduleSave(p: Persisted): void {
  pending = p
  if (flushTimer) return
  flushTimer = setTimeout(() => {
    flushTimer = null
    if (pending) {
      saveSavings(pending)
      pending = null
    }
  }, SAVE_DEBOUNCE_MS)
  ;(flushTimer as { unref?: () => void }).unref?.()
}

function flushNow(p: Persisted): void {
  if (flushTimer) {
    clearTimeout(flushTimer)
    flushTimer = null
  }
  pending = null
  saveSavings(p)
}

export type TokenSavingsState = Persisted & {
  record: (source: SavingsSource, tokens: number) => void
  reset: () => void
}

export const useTokenSavingsStore = create<TokenSavingsState>((set, get) => {
  const init = loadSavings()
  return {
    tokens: init.tokens,
    bySource: init.bySource,
    record: (source, tokens) => {
      if (!Number.isFinite(tokens) || tokens <= 0) return
      const cur = get()
      const next: Persisted = {
        tokens: cur.tokens + tokens,
        bySource: { ...cur.bySource, [source]: cur.bySource[source] + tokens },
      }
      set(next)
      scheduleSave(next)
    },
    reset: () => {
      const next: Persisted = { tokens: 0, bySource: emptyBySource() }
      set(next)
      flushNow(next)
    },
  }
})

export function recordSavings(source: SavingsSource, tokens: number): void {
  useTokenSavingsStore.getState().record(source, tokens)
}
