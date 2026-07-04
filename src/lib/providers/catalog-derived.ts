// Catalog-derived providers — synthesize a ProviderAdapter for every
// models.dev entry that we don't ship a first-class adapter for.
//
// The 20 built-in adapters cover the popular cases (OpenAI, Anthropic,
// Google, Groq, …). Beyond that, models.dev lists ~115 additional
// providers that all expose an OpenAI-compatible endpoint. Instead of
// hardcoding each one, we generate a ProviderAdapter on the fly:
//
//   - id    = catalog.id
//   - label = catalog.name
//   - envVars = catalog.env (so the env-fallback path works)
//   - baseURL = catalog.api (prefilled into ProviderConfig at connect-time)
//   - buildLanguageModel = OpenAI-compatible lazy factory, identical to
//     the built-in openai-compatible adapter but bound to the catalog url
//
// The result is a single list that the picker UI can render: built-in
// adapters (popular tier) + catalog-derived adapters (other tier).
import type { LanguageModel } from "ai"
import { loadProviderFactory } from "./lazy-sdk"
import { tauriFetch } from "./tauri-fetch"
import { resolveQuirkHeaders, withForcedUserAgent, withQuirkBody } from "./provider-quirks"
import { withSchemaSanitize } from "./transform"
import type { ModelsDevModel, ProvidersCatalog } from "../providers-catalog"
import type { ProviderAdapter } from "./types"

// Built-in adapter ids that should NEVER be shadowed by a catalog entry.
// These take priority because they wire SDK-specific features (Anthropic
// thinking, Google safety settings, GitHub Copilot OAuth, etc.).
const BUILTIN_IDS = new Set<string>([
  "openai",
  "anthropic",
  "google",
  "deepseek",
  "openrouter",
  "groq",
  "mistral",
  "xai",
  "perplexity",
  "cohere",
  "cerebras",
  "togetherai",
  "deepinfra",
  "openai-compatible",
  "github-copilot",
  "amazon-bedrock",
  "azure",
  "google-vertex",
  "vercel",
  "alibaba",
])

// Catalog providers promoted into the connect picker's "popular" tier even
// though we ship no first-class adapter for them — coding-plan endpoints users
// frequently connect (Kimi For Coding, Z.AI Coding Plan).
const PROMOTED_POPULAR_IDS = new Set<string>(["kimi-for-coding", "zai-coding-plan"])

// Catalog entries whose `api` field is missing — they require provider-
// specific SDKs and cannot run through the generic openai-compatible path
// (e.g. amazon-bedrock, google-vertex). We drop them; built-in adapters
// already handle the supported subset.
function isRoutableViaOpenAICompatible(api: string | undefined): boolean {
  if (!api) return false
  return api.startsWith("http://") || api.startsWith("https://")
}

export function deriveCatalogProviders(
  catalog: ProvidersCatalog | undefined,
): ProviderAdapter[] {
  if (!catalog) return []
  const out: ProviderAdapter[] = []
  for (const [id, p] of Object.entries(catalog)) {
    if (BUILTIN_IDS.has(id)) continue
    if (!isRoutableViaOpenAICompatible(p.api)) continue
    const env = Array.isArray(p.env) ? p.env : []
    out.push(makeAdapter(id, p.name, p.api as string, env, p.models))
  }
  return out
}

function makeAdapter(
  id: string,
  label: string,
  baseURL: string,
  envVars: string[],
  models: Record<string, ModelsDevModel> | undefined,
): ProviderAdapter {
  return {
    id,
    label,
    popular: PROMOTED_POPULAR_IDS.has(id),
    authMethods: envVars.length > 0 ? ["apiKey", "env"] : ["apiKey"],
    envVars,
    npmPackage: "@ai-sdk/openai-compatible",
    requiresConfig: false,
    defaultModel: "",
    fallbackModels: [],
    async buildLanguageModel({ modelId, auth, config }): Promise<LanguageModel> {
      const apiKey = auth.kind === "apiKey" ? auth.value : "no-key"
      const resolvedBase = config?.baseURL?.trim() || baseURL
      // Quirk headers + UA spoof (user config wins); quirk body merged via
      // the fetch wrapper. Explicit fetch overrides the lazy-sdk default.
      const headers = await resolveQuirkHeaders(id, config?.headers)

      // Per-model wire-format override (models.dev `provider.npm`). A gateway
      // (e.g. opencode-go / zen) serves most models as openai-compatible
      // (/chat/completions) but some — Qwen/MiniMax — as ANTHROPIC format
      // (/messages, @ai-sdk/anthropic). Routing every model through
      // openai-compatible makes the gateway reject those models with
      // "Model X is not supported for format oa-compat". Mirror opencode:
      // honor the per-model npm and route Anthropic-format models accordingly.
      // The Anthropic SDK appends /messages to baseURL and sends x-api-key,
      // which is exactly what the zen anthropic endpoint expects.
      const modelNpm = models?.[modelId]?.provider?.npm
      if (modelNpm === "@ai-sdk/anthropic") {
        const anthropic = await loadProviderFactory("@ai-sdk/anthropic")
        return anthropic({
          apiKey,
          baseURL: resolvedBase,
          headers,
        })(modelId) as LanguageModel
      }

      const factory = await loadProviderFactory("@ai-sdk/openai-compatible")
      // Quirk body + (for gemini/moonshot catalog entries) tool-schema sanitize.
      // "ai-sdk/... runtime/browser" suffix'ini gated provider'da temiz
      const baseFetch = withSchemaSanitize(withQuirkBody(tauriFetch, id, modelId), id, modelId)
      return factory({
        name: id,
        apiKey,
        baseURL: resolvedBase,
        headers,
        fetch: withForcedUserAgent(baseFetch, id, headers?.["User-Agent"]),
      })(modelId) as LanguageModel
    },
  }
}

// Pre-bound baseURL/envVars lookup — used by the connect modal to prefill
// the form when the user picks a catalog-derived provider.
export function getCatalogProviderDefaults(
  catalog: ProvidersCatalog | undefined,
  id: string,
): { baseURL?: string; envVars: string[] } | null {
  if (!catalog) return null
  if (BUILTIN_IDS.has(id)) return null
  const p = catalog[id]
  if (!p || !isRoutableViaOpenAICompatible(p.api)) return null
  return { baseURL: p.api, envVars: Array.isArray(p.env) ? p.env : [] }
}
