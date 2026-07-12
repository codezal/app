import { Semaphore } from "@/lib/async/semaphore"
import { errorMessage } from "@/lib/errors"
import { createId } from "@/lib/id"
import { sanitizeRunContext } from "./context"
import type {
  AgentRunExecutor,
  AgentRunResult,
  AgentRunSpec,
  SupervisorDispatch,
  SupervisorPoolEntry,
  SupervisorSettings,
} from "./types"

export const DEFAULT_SUPERVISOR_SETTINGS: SupervisorSettings = {
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
}

export function findSupervisorPoolEntry(
  settings: SupervisorSettings,
  agentName: string,
): SupervisorPoolEntry | null {
  if (!settings.enabled) return null
  return settings.pool.find((entry) => entry.enabled && entry.agentName === agentName) ?? null
}

export class RunSupervisor {
  private readonly settings: SupervisorSettings

  constructor(settings: SupervisorSettings) {
    this.settings = settings
  }

  async dispatch(input: SupervisorDispatch, execute: AgentRunExecutor): Promise<AgentRunResult[]> {
    const entries = this.resolve(input)
    const semaphore = new Semaphore(this.settings.maxParallelRuns)
    return await Promise.all(
      entries.map((entry, index) =>
        semaphore.run(() => this.executeOne(input, entry, index, execute)),
      ),
    )
  }

  resolve(input: SupervisorDispatch): SupervisorPoolEntry[] {
    if (!this.settings.enabled) throw new Error("Agent Supervisor is not enabled")
    if (input.depth >= this.settings.maxDepth) throw new Error("Agent delegation depth limit reached")
    if (input.dispatches.length === 0) throw new Error("At least one child run is required")
    if ((input.existingChildCount ?? 0) + input.dispatches.length > this.settings.maxChildRunsPerTurn) {
      throw new Error(`Agent child run limit exceeded (${this.settings.maxChildRunsPerTurn})`)
    }
    return input.dispatches.map(({ poolEntryId }) => {
      const entry = this.settings.pool.find((candidate) => candidate.id === poolEntryId)
      if (!entry?.enabled) throw new Error(`Supervisor pool entry is not enabled: ${poolEntryId}`)
      return entry
    })
  }

  private async executeOne(
    input: SupervisorDispatch,
    entry: SupervisorPoolEntry,
    index: number,
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
      agentName: entry.agentName,
      engine: entry.engine,
      task: input.dispatches[index].task,
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
