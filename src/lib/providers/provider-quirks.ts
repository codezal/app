// Provider-specific quirks — the per-provider headers and request-body
// tweaks that real coding agents send so models behave correctly. Ported
// from OpenCode's provider/transform + provider customs.
//
// Three categories:
//   1. quirkHeaders(id)      — sync attribution / feature headers
//   2. quirkUserAgent(id)    — async UA spoof for client-gated endpoints
//   3. quirkBody(id, model)  — sync extra request-body fields
//
// Headers + UA are merged onto the request; body fields are injected by a
// fetch wrapper (withQuirkBody) since the openai-compatible SDK has no
// per-call body hook in our setup. User-supplied config always wins.
import { getClaudeCliVersion } from "./client-versions"

// Codezal's attribution identity, surfaced to gateway providers
// (OpenRouter, Vercel, etc.) that show the calling app in their dashboards.
const APP_REFERER = "https://github.com/codezal/app"
const APP_TITLE = "Codezal"

// ----- 1. Headers -------------------------------------------------------

// Provider ids that want OpenRouter-style attribution headers.
const REFERER_TITLE_PROVIDERS = new Set([
  "openrouter",
  "kilo",
  "kilocode",
  "zenmux",
  "vercel",
  "llmgateway",
  "nvidia",
])

// Sync, provider-specific headers (attribution + feature flags). Matched by
// exact id or substring where the catalog ships variants.
export function quirkHeaders(id: string): Record<string, string> {
  const h: Record<string, string> = {}

  if (REFERER_TITLE_PROVIDERS.has(id)) {
    h["HTTP-Referer"] = APP_REFERER
    h["X-Title"] = APP_TITLE
  }
  if (id === "llmgateway") h["X-Source"] = APP_TITLE
  if (id === "nvidia") h["X-BILLING-INVOKE-ORIGIN"] = APP_TITLE

  // Cerebras third-party integration tag.
  if (id === "cerebras") h["X-Cerebras-3rd-Party-Integration"] = "codezal"

  // Anthropic: interleaved thinking + fine-grained tool streaming betas.
  if (id === "anthropic") {
    h["anthropic-beta"] =
      "interleaved-thinking-2025-05-14,fine-grained-tool-streaming-2025-05-14"
  }

  return h
}

// ----- 2. User-Agent spoof for client-gated coding endpoints ------------

// Kimi For Coding (403 "only available for Coding Agents") and Z.AI / Zhipu
// Coding Plans (risk-control "SDK-based access" → ban) only serve whitelisted
// clients. Claude Code is on every whitelist and its version is on npm, so we
// send `claude-cli/<live-version>`.
const UA_GATED_PROVIDERS = new Set([
  "kimi-for-coding",
  "zai-coding-plan",
  "zhipuai-coding-plan",
])

export async function quirkUserAgent(id: string): Promise<Record<string, string>> {
  if (!UA_GATED_PROVIDERS.has(id)) return {}
  const v = await getClaudeCliVersion()
  return { "User-Agent": `claude-cli/${v}` }
}

// Bu provider'lar client-gated: UA spoof'a ek olarak request'in coding-agent
export function isCodingAgentGated(id: string): boolean {
  return UA_GATED_PROVIDERS.has(id)
}

// ----- 3. Request-body fields -------------------------------------------

// Sync, provider+model-specific extra body params. Mirrors OpenCode's
// transform.options(). Only functional tweaks (reasoning/thinking toggles,
// usage accounting) are ported; session-scoped cache keys are omitted since
// they need a sessionID we don't thread to model-build time.
export function quirkBody(id: string, modelId: string): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  const m = modelId.toLowerCase()

  // Z.AI / Zhipu GLM: only emit reasoning content when thinking is enabled.
  if (id.includes("zai") || id.includes("zhipuai")) {
    out["thinking"] = { type: "enabled", clear_thinking: false }
  }

  // Alibaba DashScope (China): reasoning models need enable_thinking to
  // return reasoning_content. kimi-k2-thinking already returns it by default.
  if (
    (id === "alibaba-cn" || id === "dashscope") &&
    !m.includes("kimi-k2-thinking")
  ) {
    out["enable_thinking"] = true
  }

  // Baseten: chat-template flag to turn on thinking for hosted OSS models.
  if (id === "baseten") {
    out["chat_template_args"] = { enable_thinking: true }
  }

  // OpenRouter: opt into usage accounting in the streamed response, and
  // request high reasoning effort for Gemini 3 models.
  if (id === "openrouter") {
    out["usage"] = { include: true }
    if (m.includes("gemini-3")) out["reasoning"] = { effort: "high" }
  }

  return out
}

// ----- 4. Inline <think> reasoning --------------------------------------

export function inlinesThinkTags(providerId: string, modelId: string): boolean {
  const p = providerId.toLowerCase()
  const m = modelId.toLowerCase()
  return p.includes("minimax") || m.includes("minimax")
}

// ----- fetch wrapper ----------------------------------------------------

// Wrap a fetch so every JSON request body gets the provider's quirk body
// merged in. Returns the base fetch untouched when there's nothing to add.
// Non-JSON or unparseable bodies pass through unmodified.
export function withQuirkBody(
  baseFetch: typeof fetch,
  id: string,
  modelId: string,
): typeof fetch {
  const extra = quirkBody(id, modelId)
  if (Object.keys(extra).length === 0) return baseFetch
  return (input, init) => {
    if (init?.body && typeof init.body === "string") {
      try {
        const parsed = JSON.parse(init.body) as Record<string, unknown>
        init = { ...init, body: JSON.stringify({ ...parsed, ...extra }) }
      } catch {
        // Leave non-JSON bodies as-is.
      }
    }
    return baseFetch(input, init)
  }
}

// AI SDK, openai-compatible/anthropic factory'lerinde giden User-Agent'a kendi
// Kimi / Z.AI / Zhipu gibi client-gated provider'lar bu "runtime/browser" +
export function withForcedUserAgent(
  baseFetch: typeof fetch,
  id: string,
  userAgent: string | undefined,
): typeof fetch {
  if (!isCodingAgentGated(id) || !userAgent) return baseFetch
  return (input, init) => {
    const headers = new Headers(init?.headers)
    headers.set("User-Agent", userAgent)
    return baseFetch(input, { ...init, headers })
  }
}

// Convenience: merge quirk headers + UA + user-supplied config headers
// (user wins). Returns undefined when there's nothing to set.
export async function resolveQuirkHeaders(
  id: string,
  userHeaders: Record<string, string> | undefined,
): Promise<Record<string, string> | undefined> {
  const ua = await quirkUserAgent(id)
  const base = { ...quirkHeaders(id), ...ua }
  const merged = { ...base, ...(userHeaders ?? {}) }
  return Object.keys(merged).length > 0 ? merged : undefined
}
