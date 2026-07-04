import { createId } from "@/lib/id"
import { errorMessage } from "@/lib/errors"
import type { WorkerEvent } from "../types"
import type { Semaphore } from "@/lib/async/semaphore"
import type { WorkflowBudget } from "./budget"
import { runAgentInline, type AgentModelOverride } from "./agent-core"

const AGENT_LIFETIME_CAP = 1000

export type AgentOpts = {
  label?: string
  phase?: string
  schema?: unknown
  model?: AgentModelOverride
  agentType?: string
  maxSteps?: number
}

export type SpawnCard = (info: {
  agentId: string
  label: string
  phase: string
  task: string
  agentType?: string
  model?: AgentModelOverride
}) => (ev: WorkerEvent) => void

export type WorkflowJournal = {
  lookup: (key: string) => { hit: boolean; value?: unknown }
  record: (key: string, value: unknown) => void
}

export type WorkflowHookCtx = {
  runId: string
  signal: AbortSignal
  workWorkspace?: string
  configWorkspace?: string
  defaultModel?: AgentModelOverride
  semaphore: Semaphore
  budget: WorkflowBudget
  spawnCard: SpawnCard
  onLog: (msg: string) => void
  onPhase: (title: string) => void
  journal?: WorkflowJournal
  resolveWorkflow?: (nameOrRef: string | { scriptPath: string }) => Promise<string>
  runNested?: (script: string, args: unknown, nesting: number) => Promise<unknown>
  counter: { agents: number }
  state: { currentPhase: string }
  nesting: number
}

export type WorkflowHooks = {
  agent: (prompt: string, opts?: AgentOpts) => Promise<unknown>
  log: (msg: string) => void
  phase: (title: string) => void
}

function callKey(index: number, prompt: string, opts: AgentOpts): string {
  return `${index}::${prompt}::${JSON.stringify({
    schema: opts.schema ?? null,
    model: opts.model ?? null,
    agentType: opts.agentType ?? null,
  })}`
}

export function createHooks(ctx: WorkflowHookCtx): WorkflowHooks {
  function ensureLive(): void {
    if (ctx.signal.aborted) throw new Error("workflow durduruldu")
  }

  async function agent(prompt: string, opts: AgentOpts = {}): Promise<unknown> {
    ensureLive()
    const index = ctx.counter.agents++
    if (ctx.counter.agents > AGENT_LIFETIME_CAP) {
      throw new Error(`workflow agent ömür limiti (${AGENT_LIFETIME_CAP}) aşıldı`)
    }
    if (ctx.budget.total != null && ctx.budget.remaining() <= 0) {
      throw new Error("workflow token budget tükendi")
    }

    const key = callKey(index, prompt, opts)
    const cached = ctx.journal?.lookup(key)
    if (cached?.hit) return cached.value

    const phase = opts.phase ?? ctx.state.currentPhase
    const agentId = createId("wfAgent")
    const label = opts.label ?? opts.agentType ?? "agent"
    const model = opts.model ?? ctx.defaultModel

    const emit = ctx.spawnCard({ agentId, label, phase, task: prompt, agentType: opts.agentType, model })

    const out = await ctx.semaphore.run(async () => {
      try {
        const res = await runAgentInline({
          prompt,
          workWorkspace: ctx.workWorkspace,
          configWorkspace: ctx.configWorkspace,
          ownerId: agentId,
          model,
          agentType: opts.agentType,
          schema: opts.schema,
          maxSteps: opts.maxSteps,
          emit,
          signal: ctx.signal,
        })
        ctx.budget.add(res.tokensOut ?? 0)
        return opts.schema ? res.structured : res.text
      } catch (e) {
        if (ctx.signal.aborted) emit({ type: "aborted" })
        else emit({ type: "error", message: errorMessage(e) })
        throw e
      }
    })

    ctx.journal?.record(key, out)
    return out
  }

  function log(msg: string): void {
    ctx.onLog(String(msg))
  }

  function phase(title: string): void {
    ctx.state.currentPhase = String(title)
    ctx.onPhase(String(title))
  }

  return { agent, log, phase }
}
