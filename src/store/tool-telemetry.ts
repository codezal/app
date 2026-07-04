
import { create } from "zustand"

export type ToolStat = {
  count: number
  errors: number
  totalMs: number
  maxMs: number
  totalTokens: number
}

export type ToolTelemetryState = {
  byTool: Record<string, ToolStat>
  record: (tool: string, ms: number, tokens: number, isError: boolean) => void
  reset: () => void
}

function emptyStat(): ToolStat {
  return { count: 0, errors: 0, totalMs: 0, maxMs: 0, totalTokens: 0 }
}

export const useToolTelemetryStore = create<ToolTelemetryState>((set, get) => ({
  byTool: {},
  record: (tool, ms, tokens, isError) => {
    const safeMs = Number.isFinite(ms) && ms > 0 ? ms : 0
    const safeTok = Number.isFinite(tokens) && tokens > 0 ? tokens : 0
    const cur = get().byTool[tool] ?? emptyStat()
    set({
      byTool: {
        ...get().byTool,
        [tool]: {
          count: cur.count + 1,
          errors: cur.errors + (isError ? 1 : 0),
          totalMs: cur.totalMs + safeMs,
          maxMs: Math.max(cur.maxMs, safeMs),
          totalTokens: cur.totalTokens + safeTok,
        },
      },
    })
  },
  reset: () => set({ byTool: {} }),
}))

export function recordToolCall(tool: string, ms: number, tokens: number, isError: boolean): void {
  useToolTelemetryStore.getState().record(tool, ms, tokens, isError)
}
