// Orkestra runtime — dispatch_workers tool'unun arka motoru.
import { useSessionsStore } from "@/store/sessions"
import { useJobsStore } from "@/store/jobs"
import { startSdkWorker } from "./runners/sdk"
import { startAcpWorker } from "./runners/acp"
import { startNativeCliWorker } from "./runners/native-cli"
import type {
  AgentCardPart,
  AgentCardToolCall,
  OrchestraConfig,
  RunnerStart,
  WorkerConfig,
  WorkerDispatchResult,
  WorkerEvent,
  WorkerKind,
} from "./types"
import {
  setupWorkerIsolation,
  finalizeIsolation,
  teardownWorkerIsolation,
  cleanupStaleIsolation,
  type WorkerIsolation,
} from "./isolation"
import { createId } from "@/lib/id"
import { errorMessage } from "@/lib/errors"
import { codenameFor } from "./codenames"
import { Semaphore } from "@/lib/async/semaphore"

//   opencode-cli → "opencode acp" (native)
//   kimi-cli     → "kimi acp" (native)
//   claude-cli   → "@agentclientprotocol/claude-agent-acp" adapter (lokal claude login)
//   codex-cli    → "@zed-industries/codex-acp" adapter (ChatGPT login / API key)
const RUNNERS: Record<WorkerKind, RunnerStart> = {
  sdk: startSdkWorker,
  "claude-cli": startNativeCliWorker,
  "codex-cli": startNativeCliWorker,
  "opencode-cli": startAcpWorker,
  "kimi-cli": startAcpWorker,
  "gemini-cli": startAcpWorker,
  acp: startAcpWorker,
}

const dispatchControllers = new Map<string, AbortController>()

const activeWorktrees = new Set<string>()

export function abortDispatchFor(sessionId: string): void {
  dispatchControllers.get(sessionId)?.abort()
}

export type DispatchInput = {
  workerIdx: number
  task: string
}

function workerLabel(w: WorkerConfig, taskNum: number): string {
  if (w.label) return `${w.label} · task-${taskNum}`
  const kindTag =
    w.kind === "sdk"
      ? `${w.provider ?? "?"}/${w.model ?? "?"}`
      : w.kind
  return `worker-${w.idx} · task-${taskNum} · ${kindTag}`
}

function nextTaskNum(sessionId: string, workerIdx: number): number {
  const sess = useSessionsStore.getState().sessions[sessionId]
  if (!sess) return 1
  let count = 0
  for (const m of sess.messages) {
    if (!m.parts) continue
    for (const p of m.parts) {
      if (p.type === "agent-card" && p.workerIdx === workerIdx) count++
    }
  }
  return count + 1
}

function makeInitialCard(
  workerId: string,
  w: WorkerConfig,
  taskNum: number,
  task: string,
): AgentCardPart {
  return {
    type: "agent-card",
    workerId,
    workerIdx: w.idx,
    taskNum,
    task,
    workerLabel: workerLabel(w, taskNum),
    displayName: w.label?.trim() || codenameFor(workerId),
    kind: w.kind,
    configSnapshot: {
      kind: w.kind,
      provider: w.provider,
      model: w.model,
      yolo: w.yolo,
      presetAgent: w.presetAgent,
    },
    status: "pending",
    outputLog: [],
    toolCalls: [],
    startedAt: Date.now(),
  }
}

export async function dispatchWorkers(
  cfg: OrchestraConfig,
  dispatches: DispatchInput[],
  parentMessageId: string,
  sessionId: string,
  workspacePath: string | undefined,
  parentSignal?: AbortSignal,
): Promise<WorkerDispatchResult[]> {
  const store = useSessionsStore.getState()
  const logBuffer = cfg.logBufferLines ?? 200

  await cleanupStaleIsolation(workspacePath, activeWorktrees).catch(() => {})

  const ac = new AbortController()
  if (parentSignal) {
    if (parentSignal.aborted) ac.abort()
    else parentSignal.addEventListener("abort", () => ac.abort(), { once: true })
  }
  dispatchControllers.set(sessionId, ac)

  const runs: Promise<WorkerDispatchResult>[] = []
  const semaphore = new Semaphore(Math.max(1, Math.min(dispatches.length, cfg.maxParallel ?? dispatches.length)))

  for (const d of dispatches) {
    const w = cfg.workers.find((x) => x.idx === d.workerIdx)
    if (!w) {
      const startedAt = Date.now()
      runs.push(
        Promise.resolve({
          workerIdx: d.workerIdx,
          workerId: `invalid-${d.workerIdx}`,
          status: "error" as const,
          output: "",
          errorMessage: `Worker idx=${d.workerIdx} havuzda yok`,
          durationMs: Date.now() - startedAt,
        }),
      )
      continue
    }

    const workerId = createId("worker")
    const taskNum = nextTaskNum(sessionId, w.idx)
    const card = makeInitialCard(workerId, w, taskNum, d.task)
    store.pushAgentCardFor(sessionId, parentMessageId, card)

    const emit = createCardEmitter(sessionId, parentMessageId, workerId, logBuffer)

    const runner = RUNNERS[w.kind]
    if (!runner) {
      emit({ type: "error", message: `Bilinmeyen worker tipi: ${w.kind}` })
      const startedAt = Date.now()
      runs.push(
        Promise.resolve({
          workerIdx: w.idx,
          workerId,
          status: "error",
          output: "",
          errorMessage: `Bilinmeyen worker tipi: ${w.kind}`,
          durationMs: Date.now() - startedAt,
        }),
      )
      continue
    }

    runs.push(
      semaphore.run(() =>
        runOneWorker(w, d.task, workerId, taskNum, runner, emit, ac.signal, workspacePath, sessionId),
      ),
    )
  }

  try {
    const results = await Promise.all(runs)
    return results
  } finally {
    if (dispatchControllers.get(sessionId) === ac) dispatchControllers.delete(sessionId)
  }
}

