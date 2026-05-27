// Claude Code CLI worker — `claude` binary subprocess'i, --print non-interactive mod.
// stream-json output parse edilir; AssistantStreamEvent şemasından text + tool çağrıları çıkarılır.
import { spawnCliWorker, shellQuote } from "../cli-protocols"
import type { RunnerStart, WorkerDispatchResult, WorkerEvent } from "../types"

// Claude Code CLI stream-json event şeması (basitleştirilmiş — sadece ihtiyacımız olan alanlar).
// Format zaman zaman değişebilir; bilinmeyen tipler ignore edilir.
type ClaudeJsonEvent =
  | {
      type: "assistant"
      message?: {
        content?: Array<
          | { type: "text"; text?: string }
          | { type: "tool_use"; id?: string; name?: string }
        >
      }
    }
  | {
      type: "user"
      message?: {
        content?: Array<{
          type: "tool_result"
          tool_use_id?: string
          is_error?: boolean
        }>
      }
    }
  | { type: "result"; result?: string; total_cost_usd?: number; usage?: { input_tokens?: number; output_tokens?: number } }
  | { type: "system"; subtype?: string }

function parseClaudeLine(line: string): WorkerEvent[] | null {
  const trimmed = line.trim()
  if (!trimmed.startsWith("{")) return null
  try {
    const ev = JSON.parse(trimmed) as ClaudeJsonEvent
    const out: WorkerEvent[] = []
    if (ev.type === "assistant" && ev.message?.content) {
      for (const c of ev.message.content) {
        if (c.type === "text" && c.text) out.push({ type: "text-delta", delta: c.text })
        else if (c.type === "tool_use" && c.name)
          out.push({ type: "tool-call", name: c.name, id: c.id })
      }
    } else if (ev.type === "user" && ev.message?.content) {
      for (const c of ev.message.content) {
        if (c.type === "tool_result")
          out.push({
            type: "tool-result",
            name: "(tool)",
            id: c.tool_use_id,
            isError: c.is_error,
          })
      }
    } else if (ev.type === "result") {
      if (ev.usage) {
        out.push({
          type: "usage",
          tokensIn: ev.usage.input_tokens,
          tokensOut: ev.usage.output_tokens,
        })
      }
    }
    return out.length > 0 ? out : []
  } catch {
    return null
  }
}

// Claude CLI sadece kendi model alias/ID'lerini kabul eder (opus/sonnet/haiku veya claude-*).
// Kullanıcı modal'da yanlış model adı girerse (örn: "deepseek-v4-pro") --model bayrağını
// atlayıp CLI'nin default'unu kullan.
function looksLikeClaudeModel(m: string | undefined): boolean {
  if (!m) return false
  const lower = m.toLowerCase()
  if (lower === "opus" || lower === "sonnet" || lower === "haiku") return true
  return lower.startsWith("claude-")
}

export const startClaudeCliWorker: RunnerStart = async ({
  workerId,
  config,
  task,
  workspacePath,
  emit,
  signal,
}) => {
  const startedAt = Date.now()

  // claude --print --output-format stream-json --verbose [--model X] [--dangerously-skip-permissions] "<task>"
  // Task echo ile stdin'e pipe'lıyoruz — positional arg quote sorunları + stdin
  // bekleme uyarısını önler.
  const flags: string[] = ["--print", "--output-format", "stream-json", "--verbose"]
  if (looksLikeClaudeModel(config.model)) {
    flags.push("--model", shellQuote(config.model!))
  }
  if (config.yolo) {
    flags.push("--dangerously-skip-permissions")
  }
  // printf %s — escape karakterleri yorumlamaz (echo -e davranış farkını önler)
  const bashLine = `printf '%s' ${shellQuote(task)} | claude ${flags.join(" ")}`

  const done = new Promise<WorkerDispatchResult>((resolve) => {
    void (async () => {
      try {
        const r = await spawnCliWorker({
          bashLine,
          workspacePath,
          task,
          signal,
          emit,
          parseLine: parseClaudeLine,
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
          const msg = `claude CLI exit ${r.exitCode}`
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
