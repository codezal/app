// Provider error parsing — turn raw provider/SDK errors into a structured
// signal the stream loop can act on. Ported from OpenCode's provider/error.ts.
//
// Main use: detect context-window overflow across providers (each phrases it
// differently) so the app can react with auto-compaction + retry instead of
// surfacing a raw 400/413.
import { APICallError } from "ai"

// Overflow phrasings across providers. Adapted from OpenCode + pi-mono.
const OVERFLOW_PATTERNS: RegExp[] = [
  /prompt is too long/i, // Anthropic
  /input is too long for requested model/i, // Amazon Bedrock
  /exceeds the context window/i, // OpenAI
  /input token count.*exceeds the maximum/i, // Google (Gemini)
  /maximum prompt length is \d+/i, // xAI (Grok)
  /reduce the length of the messages/i, // Groq
  /maximum context length is \d+ tokens/i, // OpenRouter, DeepSeek, vLLM
  /exceeds the limit of \d+/i, // GitHub Copilot
  /exceeds the available context size/i, // llama.cpp
  /greater than the context length/i, // LM Studio
  /context window exceeds limit/i, // MiniMax
  /exceeded model token limit/i, // Kimi, Moonshot
  /context[_ ]length[_ ]exceeded/i, // generic
  /request entity too large/i, // HTTP 413
  /context length is only \d+ tokens/i, // vLLM
  /input length.*exceeds.*context length/i, // vLLM
  /prompt too long; exceeded (?:max )?context length/i, // Ollama
  /too large for model with \d+ maximum context length/i, // Mistral
  /model_context_window_exceeded/i, // z.ai
  /too long for the local context window/i, // Codezal local in-process (llm_chat)
]

const TRANSIENT_NETWORK_PATTERNS: RegExp[] = [
  /error decoding response body/i,
  /error sending request/i,
  /connection (?:closed|reset|aborted|refused)/i,
  /connection closed before message completed/i,
  /incomplete message|unexpected eof|broken pipe/i,
  /request or response body error/i,
  /(?:operation )?timed out|connection timed out/i,
  /network (?:error|is unreachable)|error trying to connect/i,
  /tcp connect error|dns error|channel closed/i,
]

// True when an error message looks like a transient network/transport failure
// (not an HTTP status error). These are retried with backoff by the stream loop.
export function isTransientNetworkError(message: string): boolean {
  return TRANSIENT_NETWORK_PATTERNS.some((p) => p.test(message))
}

// True when an error message looks like an authentication / credential failure
// (bad or missing API key, an unauthorized or expired OAuth token, 401/403).
// Drives the "open Settings to reconnect" affordance on the error banner.
const AUTH_ERROR_PATTERN =
  /invalid x-api-key|x-api-key|api[ _-]?key|unauthorized|authentication|invalid.*token|expired.*token|oauth|credential|\b401\b|\b403\b/i

export function isAuthErrorMessage(message: string): boolean {
  return AUTH_ERROR_PATTERN.test(message)
}

// True when an error message describes a context-window overflow.
export function isOverflow(message: string): boolean {
  if (OVERFLOW_PATTERNS.some((p) => p.test(message))) return true
  // Cerebras/Mistral sometimes return bare "400 (no body)" / "413 (no body)".
  return /^4(00|13)\s*(status code)?\s*\(no body\)/i.test(message)
}

function parseJson(input: unknown): Record<string, unknown> | undefined {
  if (typeof input === "string") {
    try {
      const r = JSON.parse(input)
      return r && typeof r === "object" ? (r as Record<string, unknown>) : undefined
    } catch {
      return undefined
    }
  }
  if (input && typeof input === "object") return input as Record<string, unknown>
  return undefined
}

export type ParsedError =
  | { type: "context_overflow"; message: string }
  | { type: "api_error"; message: string; statusCode?: number; isRetryable: boolean; retryAfterMs?: number }

// Extract a human-readable message from an APICallError, preferring the parsed
// response body's error field over the raw status text.
function readableMessage(e: APICallError): string {
  const msg = e.message
  if (msg === "" && e.responseBody) return e.responseBody
  const body = parseJson(e.responseBody)
  if (body) {
    const err = body.error as { message?: string } | string | undefined
    const errMsg = typeof err === "string" ? err : err?.message ?? (body.message as string | undefined)
    if (errMsg && typeof errMsg === "string" && msg && !msg.includes(errMsg)) return `${msg}: ${errMsg}`
  }
  return msg || "Unknown error"
}

