// Per-session composer draft store.
//
// The Composer input (typed text + pasted images / pdfs / file refs) used to
// live in component-local state. Because there is a single Composer instance
// that survives session switches, that state was shared across every session:
// a half-typed message (and any pasted image) leaked into all other chats and
// was wiped when you switched away. We now keep one draft per composer
// identity (session id) here, in memory only — the Composer swaps its local
// state from this map whenever the active session changes, so each chat
// preserves its own unfinished draft independently. Not persisted to disk: a
// draft only needs to live as long as the app session.
import { create } from "zustand"
import type { MessageFile, MessageImage, MessagePdf } from "@/store/types"

export interface ComposerDraft {
  text: string
  images: MessageImage[]
  pdfs: MessagePdf[]
  fileRefs: MessageFile[]
}

interface ComposerDraftState {
  drafts: Record<string, ComposerDraft>
  set: (id: string, draft: ComposerDraft) => void
  get: (id: string | null | undefined) => ComposerDraft | undefined
  clear: (id: string) => void
}

export const useComposerDraftStore = create<ComposerDraftState>((set, get) => ({
  drafts: {},
  set: (id, draft) =>
    set((s) => ({ drafts: { ...s.drafts, [id]: draft } })),
  get: (id) => (id != null ? get().drafts[id] : undefined),
  clear: (id) =>
    set((s) => {
      if (!(id in s.drafts)) return s
      const rest = { ...s.drafts }
      delete rest[id]
      return { drafts: rest }
    }),
}))
