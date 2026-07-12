import { beforeEach, describe, expect, it } from "vitest"
import { useAgentRunsStore } from "@/store/agent-runs"

describe("agent runs store", () => {
  beforeEach(() => useAgentRunsStore.setState({ runs: {} }))

  it("tracks child runs under their parent and patches terminal state", () => {
    useAgentRunsStore.getState().start({
      runId: "run-1",
      parentRunId: "message-1",
      sessionId: "session-1",
      poolEntryId: "codex",
      task: "implement",
      status: "running",
      startedAt: 1,
    })
    useAgentRunsStore.getState().finish("run-1", {
      status: "done",
      output: "complete",
      durationMs: 10,
    })

    expect(useAgentRunsStore.getState().forParent("message-1")).toEqual([
      expect.objectContaining({ runId: "run-1", status: "done", output: "complete" }),
    ])
  })
})
