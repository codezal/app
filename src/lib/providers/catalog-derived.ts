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
import type { ProvidersCatalog } from "../providers-catalog"
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
    out.push(makeAdapter(id, p.name, p.api as string, env))
  }
  return out
}

function makeAdapter(
  id: string,
  label: string,
  baseURL: string,
  envVars: string[],
): ProviderAdapter {
  return {
    id,
    label,
    authMethods: envVars.length > 0 ? ["apiKey", "env"] : ["apiKey"],
    envVars,
    npmPackage: "@ai-sdk/openai-compatible",
    requiresConfig: false,
    defaultModel: "",
    fallbackModels: [],
    async buildLanguageModel({ modelId, auth, config }): Promise<LanguageModel> {
      const apiKey = auth.kind === "apiKey" ? auth.value : "no-key"
      const factory = await loadProviderFactory("@ai-sdk/openai-compatible")
      const resolvedBase = config?.baseURL?.trim() || baseURL
      return factory({
        name: id,
        apiKey,
        baseURL: resolvedBase,
        headers: config?.headers,
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
