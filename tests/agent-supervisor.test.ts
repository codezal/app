import { describe, expect, it } from "vitest"
import {
  DEFAULT_SUPERVISOR_SETTINGS,
  RunSupervisor,
  capabilitiesForEngine,
  sanitizeRunContext,
  resolveRoleEngine,
  resolveMainEngine,
  workerConfigForRole,
  type AgentRunResult,
  type AgentRoleId,
  type SupervisorSettings,
} from "@/lib/agents/runtime"
import { DEFAULT_SETTINGS } from "@/lib/config/defaults"
import { parseSettings } from "@/lib/config/schema"

const settings: SupervisorSettings = {
  ...DEFAULT_SUPERVISOR_SETTINGS,
  enabled: true,
  roles: {
    worker: { provider: "openai", model: "gpt-5.4" },
    reviewer: { provider: "anthropic", model: "claude-sonnet-4-5" },
    small: { provider: "openai", model: "gpt-5-mini" },
  },
}

const session = {
  id: "session-1",
  provider: "anthropic" as const,
  model: "claude-opus-4-1",
}

describe("agent orchestration roles", () => {
  it("uses safe opt-in defaults", () => {
    expect(DEFAULT_SUPERVISOR_SETTINGS).toMatchObject({
      enabled: false,
      routing: "hybrid",
      autoDelegate: true,
      autoReview: false,
      maxParallelRuns: 3,
      maxChildRunsPerTurn: 5,
      maxDepth: 1,
      maxWallClockMs: 30 * 60 * 1000,
      isolation: "auto",
      mergePolicy: "safe-auto",
      roles: {},
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
          roles: settings.roles,
        },
      },
      DEFAULT_SETTINGS,
    )
    expect(parsed.supervisor).toMatchObject({
      enabled: true,
      maxParallelRuns: 5,
      maxChildRunsPerTurn: 1,
      roles: settings.roles,
    })
  })

  it("resolves pinned roles to sdk engines and unpinned roles to null", () => {
    expect(resolveRoleEngine(settings, "worker")).toEqual({
      kind: "sdk",
      providerId: "openai",
      modelId: "gpt-5.4",
    })
    expect(resolveRoleEngine(settings, "planner")).toBeNull()
    expect(resolveRoleEngine({ ...settings, enabled: false }, "worker")).toEqual({
      kind: "sdk",
      providerId: "openai",
      modelId: "gpt-5.4",
    })
  })

  it("resolves the main engine: plan → planner, build → orchestrator, else session", () => {
    // No pin: session model wins (override respected).
    expect(
      resolveMainEngine({
        settings: DEFAULT_SUPERVISOR_SETTINGS,
        session,
        mode: "build",
      }),
    ).toEqual({ provider: "anthropic", model: "claude-opus-4-1" })
    expect(
      resolveMainEngine({
        settings: DEFAULT_SUPERVISOR_SETTINGS,
        session,
        mode: "build",
        override: { provider: "openai", model: "gpt-5.4" },
      }),
    ).toEqual({ provider: "openai", model: "gpt-5.4" })
    // Pinned planner used in plan mode.
    const withPlanner: SupervisorSettings = {
      ...DEFAULT_SUPERVISOR_SETTINGS,
      roles: { planner: { provider: "google", model: "gemini-3-pro" } },
    }
    expect(
      resolveMainEngine({ settings: withPlanner, session, mode: "plan" }),
    ).toEqual({ provider: "google", model: "gemini-3-pro" })
    expect(
      resolveMainEngine({ settings: withPlanner, session, mode: "build" }),
    ).toEqual({ provider: "anthropic", model: "claude-opus-4-1" })
    // Pinned orchestrator used in build mode.
    const withOrchestrator: SupervisorSettings = {
      ...DEFAULT_SUPERVISOR_SETTINGS,
      roles: { orchestrator: { provider: "openai", model: "gpt-5.4" } },
    }
    expect(
      resolveMainEngine({ settings: withOrchestrator, session, mode: "build" }),
    ).toEqual({ provider: "openai", model: "gpt-5.4" })
    // Override wins even over a pinned orchestrator.
    expect(
      resolveMainEngine({
        settings: withOrchestrator,
        session,
        mode: "build",
        override: { model: "gpt-5.2" },
      }),
    ).toEqual({ provider: "anthropic", model: "gpt-5.2" })
  })

  it("maps role engines to worker configs without losing the role label", () => {
    const engine = resolveRoleEngine(settings, "worker")!
    expect(
      workerConfigForRole({ role: "worker", engine, idx: 2, session }),
    ).toEqual({
      idx: 2,
      kind: "sdk",
      provider: "openai",
      model: "gpt-5.4",
      yolo: false,
      label: "worker",
      readOnly: false,
    })
    expect(
      workerConfigForRole({
        role: "reviewer",
        engine: resolveRoleEngine(settings, "reviewer")!,
        idx: 1,
        session,
        systemPrompt: "review contract",
        label: "reviewer",
      }),
    ).toMatchObject({
      idx: 1,
      kind: "sdk",
      provider: "anthropic",
      model: "claude-sonnet-4-5",
      systemPrompt: "review contract",
      readOnly: true,
    })
  })

  it("declares conservative engine capabilities", () => {
    expect(
      capabilitiesForEngine({ kind: "sdk", providerId: "openai", modelId: "gpt-5.4" }),
    ).toMatchObject({
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

  it("enforces depth and child-run limits", async () => {
    const supervisor = new RunSupervisor({ ...settings, enabled: true })
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
          dispatches: [{ role: "worker", task: "nested" }],
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
            role: "worker" as AgentRoleId,
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
          dispatches: [{ role: "worker", task: "one more" }],
        },
        execute,
      ),
    ).rejects.toThrow(/child run limit/i)
  })

  it("preserves dispatch order while enforcing the concurrency cap", async () => {
    let active = 0
    let maxActive = 0
    const supervisor = new RunSupervisor({ ...settings, enabled: true, maxParallelRuns: 1 })
    const results = await supervisor.dispatch(
      {
        sessionId: "session-1",
        parentRunId: "parent",
        depth: 0,
        dispatches: [
          { role: "worker", task: "first" },
          { role: "reviewer", task: "second" },
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
