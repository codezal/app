// CHAT display of generate_image results — rendered as an <img> in the tool
// result (the user sees the picture the agent produced). Mirrors browser-shots:
// UI-only + ephemeral (not written to modelMessages/DB, gone on app restart),
// keyed by toolCallId. The persistent copy lives on disk (workspace file +
// image-store); this store is just the inline preview channel.
import { create } from "zustand"

const MAX = 40

type State = {
  byCallId: Record<string, string> // toolCallId → data:image/…;base64,…
  add: (toolCallId: string, dataUrl: string) => void
}

export const useGeneratedImages = create<State>((set) => ({
  byCallId: {},
  add: (toolCallId, dataUrl) =>
    set((s) => {
      const next: Record<string, string> = { ...s.byCallId, [toolCallId]: dataUrl }
      const keys = Object.keys(next)
      if (keys.length > MAX) delete next[keys[0]] // drop oldest (memory bound)
      return { byCallId: next }
    }),
}))
