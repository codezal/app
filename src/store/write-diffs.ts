//
import { create } from "zustand"

const MAX = 60

type State = {
  byCallId: Record<string, string>
  add: (toolCallId: string, oldContent: string) => void
}

export const useWriteDiffs = create<State>((set) => ({
  byCallId: {},
  add: (toolCallId, oldContent) =>
    set((s) => {
      const next: Record<string, string> = { ...s.byCallId, [toolCallId]: oldContent }
      const keys = Object.keys(next)
      if (keys.length > MAX) delete next[keys[0]]
      return { byCallId: next }
    }),
}))
