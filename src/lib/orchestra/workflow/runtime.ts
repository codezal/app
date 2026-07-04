// worker terminate edilir (main thread DONMAZ). agent()/log()/phase()/workflow() worker'dan
//
import { parseMeta, type WorkflowMeta } from "./meta"
import { createHooks, type AgentOpts, type SpawnCard, type WorkflowHookCtx, type WorkflowJournal } from "./hooks"
import { createBudget, type WorkflowBudget } from "./budget"
import { Semaphore, workflowConcurrencyCap } from "@/lib/async/semaphore"
import { executeScript, type ScriptApi } from "./script-runner"
import type { WorkerToHost } from "./sandbox-protocol"
import { errorMessage } from "@/lib/errors"
import type { AgentModelOverride } from "./agent-core"

export type RunWorkflowInput = {
  runId: string
  script: string
  args: unknown
  signal: AbortSignal
  workWorkspace?: string
  configWorkspace?: string
  defaultModel?: AgentModelOverride
  budgetTotal?: number | null
  maxWallClockMs?: number
  spawnCard: SpawnCard
  onLog: (msg: string) => void
  onPhase: (title: string) => void
  journal?: WorkflowJournal
  resolveWorkflow?: (nameOrRef: string | { scriptPath: string }) => Promise<string>
}

export type RunWorkflowResult = {
  meta: WorkflowMeta
  result: unknown
}

type WorkflowRef = string | { scriptPath: string }

const DEFAULT_MAX_WALL_CLOCK_MS = 30 * 60 * 1000

export async function runWorkflow(input: RunWorkflowInput): Promise<RunWorkflowResult> {
  const meta = parseMeta(input.script)

  const semaphore = new Semaphore(workflowConcurrencyCap())
  const budget = createBudget(input.budgetTotal ?? null)
  const counter = { agents: 0 }

  const ctx: WorkflowHookCtx = {
    runId: input.runId,
    signal: input.signal,
    workWorkspace: input.workWorkspace,
    configWorkspace: input.configWorkspace,
    defaultModel: input.defaultModel,
    semaphore,
    budget,
    spawnCard: input.spawnCard,
    onLog: input.onLog,
    onPhase: input.onPhase,
    journal: input.journal,
    resolveWorkflow: input.resolveWorkflow,
    counter,
    state: { currentPhase: meta.phases?.[0]?.title ?? "" },
    nesting: 0,
  }
  const hooks = createHooks(ctx)

  const result =
    typeof Worker !== "undefined"
      ? await runViaWorker(input, hooks, budget)
      : await runInline(input, hooks, budget)

  return { meta, result }
}

function runViaWorker(
  input: RunWorkflowInput,
  hooks: ReturnType<typeof createHooks>,
  budget: WorkflowBudget,
): Promise<unknown> {
  return new Promise<unknown>((resolve, reject) => {
    const worker = new Worker(new URL("./workflow.worker.ts", import.meta.url), { type: "module" })
    let settled = false
    const maxMs = input.maxWallClockMs ?? DEFAULT_MAX_WALL_CLOCK_MS

    const cleanup = (): void => {
      clearTimeout(deadline)
      input.signal.removeEventListener("abort", onAbort)
      worker.terminate()
    }
    const finish = (fn: () => void): void => {
      if (settled) return
      settled = true
      cleanup()
      fn()
    }
    const onAbort = (): void => finish(() => reject(new Error("workflow durduruldu")))
    const deadline = setTimeout(
      () => finish(() => reject(new Error(`workflow zaman aşımı (${maxMs}ms) — worker durduruldu`))),
      maxMs,
    )

    worker.onmessage = async (e: MessageEvent<WorkerToHost>): Promise<void> => {
      const m = e.data
      if (m.t === "agent") {
        try {
          const value = await hooks.agent(m.prompt, m.opts as AgentOpts)
          if (!settled) worker.postMessage({ t: "agentRes", id: m.id, ok: true, value, spent: budget.spent() })
        } catch (err) {
          if (!settled)
            worker.postMessage({ t: "agentRes", id: m.id, ok: false, error: errorMessage(err), spent: budget.spent() })
        }
      } else if (m.t === "wf") {
        try {
          if (!input.resolveWorkflow) throw new Error("iç içe workflow bu ortamda desteklenmiyor")
          const script = await input.resolveWorkflow(m.ref as WorkflowRef)
          if (!settled) worker.postMessage({ t: "wfRes", id: m.id, ok: true, script })
        } catch (err) {
          if (!settled) worker.postMessage({ t: "wfRes", id: m.id, ok: false, error: errorMessage(err) })
        }
      } else if (m.t === "log") {
        hooks.log(m.msg)
      } else if (m.t === "phase") {
        hooks.phase(m.title)
      } else if (m.t === "done") {
        finish(() => resolve(m.result))
      } else if (m.t === "fail") {
        finish(() => reject(new Error(m.error)))
      }
    }
    worker.onerror = (e: ErrorEvent): void =>
      finish(() => reject(new Error(`workflow worker hatası: ${e.message || "bilinmeyen"}`)))

    input.signal.addEventListener("abort", onAbort, { once: true })
    if (input.signal.aborted) {
      onAbort()
      return
    }
    worker.postMessage({
      t: "start",
      script: input.script,
      args: input.args,
      budgetTotal: input.budgetTotal ?? null,
    })
  })
}

// ── Inline yolu — Worker yokken (node/test, trusted script) ──────────────────────
function runInline(
  input: RunWorkflowInput,
  hooks: ReturnType<typeof createHooks>,
  budget: WorkflowBudget,
): Promise<unknown> {
  let nesting = 0
  const api: ScriptApi = {
    agent: hooks.agent as ScriptApi["agent"],
    log: hooks.log,
    phase: hooks.phase,
    workflow: async (ref, args) => {
      if (nesting >= 1) {
        throw new Error("workflow() iç içe çağrı tek seviye — bir alt-workflow içinde workflow() çağrılamaz")
      }
      if (!input.resolveWorkflow) throw new Error("iç içe workflow bu ortamda desteklenmiyor")
      const script = await input.resolveWorkflow(ref as WorkflowRef)
      nesting++
      try {
        return await executeScript(script, args, api)
      } finally {
        nesting--
      }
    },
    budget,
    isAborted: () => input.signal.aborted,
  }
  return executeScript(input.script, input.args, api)
}