// setup (worktree?) → runner → finalize (commit+diff) → teardown (worktree remove).
async function runOneWorker(
  w: WorkerConfig,
  task: string,
  workerId: string,
  taskNum: number,
  runner: RunnerStart,
  emit: (ev: WorkerEvent) => void,
  signal: AbortSignal,
  configWorkspace: string | undefined,
  ownerSessionId: string,
): Promise<WorkerDispatchResult> {
  let iso: WorkerIsolation | null = null
  const startedAt = Date.now()
  try {
    iso = await setupWorkerIsolation(w, configWorkspace, workerId, taskNum)
    if (iso.worktreePath) activeWorktrees.add(iso.worktreePath)
    const { done } = await runner({
      workerId,
      config: w,
      task,
      workWorkspace: iso.workWorkspace,
      configWorkspace: iso.configWorkspace,
      emit,
      signal,
      ownerSessionId,
    })
    const result = await done
    return await finalizeIsolation(iso, result, task)
  } catch (e) {
    const errResult: WorkerDispatchResult = {
      workerIdx: w.idx,
      workerId,
      status: signal.aborted ? "aborted" : "error",
      output: "",
      errorMessage: errorMessage(e),
      durationMs: Date.now() - startedAt,
    }
    return await finalizeIsolation(iso, errResult, task)
  } finally {
    if (iso?.worktreePath) activeWorktrees.delete(iso.worktreePath)
    await teardownWorkerIsolation(iso)
    void useJobsStore.getState().killBySession(workerId)
  }
}

export function createCardEmitter(
  sessionId: string,
  parentMessageId: string,
  workerId: string,
  logBuffer: number,
): (ev: WorkerEvent) => void {
  let awaitingApproval = false
  return (ev: WorkerEvent) => {
    const cur = useSessionsStore.getState()
    if (
      awaitingApproval &&
      (ev.type === "text-delta" || ev.type === "tool-call" || ev.type === "tool-result")
    ) {
      awaitingApproval = false
      cur.patchAgentCardFor(sessionId, parentMessageId, workerId, { status: "running" })
    }
    switch (ev.type) {
      case "started":
        cur.patchAgentCardFor(sessionId, parentMessageId, workerId, {
          status: "running",
          startedAt: Date.now(),
        })
        break
      case "log":
        cur.appendAgentCardLogFor(sessionId, parentMessageId, workerId, ev.line, logBuffer)
        break
      case "text-delta":
        cur.appendAgentCardFinalTextFor(sessionId, parentMessageId, workerId, ev.delta)
        break
      case "tool-call": {
        const tc: AgentCardToolCall = { name: ev.name, status: "running" }
        const sess = useSessionsStore.getState().sessions[sessionId]
        const msg = sess?.messages.find((m) => m.id === parentMessageId)
        const part = msg?.parts?.find(
          (p) => p.type === "agent-card" && p.workerId === workerId,
        ) as AgentCardPart | undefined
        const next = [...(part?.toolCalls ?? []), tc]
        cur.patchAgentCardFor(sessionId, parentMessageId, workerId, { toolCalls: next })
        break
      }
      case "tool-result": {
        const sess = useSessionsStore.getState().sessions[sessionId]
        const msg = sess?.messages.find((m) => m.id === parentMessageId)
        const part = msg?.parts?.find(
          (p) => p.type === "agent-card" && p.workerId === workerId,
        ) as AgentCardPart | undefined
        if (!part?.toolCalls) break
        const next = part.toolCalls.slice()
        for (let i = next.length - 1; i >= 0; i--) {
          if (next[i].name === ev.name && next[i].status === "running") {
            next[i] = { ...next[i], status: ev.isError ? "error" : "done" }
            break
          }
        }
        cur.patchAgentCardFor(sessionId, parentMessageId, workerId, { toolCalls: next })
        break
      }
      case "waiting-approval":
        awaitingApproval = true
        cur.patchAgentCardFor(sessionId, parentMessageId, workerId, { status: "waiting-approval" })
        break
      case "usage":
        cur.patchAgentCardFor(sessionId, parentMessageId, workerId, {
          tokensIn: ev.tokensIn,
          tokensOut: ev.tokensOut,
        })
        break
      case "complete":
        cur.patchAgentCardFor(sessionId, parentMessageId, workerId, {
          status: "done",
          finishedAt: Date.now(),
          finalText: ev.text,
        })
        break
      case "error":
        cur.patchAgentCardFor(sessionId, parentMessageId, workerId, {
          status: "error",
          finishedAt: Date.now(),
          errorMessage: ev.message,
        })
        break
      case "aborted":
        cur.patchAgentCardFor(sessionId, parentMessageId, workerId, {
          status: "aborted",
          finishedAt: Date.now(),
        })
        break
    }
  }
}
