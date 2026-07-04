// Workflow run state — run_workflow detached spawn eder, workflow_status poll eder.
// jobs.ts (background bash) modelini izler: spawn → runId, wait/read/list/abort.
import { create } from "zustand"
import { createId } from "@/lib/id"
import { errorMessage } from "@/lib/errors"
import type { AgentCardStatus, AgentCardToolCall, WorkerEvent } from "@/lib/orchestra/types"
import type { AgentModelOverride } from "@/lib/orchestra/workflow/agent-core"
import type { SpawnCard } from "@/lib/orchestra/workflow/hooks"
import { parseMeta } from "@/lib/orchestra/workflow/meta"
import { createJournal } from "@/lib/orchestra/workflow/journal"
import { loadWorkflowScript } from "@/lib/commands/workflow"
import { useSessionsStore } from "@/store/sessions"
import type { ProviderId } from "@/lib/providers"

export type WorkflowRunStatus = "running" | "done" | "error" | "cancelled"

export type WorkflowAgentCard = {
  agentId: string
  label: string
  phase: string
  task: string
  agentType?: string
  status: AgentCardStatus
  outputLog: string[]
  toolCalls: AgentCardToolCall[]
  finalText?: string
  tokensIn?: number
  tokensOut?: number
  startedAt?: number
  finishedAt?: number
  errorMessage?: string
}

export type WorkflowPhaseRun = { title: string; detail?: string }

export type WorkflowRun = {
  runId: string
  sessionId: string
  name: string
  description: string
  status: WorkflowRunStatus
  script: string
  scriptPath?: string
  args?: unknown
  phases: WorkflowPhaseRun[]
  agents: WorkflowAgentCard[]
  logLines: string[]
  result?: string
  error?: string
  startedAt: number
  finishedAt?: number
}

const CARD_LOG_MAX = 200
const RUN_LOG_MAX = 300
export const WF_DEFAULT_WAIT_MS = 30_000

const controllers = new Map<string, AbortController>()
const waiters = new Map<string, Array<(r: WorkflowRun) => void>>()

function pushRing(buf: string[], line: string, max: number): string[] {
  const out = [...buf, line]
  if (out.length > max) out.splice(0, out.length - max)
  return out
}

export type SpawnWorkflowInput = {
  sessionId: string
  script: string
  args?: unknown
  workspace?: string
  configWorkspace?: string
  scriptPath?: string
  budgetTotal?: number | null
  resumeFromRunId?: string
}

type WorkflowsState = {
  runs: Record<string, WorkflowRun>
  spawn: (input: SpawnWorkflowInput) => Promise<string>
  read: (runId: string) => WorkflowRun | undefined
  list: () => WorkflowRun[]
  abort: (runId: string) => void
  wait: (runId: string, timeoutMs?: number) => Promise<WorkflowRun | undefined>
  clearFinished: () => number
}

