// Native MLX bridge fetch — OpenAI-compatible chat body in, Tauri events out.
// No external CLI/server: Rust loads the bundled Swift MLX dylib and streams chunks.
import { invoke } from "@tauri-apps/api/core"
import { createId } from "@/lib/id"
import { bufferedListen } from "@/lib/tauri-events"

type MlxChatEvent =
  | { kind: "oai_delta"; json: string }
  | {
      kind: "done"
      finish_reason?: string
      model?: string
      tokens_per_sec?: number
      tokens?: number
      ttft_ms?: number
    }
  | { kind: "notice"; message: string; model?: string }
  | { kind: "error"; message: string }

type FetchLike = typeof fetch
const MLX_STREAM_IDLE_TIMEOUT_MS = 180_000

function urlOf(input: Parameters<FetchLike>[0]): string {
  if (typeof input === "string") return input
  if (input instanceof URL) return input.href
  return (input as Request).url
}

export const mlxFetch: FetchLike = (async (input, init) => {
  const url = urlOf(input)
  if (!url.includes("/chat/completions")) {
    return new Response(JSON.stringify({ error: { message: `mlx: unsupported ${url}` } }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    })
  }

  const bodyStr =
    typeof init?.body === "string"
      ? init.body
      : init?.body
        ? new TextDecoder().decode(init.body as ArrayBuffer)
        : "{}"

  let reqModel = ""
  try {
    reqModel = (JSON.parse(bodyStr) as { model?: string }).model ?? ""
  } catch {
    /* ignore malformed body here; Rust/Swift bridge will report it */
  }
  const { useLocalRuntimeStore } = await import("@/store/local-runtime")
  const genId = createId("llm")
  const chat = await bufferedListen<MlxChatEvent>(`mlx:chat:${genId}`)
  const enc = new TextEncoder()
  const created = Math.floor(Date.now() / 1000)
  const frame = (delta: Record<string, unknown>, finish: string | null) =>
    enc.encode(
      `data: ${JSON.stringify({
        id: genId,
        object: "chat.completion.chunk",
        created,
        model: "mlx",
        choices: [{ index: 0, delta, finish_reason: finish }],
      })}\n\n`,
    )
  const cancelGeneration = () => {
    void invoke("mlx_cancel", { args: { genId } }).catch(() => {})
  }
  let cleanupStream = () => {
    chat.dispose()
  }

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const signal = init?.signal
      let disposed = false
      let idleTimer: ReturnType<typeof setTimeout> | undefined
      const cancelIdleTimer = () => {
        if (idleTimer) {
          clearTimeout(idleTimer)
          idleTimer = undefined
        }
      }
      const cleanup = () => {
        if (!disposed) {
          disposed = true
          cancelIdleTimer()
          signal?.removeEventListener("abort", abortGeneration)
          chat.dispose()
        }
      }
      const fail = (error: Error) => {
        if (disposed) return
        cleanup()
        controller.error(error)
      }
      const refreshIdleTimer = () => {
        if (disposed) return
        cancelIdleTimer()
        idleTimer = setTimeout(() => {
          cancelGeneration()
          fail(new Error("MLX stream timed out"))
        }, MLX_STREAM_IDLE_TIMEOUT_MS)
      }
      const abortGeneration = () => {
        cancelGeneration()
        fail(new Error("MLX stream aborted"))
      }
      cleanupStream = cleanup
      refreshIdleTimer()
      controller.enqueue(frame({ role: "assistant" }, null))
      chat.attach((ev) => {
        refreshIdleTimer()
        if (ev.kind === "oai_delta") {
          let delta: Record<string, unknown>
          try {
            delta = JSON.parse(ev.json) as Record<string, unknown>
          } catch {
            return
          }
          controller.enqueue(frame(delta, null))
        } else if (ev.kind === "done") {
          const statsModel = reqModel || ev.model || "mlx"
          if (ev.tokens_per_sec) {
            console.log(`[mlx] ⚡ ${ev.tokens_per_sec.toFixed(1)} tok/s`)
            useLocalRuntimeStore.getState().setTokPerSec(statsModel, ev.tokens_per_sec)
          }
          if (ev.tokens_per_sec || ev.tokens) {
            useLocalRuntimeStore.getState().setLastStats({
              model: statsModel,
              tokPerSec: ev.tokens_per_sec ?? 0,
              tokens: ev.tokens ?? 0,
              ttftMs: ev.ttft_ms ?? 0,
            })
          }
          controller.enqueue(frame({}, ev.finish_reason || "stop"))
          controller.enqueue(enc.encode("data: [DONE]\n\n"))
          cleanup()
          controller.close()
        } else if (ev.kind === "notice") {
          console.log(`[mlx] ${ev.message}`)
        } else {
          fail(new Error(ev.message))
        }
      })
      void invoke("mlx_chat", {
        args: {
          genId,
          request: bodyStr,
        },
      }).catch((e: unknown) => {
        fail(e instanceof Error ? e : new Error(String(e)))
      })
      signal?.addEventListener("abort", abortGeneration)
      if (signal?.aborted) abortGeneration()
    },
    cancel() {
      cancelGeneration()
      cleanupStream()
    },
  })

  return new Response(stream, {
    status: 200,
    headers: { "Content-Type": "text/event-stream; charset=utf-8" },
  })
}) as FetchLike
