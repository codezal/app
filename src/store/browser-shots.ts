//
// Model'e giden yol AYRI: src/lib/browser.ts pendingScreenshots + App.tsx prepareStep
import { create } from "zustand"

const MAX = 40

type State = {
  byCallId: Record<string, string> // toolCallId → data:image/jpeg;base64,…
  add: (toolCallId: string, dataUrl: string) => void
}

export const useBrowserShots = create<State>((set) => ({
  byCallId: {},
  add: (toolCallId, dataUrl) =>
    set((s) => {
      const next: Record<string, string> = { ...s.byCallId, [toolCallId]: dataUrl }
      const keys = Object.keys(next)
      if (keys.length > MAX) delete next[keys[0]]
      return { byCallId: next }
    }),
}))
