// Codex CLI worker — OpenAI codex binary, `exec` subkomut + --json stream.
// JSON event şeması Codex CLI'nin kendine özgü; bilinmeyen alanlar ignore.
import { spawnCliWorker, shellQuote } from "../cli-protocols"
import type { RunnerStart, WorkerDispatchResult, WorkerEvent } from "../types"

// Codex CLI event şeması — kabul edilen tipler (bilinmeyenler atlanır)
type CodexJsonEvent = {
  type?: string
  // assistant_message / tool_use varyantları
  content?: string
  text?: string
  name?: string
  id?: string
  is_error?: boolean
  // usage özetleri
  input_tokens?: number
  output_tokens?: number
}

function parseCodexLine(line: string): WorkerEvent[] | null {
  const trimmed = line.trim()
  if (!trimmed.startsWith("{")) return null
  try {
    const ev = JSON.parse(trimmed) as CodexJsonEvent
    const out: WorkerEvent[] = []
    const t = ev.type ?? ""
    if (t.includes("text") || t.includes("message")) {
      const txt = ev.text ?? ev.content
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
    } else if (t === "usage" || t === "result") {
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

export const startCodexCliWorker: RunnerStart = async ({
  workerId,
  config,
  task,
  workspacePath,
  emit,
  signal,
}) => {
  const startedAt = Date.now()

  // codex exec --json [-m X] [--sandbox ...] [--skip-git-repo-check] -
  // `-` sentinel ile stdin'den prompt oku (positional arg quote sorunlarını önler).
  // --full-auto deprecated; YOLO için --sandbox workspace-write kullan.
  // CLI'nın model param adı `-m` veya `--model` — model değeri Codex'in tanıdığı bir ad
  // olmazsa CLI hata verir; bu yüzden sadece "gpt-" / "o3"/ "o4" gibi prefix'lerde gönder.
  const flags: string[] = ["exec", "--json", "--skip-git-repo-check"]
  if (config.model && /^(gpt-|o\d|codex-)/i.test(config.model)) {
    flags.push("-m", shellQuote(config.model))
  }
  if (config.yolo) {
    flags.push("--sandbox", "workspace-write")
  } else {
    flags.push("--sandbox", "read-only")
  }
  flags.push("-")
  const bashLine = `printf '%s' ${shellQuote(task)} | codex ${flags.join(" ")}`

  const done = new Promise<WorkerDispatchResult>((resolve) => {
    void (async () => {
      try {
        const r = await spawnCliWorker({
          bashLine,
          workspacePath,
          task,
          signal,
          emit,
          parseLine: parseCodexLine,
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
          const msg = `codex CLI exit ${r.exitCode}`
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