export const useWorkflowsStore = create<WorkflowsState>((set, get) => {
  function patchAgent(runId: string, agentId: string, patch: Partial<WorkflowAgentCard>): void {
    set((s) => {
      const run = s.runs[runId]
      if (!run) return s
      const agents = run.agents.map((a) => (a.agentId === agentId ? { ...a, ...patch } : a))
      return { runs: { ...s.runs, [runId]: { ...run, agents } } }
    })
  }

  function applyEvent(runId: string, agentId: string, ev: WorkerEvent): void {
    const run = get().runs[runId]
    const card = run?.agents.find((a) => a.agentId === agentId)
    switch (ev.type) {
      case "started":
        patchAgent(runId, agentId, { status: "running", startedAt: Date.now() })
        break
      case "log":
        patchAgent(runId, agentId, {
          outputLog: pushRing(card?.outputLog ?? [], ev.line, CARD_LOG_MAX),
        })
        break
      case "text-delta":
        patchAgent(runId, agentId, { finalText: (card?.finalText ?? "") + ev.delta })
        break
      case "tool-call":
        patchAgent(runId, agentId, {
          toolCalls: [...(card?.toolCalls ?? []), { name: ev.name, status: "running" }],
        })
        break
      case "tool-result": {
        const tc = (card?.toolCalls ?? []).slice()
        for (let i = tc.length - 1; i >= 0; i--) {
          if (tc[i].name === ev.name && tc[i].status === "running") {
            tc[i] = { ...tc[i], status: ev.isError ? "error" : "done" }
            break
          }
        }
        patchAgent(runId, agentId, { toolCalls: tc })
        break
      }
      case "usage":
        patchAgent(runId, agentId, { tokensIn: ev.tokensIn, tokensOut: ev.tokensOut })
        break
      case "waiting-approval":
        patchAgent(runId, agentId, { status: "waiting-approval" })
        break
      case "complete":
        patchAgent(runId, agentId, { status: "done", finishedAt: Date.now(), finalText: ev.text })
        break
      case "error":
        patchAgent(runId, agentId, { status: "error", finishedAt: Date.now(), errorMessage: ev.message })
        break
      case "aborted":
        patchAgent(runId, agentId, { status: "aborted", finishedAt: Date.now() })
        break
    }
  }

  function finalize(runId: string, patch: Partial<WorkflowRun>): void {
    set((s) => {
      const run = s.runs[runId]
      if (!run || run.status !== "running") return s
      return { runs: { ...s.runs, [runId]: { ...run, ...patch, finishedAt: Date.now() } } }
    })
    controllers.delete(runId)
    const final = get().runs[runId]
    if (final && final.status !== "running") {
      const ws = waiters.get(runId)
      if (ws) {
        waiters.delete(runId)
        for (const w of ws) w(final)
      }
    }
  }

  return {
    runs: {},

    spawn: async (input) => {
      const runId = createId("workflow")

      let name = "workflow"
      let description = ""
      let phases: WorkflowPhaseRun[] = []
      try {
        const meta = parseMeta(input.script)
        name = meta.name
        description = meta.description
        phases = (meta.phases ?? []).map((p) => ({ title: p.title, detail: p.detail }))
      } catch (e) {
        set((s) => ({
          runs: {
            ...s.runs,
            [runId]: {
              runId,
              sessionId: input.sessionId,
              name,
              description,
              status: "error",
              script: input.script,
              scriptPath: input.scriptPath,
              args: input.args,
              phases: [],
              agents: [],
              logLines: [`meta hatası: ${errorMessage(e)}`],
              error: errorMessage(e),
              startedAt: Date.now(),
              finishedAt: Date.now(),
            },
          },
        }))
        return runId
      }

      const ac = new AbortController()
      controllers.set(runId, ac)

      set((s) => ({
        runs: {
          ...s.runs,
          [runId]: {
            runId,
            sessionId: input.sessionId,
            name,
            description,
            status: "running",
            script: input.script,
            scriptPath: input.scriptPath,
            args: input.args,
            phases,
            agents: [],
            logLines: [],
            startedAt: Date.now(),
          },
        },
      }))

      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("codezal:open-workflows"))
      }

      // Parent session default modeli.
      const sess = useSessionsStore.getState().sessions[input.sessionId]
      const defaultModel: AgentModelOverride | undefined =
        sess?.provider && sess?.model
          ? { provider: sess.provider as ProviderId, modelId: sess.model }
          : undefined

      const spawnCard: SpawnCard = (info) => {
        set((s) => {
          const run = s.runs[runId]
          if (!run) return s
          const phaseList = run.phases.some((p) => p.title === info.phase)
            ? run.phases
            : info.phase
              ? [...run.phases, { title: info.phase }]
              : run.phases
          const card: WorkflowAgentCard = {
            agentId: info.agentId,
            label: info.label,
            phase: info.phase,
            task: info.task,
            agentType: info.agentType,
            status: "pending",
            outputLog: [],
            toolCalls: [],
            startedAt: Date.now(),
          }
          return { runs: { ...s.runs, [runId]: { ...run, phases: phaseList, agents: [...run.agents, card] } } }
        })
        return (ev: WorkerEvent) => applyEvent(runId, info.agentId, ev)
      }

      const onLog = (msg: string): void => {
        set((s) => {
          const run = s.runs[runId]
          if (!run) return s
          return { runs: { ...s.runs, [runId]: { ...run, logLines: pushRing(run.logLines, msg, RUN_LOG_MAX) } } }
        })
      }

      const onPhase = (title: string): void => {
        set((s) => {
          const run = s.runs[runId]
          if (!run || run.phases.some((p) => p.title === title)) return s
          return { runs: { ...s.runs, [runId]: { ...run, phases: [...run.phases, { title }] } } }
        })
      }

      void (async () => {
        try {
          const { runWorkflow } = await import("@/lib/orchestra/workflow/runtime")
          const { result } = await runWorkflow({
            runId,
            script: input.script,
            args: input.args,
            signal: ac.signal,
            workWorkspace: input.workspace,
            configWorkspace: input.configWorkspace,
            defaultModel,
            budgetTotal: input.budgetTotal ?? null,
            spawnCard,
            onLog,
            onPhase,
            journal: createJournal(runId, input.resumeFromRunId),
            resolveWorkflow: (nameOrRef) => loadWorkflowScript(nameOrRef, input.workspace),
          })
          const text = typeof result === "string" ? result : JSON.stringify(result, null, 2)
          finalize(runId, { status: "done", result: text })
        } catch (e) {
          if (ac.signal.aborted) finalize(runId, { status: "cancelled", error: "durduruldu" })
          else finalize(runId, { status: "error", error: errorMessage(e) })
        }
      })()

      return runId
    },

    read: (runId) => get().runs[runId],

    list: () => Object.values(get().runs).sort((a, b) => a.startedAt - b.startedAt),

    abort: (runId) => {
      controllers.get(runId)?.abort()
    },

    wait: (runId, timeoutMs = WF_DEFAULT_WAIT_MS) => {
      const r = get().runs[runId]
      if (!r) return Promise.resolve(undefined)
      if (r.status !== "running") return Promise.resolve(r)
      return new Promise<WorkflowRun | undefined>((resolve) => {
        let settled = false
        const done = (run: WorkflowRun) => {
          if (settled) return
          settled = true
          clearTimeout(timer)
          resolve(run)
        }
        const arr = waiters.get(runId) ?? []
        arr.push(done)
        waiters.set(runId, arr)
        const timer = setTimeout(() => {
          if (settled) return
          settled = true
          const cur = waiters.get(runId)
          if (cur) {
            const i = cur.indexOf(done)
            if (i >= 0) cur.splice(i, 1)
            if (cur.length === 0) waiters.delete(runId)
          }
          resolve(get().runs[runId])
        }, timeoutMs)
      })
    },

    clearFinished: () => {
      const cur = get().runs
      const keep: Record<string, WorkflowRun> = {}
      let removed = 0
      for (const [id, r] of Object.entries(cur)) {
        if (r.status === "running") keep[id] = r
        else removed++
      }
      if (removed > 0) set({ runs: keep })
      return removed
    },
  }
})
