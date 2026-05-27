// Orkestra runtime — dispatch_workers tool'unun arka motoru.
// Verilen worker indekslerini paralel spawn eder, her birinin canlı stream'ini
// parent assistant mesajının agent-card Part'ına patch'ler. Tüm worker'lar bitince
// aggregated JSON döner — parent LLM context'ine girer.
import { useSessionsStore } from "@/store/sessions"
import { startSdkWorker } from "./runners/sdk"
import { startClaudeCliWorker } from "./runners/claude-cli"
import { startCodexCliWorker } from "./runners/codex-cli"
import { startOpencodeCliWorker } from "./runners/opencode-cli"
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

const RUNNERS: Record<WorkerKind, RunnerStart> = {
  sdk: startSdkWorker,
  "claude-cli": startClaudeCliWorker,
  "codex-cli": startCodexCliWorker,
  "opencode-cli": startOpencodeCliWorker,
}

// Aktif dispatch için abort kanalı — UI top-level "stop" parent stream'i durdurunca
// bu da iptal olmalı. Şimdilik tek aktif dispatch varsayımı.
let currentAbortController: AbortController | null = null

export function abortCurrentDispatch(): void {
  currentAbortController?.abort()
}

export type DispatchInput = {
  workerIdx: number
  task: string
}

// Worker etiketi — UI ve approval modal için.
// "worker-N · görev-M · model" formatı; aynı slot tekrar dispatch'lenirse M artar.
function workerLabel(w: WorkerConfig, taskNum: number): string {
  if (w.label) return `${w.label} · görev-${taskNum}`
  const kindTag =
    w.kind === "sdk"
      ? `${w.provider ?? "?"}/${w.model ?? "?"}`
      : w.kind
  return `worker-${w.idx} · görev-${taskNum} · ${kindTag}`
}

// Aktif session'daki mevcut agent-card'lara bakarak bu workerIdx için sıradaki görev numarasını hesapla.
function nextTaskNum(workerIdx: number): number {
  const sess = useSessionsStore.getState().active
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

// AgentCard parçasının ilk hali — pushAgentCard ile mesaja eklenir.
function makeInitialCard(
  workerId: string,
  w: WorkerConfig,
  taskNum: number,
): AgentCardPart {
  return {
    type: "agent-card",
    workerId,
    workerIdx: w.idx,
    taskNum,
    workerLabel: workerLabel(w, taskNum),
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

// Dispatch ana fonksiyon — parent assistant message ID'sini alır.
// Her worker için kart push'lar, paralel başlatır, eventleri patch'e dönüştürür.
export async function dispatchWorkers(
  cfg: OrchestraConfig,
  dispatches: DispatchInput[],
  parentMessageId: string,
  workspacePath: string | undefined,
  parentSignal?: AbortSignal,
): Promise<WorkerDispatchResult[]> {
  const store = useSessionsStore.getState()
  const logBuffer = cfg.logBufferLines ?? 200

  // Yeni top-level abort — parent stream abort'ı bağla
  const ac = new AbortController()
  if (parentSignal) {
    if (parentSignal.aborted) ac.abort()
    else parentSignal.addEventListener("abort", () => ac.abort(), { once: true })
  }
  currentAbortController = ac

  const runs: Promise<WorkerDispatchResult>[] = []

  for (const d of dispatches) {
    const w = cfg.workers.find((x) => x.idx === d.workerIdx)
    if (!w) {
      // Geçersiz indeks — UI'da kart açma; tool sonucuna error doldur
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

    const workerId = crypto.randomUUID()
    const taskNum = nextTaskNum(w.idx)
    const card = makeInitialCard(workerId, w, taskNum)
    store.pushAgentCard(parentMessageId, card)

    // Event → patch dönüştürücü
    const emit = (ev: WorkerEvent) => {
      const cur = useSessionsStore.getState()
      switch (ev.type) {
        case "started":
          cur.patchAgentCard(parentMessageId, workerId, {
            status: "running",
            startedAt: Date.now(),
          })
          break
        case "log":
          cur.appendAgentCardLog(parentMessageId, workerId, ev.line, logBuffer)
          break
        case "text-delta":
          cur.appendAgentCardLog(parentMessageId, workerId, ev.delta, logBuffer)
          break
        case "tool-call": {
          const tc: AgentCardToolCall = { name: ev.name, status: "running" }
          const sess = useSessionsStore.getState().active
          const msg = sess?.messages.find((m) => m.id === parentMessageId)
          const part = msg?.parts?.find(
            (p) => p.type === "agent-card" && p.workerId === workerId,
          ) as AgentCardPart | undefined
          const next = [...(part?.toolCalls ?? []), tc]
          cur.patchAgentCard(parentMessageId, workerId, { toolCalls: next })
          break
        }
        case "tool-result": {
          const sess = useSessionsStore.getState().active
          const msg = sess?.messages.find((m) => m.id === parentMessageId)
          const part = msg?.parts?.find(
            (p) => p.type === "agent-card" && p.workerId === workerId,
          ) as AgentCardPart | undefined
          if (!part?.toolCalls) break
          // Son aynı isimli "running" çağrıyı done/error olarak işaretle
          const next = part.toolCalls.slice()
          for (let i = next.length - 1; i >= 0; i--) {
            if (next[i].name === ev.name && next[i].status === "running") {
              next[i] = { ...next[i], status: ev.isError ? "error" : "done" }
              break
            }
          }
          cur.patchAgentCard(parentMessageId, workerId, { toolCalls: next })
          break
        }
        case "waiting-approval":
          cur.patchAgentCard(parentMessageId, workerId, { status: "waiting-approval" })
          break
        case "usage":
          cur.patchAgentCard(parentMessageId, workerId, {
            tokensIn: ev.tokensIn,
            tokensOut: ev.tokensOut,
          })
          break
        case "complete":
          cur.patchAgentCard(parentMessageId, workerId, {
            status: "done",
            finishedAt: Date.now(),
            finalText: ev.text,
          })
          break
        case "error":
          cur.patchAgentCard(parentMessageId, workerId, {
            status: "error",
            finishedAt: Date.now(),
            errorMessage: ev.message,
          })
          break
        case "aborted":
          cur.patchAgentCard(parentMessageId, workerId, {
            status: "aborted",
            finishedAt: Date.now(),
          })
          break
      }
    }

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

    const startPromise = runner({
      workerId,
      config: w,
      task: d.task,
      workspacePath,
      emit,
      signal: ac.signal,
    })

    runs.push(
      startPromise
        .then((r) => r.done)
        .catch((e) => ({
          workerIdx: w.idx,
          workerId,
          status: "error" as const,
          output: "",
          errorMessage: e instanceof Error ? e.message : String(e),
          durationMs: 0,
        })),
    )
  }

  try {
    const results = await Promise.all(runs)
    return results
  } finally {
    if (currentAbortController === ac) currentAbortController = null
  }
}
