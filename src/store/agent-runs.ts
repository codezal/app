import { create } from "zustand"
import type { AgentRun, AgentRunResult } from "@/lib/agents/runtime/types"

type AgentRunsState = {
  runs: Record<string, AgentRun>
  start: (run: AgentRun) => void
  finish: (runId: string, result: AgentRunResult) => void
  forParent: (parentRunId: string) => AgentRun[]
  clearSession: (sessionId: string) => void
}

export const useAgentRunsStore = create<AgentRunsState>((set, get) => ({
  runs: {},
  start: (run) => set((state) => ({ runs: { ...state.runs, [run.runId]: run } })),
  finish: (runId, result) =>
    set((state) => {
      const current = state.runs[runId]
      if (!current) return state
      return {
        runs: {
          ...state.runs,
          [runId]: {
            ...current,
            status: result.status,
            output: result.output,
            errorMessage: result.errorMessage,
            durationMs: result.durationMs,
            finishedAt: Date.now(),
          },
        },
      }
    }),
  forParent: (parentRunId) =>
    Object.values(get().runs)
      .filter((run) => run.parentRunId === parentRunId)
      .sort((a, b) => a.startedAt - b.startedAt),
  clearSession: (sessionId) =>
    set((state) => ({
      runs: Object.fromEntries(
        Object.entries(state.runs).filter(([, run]) => run.sessionId !== sessionId),
      ),
    })),
}))
