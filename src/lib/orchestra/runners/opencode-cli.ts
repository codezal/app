// OpenCode CLI worker — opencode.ai binary, `run` subkomutu.
// Çoğu CLI gibi JSON stream destekler; format kararsızsa parser null döner, ham stdout
// text-delta olarak akar.
import { spawnCliWorker, shellQuote } from "../cli-protocols"
import type { RunnerStart, WorkerDispatchResult, WorkerEvent } from "../types"

type OpencodeJsonEvent = {
  type?: string
  delta?: string
  text?: string
  content?: string
  name?: string
  id?: string
  is_error?: boolean
  input_tokens?: number
  output_tokens?: number
}

function parseOpencodeLine(line: string): WorkerEvent[] | null {
  const trimmed = line.trim()
  if (!trimmed.startsWith("{")) return null
  try {
    const ev = JSON.parse(trimmed) as OpencodeJsonEvent
    const out: WorkerEvent[] = []
    const t = ev.type ?? ""
    if (t.includes("delta") || t.includes("text")) {
      const txt = ev.delta ?? ev.text ?? ev.content
      if (txt) out.push({ type: "text-delta", delta: txt })
    } else if (t.includes("tool_use") || t === "tool_call") {
      if (ev.name) out.push({ type: "tool-call", name: ev.name, id: ev.id })
    } else if (t.includes("tool_result")) {
      out.push({
        type: "tool-result",
        name: ev.name ?? "(tool)",
        id: ev.id,
        isError: ev.is_error,
      })
    } else if (t === "usage") {
      if (ev.input_tokens != null || ev.output_tokens != null) {
        out.push({
          type: "usage",
          tokensIn: ev.input_tokens,
          tokensOut: ev.output_tokens,
        })
      }
    }
    return out.length > 0 ? out : []
  } catch {
    return null
  }
}

export const startOpencodeCliWorker: RunnerStart = async ({
  workerId,
  config,
  task,
  workspacePath,
  emit,
  signal,
}) => {
  const startedAt = Date.now()

  // opencode run [-m provider/model] [--format json] "<message>"
  // Yolo flag yok — non-interactive modda tüm tool izinleri otomatik onaylanır (opencode doc).
  // Model formatı "provider/model" — kullanıcı sadece model girerse provider tahmin edilemez,
  // CLI default'una bırak.
  const flags: string[] = ["run", "--format", "json"]
  if (config.model && config.model.includes("/")) {
    flags.push("-m", shellQuote(config.model))
  }
  // Mesaj positional (array). Tek bir string olarak güvenle geçir.
  const bashLine = `opencode ${flags.join(" ")} ${shellQuote(task)}`

  const done = new Promise<WorkerDispatchResult>((resolve) => {
    void (async () => {
      try {
        const r = await spawnCliWorker({
          bashLine,
          workspacePath,
          task,
          signal,
          emit,
          parseLine: parseOpencodeLine,
        })
        if (r.aborted) {
          emit({ type: "aborted" })
          resolve({
            workerIdx: config.idx,
            workerId,
            status: "aborted",
            output: r.fullText,
            durationMs: Date.now() - startedAt,
          })
          return
        }
        if (r.exitCode != null && r.exitCode !== 0) {
          const msg = `opencode CLI exit ${r.exitCode}`
          emit({ type: "error", message: msg })
          resolve({
            workerIdx: config.idx,
            workerId,
            status: "error",
            output: r.fullText,
            errorMessage: msg,
            durationMs: Date.now() - startedAt,
          })
          return
        }
        emit({ type: "complete", text: r.fullText })
        resolve({
          workerIdx: config.idx,
          workerId,
          status: "done",
          output: r.fullText || "(boş cevap)",
          durationMs: Date.now() - startedAt,
        })
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        emit({ type: "error", message: msg })
        resolve({
          workerIdx: config.idx,
          workerId,
          status: "error",
          output: "",
          errorMessage: msg,
          durationMs: Date.now() - startedAt,
        })
      }
    })()
  })

  return { done }
}
