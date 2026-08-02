import { Semaphore } from "@/lib/async/semaphore"
import { errorMessage } from "@/lib/errors"
import { createId } from "@/lib/id"
import { sanitizeRunContext } from "./context"
import type {
  AgentRunExecutor,
  AgentRunResult,
  AgentRunSpec,
  SupervisorDispatch,
  SupervisorSettings,
} from "./types"

export const DEFAULT_SUPERVISOR_SETTINGS: SupervisorSettings = {
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
}

// Validates limits and eligibility; returns the dispatches that may run.
// Role → engine resolution is the caller's job (see roles.ts) so the
// supervisor stays deterministic and testable.
export class RunSupervisor {
  private readonly settings: SupervisorSettings

  constructor(settings: SupervisorSettings) {
    this.settings = settings
  }

  async dispatch(input: SupervisorDispatch, execute: AgentRunExecutor): Promise<AgentRunResult[]> {
    const dispatches = this.resolve(input)
    const semaphore = new Semaphore(this.settings.maxParallelRuns)
    return await Promise.all(
      dispatches.map((dispatch) =>
        semaphore.run(() => this.executeOne(input, dispatch, execute)),
      ),
    )
  }

  resolve(input: SupervisorDispatch): SupervisorDispatch["dispatches"] {
    if (!this.settings.enabled) throw new Error("Agent Supervisor is not enabled")
    if (input.depth >= this.settings.maxDepth) throw new Error("Agent delegation depth limit reached")
    if (input.dispatches.length === 0) throw new Error("At least one child run is required")
    if ((input.existingChildCount ?? 0) + input.dispatches.length > this.settings.maxChildRunsPerTurn) {
      throw new Error(`Agent child run limit exceeded (${this.settings.maxChildRunsPerTurn})`)
    }
    return input.dispatches
  }

  private async executeOne(
    input: SupervisorDispatch,
    dispatch: SupervisorDispatch["dispatches"][number],
    execute: AgentRunExecutor,
  ): Promise<AgentRunResult> {
    const startedAt = Date.now()
    const controller = new AbortController()
    const abort = () => controller.abort()
    input.signal?.addEventListener("abort", abort, { once: true })
    const timer = setTimeout(abort, this.settings.maxWallClockMs)
    const run: AgentRunSpec = {
      runId: createId("worker"),
      parentRunId: input.parentRunId,
      sessionId: input.sessionId,
      depth: input.depth + 1,
      agentName: dispatch.role,
      task: dispatch.task,
      context: sanitizeRunContext(input.context),
      signal: controller.signal,
    }
    try {
      return await execute(run)
    } catch (error) {
      return {
        status: controller.signal.aborted ? "aborted" : "error",
        output: "",
        errorMessage: errorMessage(error),
        durationMs: Date.now() - startedAt,
      }
    } finally {
      clearTimeout(timer)
      input.signal?.removeEventListener("abort", abort)
    }
  }
}
