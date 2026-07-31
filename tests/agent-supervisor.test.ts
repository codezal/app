import { describe, expect, it } from "vitest"
import {
  DEFAULT_SUPERVISOR_SETTINGS,
  RunSupervisor,
  capabilitiesForEngine,
  sanitizeRunContext,
  workerConfigForPoolEntry,
  workerExecutionAdapter,
  findSupervisorPoolEntry,
  type AgentRunResult,
  type SupervisorPoolEntry,
} from "@/lib/agents/runtime"
import { DEFAULT_SETTINGS } from "@/lib/config/defaults"
import { parseSettings } from "@/lib/config/schema"

const pool: SupervisorPoolEntry[] = [
  {
    id: "general-sdk",
    agentName: "general",
    enabled: true,
    engine: { kind: "sdk", providerId: "openai", modelId: "gpt-5.4" },
  },
  {
    id: "reviewer-acp",
    agentName: "reviewer",
    enabled: true,
    engine: { kind: "acp", providerId: "gemini-cli", modelId: "gemini-2.5-pro" },
  },
  {
    id: "disabled",
    agentName: "general",
    enabled: false,
    engine: { kind: "sdk", providerId: "openai", modelId: "gpt-5.4" },
  },
]

describe("unified agent supervisor", () => {
  it("uses safe opt-in defaults", () => {
    expect(DEFAULT_SUPERVISOR_SETTINGS).toMatchObject({
      enabled: false,
      routing: "hybrid",
      autoDelegate: true,
      maxParallelRuns: 3,
      maxChildRunsPerTurn: 5,
      maxDepth: 1,
      maxWallClockMs: 30 * 60 * 1000,
      isolation: "auto",
      mergePolicy: "safe-auto",
      pool: [],
    })
  })

  it("persists valid supervisor settings and repairs unsafe limits", () => {
    expect(DEFAULT_SETTINGS.supervisor).toEqual(DEFAULT_SUPERVISOR_SETTINGS)
    const parsed = parseSettings(
      {
        ...DEFAULT_SETTINGS,
        supervisor: {
          ...DEFAULT_SUPERVISOR_SETTINGS,
          enabled: true,
          maxParallelRuns: 99,
          maxChildRunsPerTurn: 0,
          pool,
        },
      },
      DEFAULT_SETTINGS,
    )
    expect(parsed.supervisor).toMatchObject({
      enabled: true,
      maxParallelRuns: 5,
      maxChildRunsPerTurn: 1,
      pool,
    })
  })

  it("rejects disabled pool entries without fallback", async () => {
    const supervisor = new RunSupervisor({ ...DEFAULT_SUPERVISOR_SETTINGS, enabled: true, pool })
    await expect(
      supervisor.dispatch(
        {
          sessionId: "session-1",
          parentRunId: "parent",
          depth: 0,
          dispatches: [{ poolEntryId: "disabled", task: "work" }],
        },
        async () => ({ status: "done", output: "unexpected", durationMs: 0 }),
      ),
    ).rejects.toThrow(/not enabled/i)
  })

  it("preserves dispatch order while enforcing the concurrency cap", async () => {
    let active = 0
    let maxActive = 0
    const settings = {
      ...DEFAULT_SUPERVISOR_SETTINGS,
      enabled: true,
      maxParallelRuns: 1,
      pool,
    }
    const supervisor = new RunSupervisor(settings)
    const results = await supervisor.dispatch(
      {
        sessionId: "session-1",
        parentRunId: "parent",
        depth: 0,
        dispatches: [
          { poolEntryId: "general-sdk", task: "first" },
          { poolEntryId: "reviewer-acp", task: "second" },
        ],
      },
      async (run): Promise<AgentRunResult> => {
        active++
        maxActive = Math.max(maxActive, active)
        await new Promise((resolve) => setTimeout(resolve, run.task === "first" ? 10 : 1))
        active--
        return { status: "done", output: run.task, durationMs: 1 }
      },
    )

    expect(maxActive).toBe(1)
    expect(results.map((result) => result.output)).toEqual(["first", "second"])
  })

  it("rejects recursion and oversized child batches", async () => {
    const supervisor = new RunSupervisor({ ...DEFAULT_SUPERVISOR_SETTINGS, enabled: true, pool })
    const execute = async (): Promise<AgentRunResult> => ({
      status: "done",
      output: "ok",
      durationMs: 0,
    })
    await expect(
      supervisor.dispatch(
        {
          sessionId: "session-1",
          parentRunId: "child",
          depth: 1,
          dispatches: [{ poolEntryId: "general-sdk", task: "nested" }],
        },
        execute,
      ),
    ).rejects.toThrow(/depth/i)

    await expect(
      supervisor.dispatch(
        {
          sessionId: "session-1",
          parentRunId: "parent",
          depth: 0,
          dispatches: Array.from({ length: 6 }, (_, index) => ({
            poolEntryId: "general-sdk",
            task: `task-${index}`,
          })),
        },
        execute,
      ),
    ).rejects.toThrow(/child run limit/i)

    await expect(
      supervisor.dispatch(
        {
          sessionId: "session-1",
          parentRunId: "parent",
          depth: 0,
          existingChildCount: 5,
          dispatches: [{ poolEntryId: "general-sdk", task: "one more" }],
        },
        execute,
      ),
    ).rejects.toThrow(/child run limit/i)
  })

  it("declares conservative engine capabilities", () => {
    expect(capabilitiesForEngine(pool[0].engine)).toMatchObject({
      session: "stateless",
      cwd: "per-run",
      tools: "sdk",
      permissions: "codezal",
      usage: "exact",
    })
    expect(
      capabilitiesForEngine({ kind: "acp", providerId: "gemini-cli", modelId: "gemini" }),
    ).toMatchObject({ session: "stateless", cwd: "per-run", usage: "partial" })
  })

  it("maps pool engines to existing worker runners without losing the agent role", () => {
    expect(workerConfigForPoolEntry(pool[0], 2)).toEqual({
      idx: 2,
      kind: "sdk",
      provider: "openai",
      model: "gpt-5.4",
      yolo: false,
    })
    expect(workerConfigForPoolEntry(pool[1], 3)).toMatchObject({
      idx: 3,
      kind: "gemini-cli",
      model: "gemini-2.5-pro",
      presetAgent: "reviewer",
    })
    expect(
      workerConfigForPoolEntry(
        {
          id: "opencode",
          agentName: "general",
          enabled: true,
          engine: { kind: "acp", providerId: "opencode-cli", modelId: "opencode" },
        },
        1,
      ),
    ).toMatchObject({ kind: "opencode-cli", model: "opencode" })
  })

  it("routes SDK workers in-process and everything else through ACP", () => {
    expect(workerExecutionAdapter("sdk")).toBe("sdk")
    expect(workerExecutionAdapter("gemini-cli")).toBe("acp")
    expect(workerExecutionAdapter("opencode-cli")).toBe("acp")
    expect(workerExecutionAdapter("acp")).toBe("acp")
  })

  it("resolves legacy spawn requests only to enabled matching pool entries", () => {
    const settings = { ...DEFAULT_SUPERVISOR_SETTINGS, enabled: true, pool }
    expect(findSupervisorPoolEntry(settings, "reviewer")?.id).toBe("reviewer-acp")
    expect(findSupervisorPoolEntry(settings, "missing")).toBeNull()
    expect(findSupervisorPoolEntry({ ...settings, enabled: false }, "reviewer")).toBeNull()
  })

  it("keeps delegated context explicit and minimal", () => {
    expect(
      sanitizeRunContext({
        parentSummary: "summary",
        selectedFiles: ["src/a.ts", "", "src/a.ts"],
        workspace: "/repo",
        baseRevision: "abc123",
        history: ["secret"],
        env: { SECRET: "value" },
      }),
    ).toEqual({
      parentSummary: "summary",
      selectedFiles: ["src/a.ts"],
      workspace: "/repo",
      baseRevision: "abc123",
    })
  })
})