// Classify an APICallError (the error type AI SDK throws for HTTP failures).
export function parseAPICallError(error: APICallError): ParsedError {
  const m = readableMessage(error)
  const body = parseJson(error.responseBody)
  const code = (body?.error as { code?: string } | undefined)?.code
  if (isOverflow(m) || error.statusCode === 413 || code === "context_length_exceeded") {
    return { type: "context_overflow", message: m }
  }
  return {
    type: "api_error",
    message: m,
    statusCode: error.statusCode,
    isRetryable: error.isRetryable,
    retryAfterMs: parseRetryAfter(error.responseHeaders),
  }
}

// Best-effort classification of ANY thrown error (stream chunk errors aren't
// always APICallError instances). Returns undefined when nothing is detectable.
export function parseStreamError(input: unknown): ParsedError | undefined {
  if (APICallError.isInstance(input)) return parseAPICallError(input)
  const msg =
    input instanceof Error
      ? input.message
      : typeof input === "string"
        ? input
        : (parseJson(input)?.message as string | undefined) ?? ""
  if (!msg) return undefined
  if (isOverflow(msg)) return { type: "context_overflow", message: msg }
  if (isTransientNetworkError(msg)) {
    return { type: "api_error", message: msg, isRetryable: true }
  }
  return undefined
}

// Convenience predicate for the catch block.
export function isContextOverflow(input: unknown): boolean {
  return parseStreamError(input)?.type === "context_overflow"
}

// ---- Transient-failure retry (adapted from OpenCode's session/retry.ts) ----
// streamText's built-in maxRetries only covers the initial connection; a
// mid-stream drop (5xx / rate-limit after the first token) is NOT retried by
// the SDK. The stream loop wraps its own retry using the helpers below.

const RETRY_INITIAL_DELAY = 2000 // ilk denemede 2s
const RETRY_BACKOFF_FACTOR = 2 // her denemede x2
const RETRY_MAX_DELAY_NO_HEADERS = 30_000 // header yoksa tavan 30s
const RETRY_MAX_DELAY_WITH_HEADER = 120_000

function parseRetryAfter(headers?: Record<string, string>): number | undefined {
  if (!headers) return undefined
  const ms = headers["retry-after-ms"]
  if (ms) {
    const parsed = Number.parseFloat(ms)
    if (!Number.isNaN(parsed)) return parsed
  }
  const ra = headers["retry-after"]
  if (ra) {
    const seconds = Number.parseFloat(ra)
    if (!Number.isNaN(seconds)) return Math.ceil(seconds * 1000)
    const dateMs = Date.parse(ra) - Date.now()
    if (!Number.isNaN(dateMs) && dateMs > 0) return Math.ceil(dateMs)
  }
  return undefined
}

export function isRetryableError(parsed: ParsedError | undefined): boolean {
  if (!parsed || parsed.type !== "api_error") return false
  const status = parsed.statusCode
  if (status !== undefined && status >= 500) return true
  if (status === 429) return true
  return parsed.isRetryable === true
}

const CONTENT_FILTER_PATTERN =
  /content[_ ]?(policy|filter|management)|moderation|safety (system|filter)|prohibited_content|responsible ai|content_filter|violat\w* (our|the|content|usage) polic/i
export function isContentFilterError(parsed: ParsedError | undefined): boolean {
  if (!parsed || parsed.type !== "api_error") return false
  const status = parsed.statusCode
  if (status !== undefined && status !== 400 && status !== 403) return false
  return CONTENT_FILTER_PATTERN.test(parsed.message)
}

export function retryDelayMs(attempt: number, retryAfterMs?: number): number {
  if (retryAfterMs !== undefined && retryAfterMs > 0) {
    return Math.min(retryAfterMs, RETRY_MAX_DELAY_WITH_HEADER)
  }
  const backoff = RETRY_INITIAL_DELAY * RETRY_BACKOFF_FACTOR ** Math.max(0, attempt - 1)
  return Math.min(backoff, RETRY_MAX_DELAY_NO_HEADERS)
}

// Stall retries need a longer runway — the network may still be recovering
// (e.g. after system sleep). Linear ramp: 5 s, 10 s, 20 s, 30 s, 30 s …
const STALL_RETRY_INITIAL = 5_000
const STALL_RETRY_MAX = 30_000

export function stallRetryDelayMs(attempt: number): number {
  const delay = STALL_RETRY_INITIAL * Math.pow(2, Math.max(0, attempt - 1))
  return Math.min(delay, STALL_RETRY_MAX)
}
