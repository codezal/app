// Ephemeral per-session store for post-run next-step suggestions. NOT persisted —
// suggestions are run-scoped and regenerated each turn, so they never touch the
// DB/schema. Keyed by session id; single-flight per session.
import { create } from "zustand"
import { generateSuggestions, type Suggestion } from "@/lib/suggestions"
import { errorMessage } from "@/lib/errors"
import type { ProviderId } from "@/lib/providers"
import type { ProvidersCatalog } from "@/lib/providers-catalog"
import type { Settings } from "@/store/types"

export type SuggestionsEntry = {
  items: Suggestion[]
  loading: boolean
  error?: string
}

// Everything generateSuggestions needs, gathered by the caller (useSuggestionsAuto).
export type SuggestionsContext = {
  providerId: ProviderId
  modelId: string
  settings: Settings
  workspace?: string
  catalog?: ProvidersCatalog
  recentMessages: string
  goal?: string
  todos?: string
}

type SuggestionsState = {
  bySession: Record<string, SuggestionsEntry>
  // Generate (or regenerate) suggestions for a session. No-op while already
  // loading for that session (single-flight).
  generateFor: (sid: string, ctx: SuggestionsContext) => Promise<void>
  clearFor: (sid: string) => void
}

export const useSuggestionsStore = create<SuggestionsState>((set, get) => ({
  bySession: {},
  generateFor: async (sid, ctx) => {
    if (get().bySession[sid]?.loading) return
    set((s) => ({
      bySession: {
        ...s.bySession,
        [sid]: { items: s.bySession[sid]?.items ?? [], loading: true, error: undefined },
      },
    }))
    try {
      const items = await generateSuggestions(ctx)
      set((s) => {
        const prev = s.bySession[sid]?.items ?? []
        const nextItems = items.length > 0 ? items : prev
        return { bySession: { ...s.bySession, [sid]: { items: nextItems, loading: false } } }
      })
    } catch (e) {
      set((s) => ({
        bySession: {
          ...s.bySession,
          [sid]: { items: s.bySession[sid]?.items ?? [], loading: false, error: errorMessage(e) },
        },
      }))
    }
  },
  clearFor: (sid) =>
    set((s) => {
      if (!s.bySession[sid]) return s
      const next = { ...s.bySession }
      delete next[sid]
      return { bySession: next }
    }),
}))
