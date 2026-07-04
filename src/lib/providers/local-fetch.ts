// localLlmFetch — a fetch()-shaped bridge that makes the in-process llama worker
// look like an OpenAI /chat/completions endpoint, WITHOUT any TCP server.
//
// It invokes the Rust `llm_chat` command and frames the streamed ChatEvent items
// (`llm:chat:{genId}`) into OpenAI SSE, so @ai-sdk/openai-compatible consumes it
// unchanged — tools/transform/error handling all reuse the existing pipeline.
// The model stays in-process; the only "transport" is Tauri invoke + events.
import { invoke } from "@tauri-apps/api/core"
import { createId } from "@/lib/id"
import { bufferedListen } from "@/lib/tauri-events"
import { resolveLocalLlm } from "@/lib/local-llm"

// Mirrors the Rust `ChatEvent` enum (serde tag = "kind", snake_case).
type ChatEvent =
  | { kind: "oai_delta"; json: string }
  | { kind: "done"; finish_reason: string; tokens_per_sec?: number; tokens?: number; ttft_ms?: number }
  | { kind: "notice"; requested: number; effective: number; model: string; model_gb: number }
  | {
      kind: "model_info"
      requested_ctx: number
      effective_ctx: number
      n_train: number
      weights: number
      kv: number
      compute: number
      ram: number
    }
  | { kind: "error"; message: string }

type FetchLike = typeof fetch

function urlOf(input: Parameters<FetchLike>[0]): string {
  if (typeof input === "string") return input
  if (input instanceof URL) return input.href
  return (input as Request).url
}

export const localLlmFetch: FetchLike = (async (input, init) => {
  const url = urlOf(input)
  if (!url.includes("/chat/completions")) {
    // Only chat completions are bridged (no /models, /embeddings yet).
    return new Response(JSON.stringify({ error: { message: `local: unsupported ${url}` } }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    })
  }

  // The request body is already OpenAI-format (built by the AI SDK adapter).
  const bodyStr =
    typeof init?.body === "string"
      ? init.body
      : init?.body
        ? new TextDecoder().decode(init.body as ArrayBuffer)
        : "{}"

  const genId = createId("llm")
  // Local LLM settings (context window + flash attention) live in the settings
  // store so compaction/the fill gauge can read the SAME window (see
  // resolveContextCap). KV cache type is auto-derived from n_ctx in Rust
  // (f16 ≤32k, q8_0 ≤64k, q4_0 above) — no knob.
  // Dynamic import — local-fetch sits in the provider chain that the settings
  // store transitively imports, so a top-level import would be a circular dep
  // (undefined at module init). Call-time import sidesteps the cycle.
  const { useSettingsStore } = await import("@/store/settings")
  const settings = useSettingsStore.getState().settings
  let reqModel = ""
  try {
    reqModel = (JSON.parse(bodyStr) as { model?: string }).model ?? ""
  } catch {
    // Intentionally ignored.
  }
  const profile = resolveLocalLlm(settings, reqModel)
  const flashAttention = profile.flashAttention
  const nCtx = profile.contextWindow
  const batchSize = profile.batchSize
  const threads = profile.threads
  const batchThreads = profile.batchThreads
  const speculativeMode = profile.speculativeMode
  const draftTokens = profile.draftTokens
  const draftModel = profile.draftModel
  const { toast } = await import("@/store/toast")
  const { t } = await import("@/lib/i18n")
  const { useLocalRuntimeStore } = await import("@/store/local-runtime")
  // Register the listener BEFORE invoking — Tauri events are not buffered.
  const chat = await bufferedListen<ChatEvent>(`llm:chat:${genId}`)

  const enc = new TextEncoder()
  const created = Math.floor(Date.now() / 1000)
  const frame = (delta: Record<string, unknown>, finish: string | null) =>
    enc.encode(
      `data: ${JSON.stringify({
        id: genId,
        object: "chat.completion.chunk",
        created,
        model: "local",
        choices: [{ index: 0, delta, finish_reason: finish }],
      })}\n\n`,
    )

  const cancelGeneration = () => {
    void invoke("llm_cancel", { args: { genId } }).catch(() => {})
  }
  let cleanupStream = () => {
    chat.dispose()
  }

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const signal = init?.signal
      const removeAbortListener = signal
        ? () => signal.removeEventListener("abort", cancelGeneration)
        : undefined
      cleanupStream = () => {
        removeAbortListener?.()
        chat.dispose()
      }
      controller.enqueue(frame({ role: "assistant" }, null))
      chat.attach((ev) => {
        if (ev.kind === "oai_delta") {
          // Raw OpenAI delta object (content or tool_calls) from the Rust parser.
          let delta: Record<string, unknown>
          try {
            delta = JSON.parse(ev.json) as Record<string, unknown>
          } catch {
            return
          }
          controller.enqueue(frame(delta, null))
        } else if (ev.kind === "done") {
          if (ev.tokens_per_sec) {
            console.log(`[local] ⚡ ${ev.tokens_per_sec.toFixed(1)} tok/s`)
            useLocalRuntimeStore.getState().setTokPerSec(reqModel, ev.tokens_per_sec)
          }
          if (ev.tokens_per_sec || ev.tokens) {
            useLocalRuntimeStore.getState().setLastStats({
              model: reqModel,
              tokPerSec: ev.tokens_per_sec ?? 0,
              tokens: ev.tokens ?? 0,
              ttftMs: ev.ttft_ms ?? 0,
            })
          }
          controller.enqueue(frame({}, ev.finish_reason || "stop"))
          controller.enqueue(enc.encode("data: [DONE]\n\n"))
          cleanupStream()
          controller.close()
        } else if (ev.kind === "model_info") {
          const rt = useLocalRuntimeStore.getState()
          rt.setEffectiveCtx(reqModel, ev.effective_ctx)
          rt.setModelInfo(reqModel, {
            requestedCtx: ev.requested_ctx,
            effectiveCtx: ev.effective_ctx,
            nTrain: ev.n_train,
            weights: ev.weights,
            kv: ev.kv,
            compute: ev.compute,
            ram: ev.ram,
          })
        } else if (ev.kind === "notice") {
          useLocalRuntimeStore.getState().setEffectiveCtx(ev.model, ev.effective)
          toast.info(
            t("app.localCtxClamped", {
              model: ev.model,
              requested: String(ev.requested),
              effective: String(ev.effective),
              gb: ev.model_gb.toFixed(1),
            }),
          )
        } else {
          cleanupStream()
          controller.error(new Error(ev.message))
        }
      })
      // Composer "Stop" → streamText aborts → cancel the in-flight generation.
      signal?.addEventListener("abort", cancelGeneration)
      // Kick off generation (returns immediately; tokens arrive via events).
      void invoke("llm_chat", {
        args: {
          genId,
          request: bodyStr,
          flashAttention,
          nCtx,
          batchSize,
          threads,
          batchThreads,
          speculativeMode,
          draftTokens,
          draftModel,
        },
      }).catch((e: unknown) => {
        cleanupStream()
        controller.error(e instanceof Error ? e : new Error(String(e)))
      })
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
