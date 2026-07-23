import type { LanguageModel } from "ai"
import { modelsForProvider, type ProvidersCatalog } from "../providers-catalog"
import { deriveCatalogProviders } from "./catalog-derived"
import { deriveCustomProviders } from "./custom-derived"
import { openaiAdapter } from "./openai"
import { anthropicAdapter } from "./anthropic"
import { googleAdapter } from "./google"
import { deepseekAdapter } from "./deepseek"
import { openrouterAdapter } from "./openrouter"
import { groqAdapter } from "./groq"
import { mistralAdapter } from "./mistral"
import { xaiAdapter } from "./xai"
import { perplexityAdapter } from "./perplexity"
import { cohereAdapter } from "./cohere"
import { cerebrasAdapter } from "./cerebras"
import { togetherAiAdapter } from "./togetherai"
import { deepInfraAdapter } from "./deepinfra"
import { openaiCompatibleAdapter } from "./openai-compatible"
import { githubCopilotAdapter } from "./github-copilot"
import { amazonBedrockAdapter } from "./amazon-bedrock"
import { azureAdapter } from "./azure"
import { googleVertexAdapter } from "./google-vertex"
import { vercelAdapter } from "./vercel"
import { alibabaAdapter } from "./alibaba"
import { localAdapter } from "./local"
import { mlxAdapter } from "./mlx"
import type {
  ApiKeys,
  CustomProvider,
  LegacyProviderAdapter,
  ProviderAdapter,
  ProviderConfig,
  ProviderId,
  ProviderInfo,
  ProviderSpec,
  ResolvedAuth,
} from "./types"
import { resolveAuth } from "./auth"
import type { Settings } from "@/store/types"

const BUILTIN: ProviderAdapter[] = [
  openaiAdapter,
  anthropicAdapter,
  googleAdapter,
  deepseekAdapter,
  openrouterAdapter,
  groqAdapter,
  mistralAdapter,
  xaiAdapter,
  perplexityAdapter,
  cohereAdapter,
  cerebrasAdapter,
  togetherAiAdapter,
  deepInfraAdapter,
  openaiCompatibleAdapter,
  githubCopilotAdapter,
  amazonBedrockAdapter,
  azureAdapter,
  googleVertexAdapter,
  vercelAdapter,
  alibabaAdapter,
  localAdapter,
  mlxAdapter,
]

const pluginAdapters: ProviderAdapter[] = []

let customAdapters: ProviderAdapter[] = []

export function _syncCustomProviders(list: CustomProvider[] | undefined): void {
  customAdapters = deriveCustomProviders(list)
}

// Registry — built-in + plugin + custom + (optional) catalog-derived.
// Catalog-derived adapters are synthesized for every models.dev provider
// we don't ship a first-class adapter for. Built-in / plugin / custom ids shadow
// catalog entries with the same id so SDK-specific features win.
export function listProviderAdapters(catalog?: ProvidersCatalog): ProviderAdapter[] {
  const fixed = [...BUILTIN, ...pluginAdapters, ...customAdapters]
  if (!catalog) return fixed
  const fixedIds = new Set(fixed.map((p) => p.id))
  const derived = deriveCatalogProviders(catalog).filter((p) => !fixedIds.has(p.id))
  return [...fixed, ...derived]
}

export function getProviderAdapter(
  id: ProviderId,
  catalog?: ProvidersCatalog,
): ProviderAdapter | undefined {
  return listProviderAdapters(catalog).find((p) => p.id === id)
}

export function _registerPluginProvider(p: ProviderAdapter | LegacyProviderAdapter): void {
  const adapter = isLegacyAdapter(p) ? wrapLegacy(p) : p
  const idx = pluginAdapters.findIndex((x) => x.id === adapter.id)
  if (idx >= 0) pluginAdapters.splice(idx, 1, adapter)
  else pluginAdapters.push(adapter)
}

export function _unregisterPluginProvider(id: ProviderId): void {
  const idx = pluginAdapters.findIndex((p) => p.id === id)
  if (idx >= 0) pluginAdapters.splice(idx, 1)
}

export function _unregisterPluginProvidersByPlugin(pluginId: string): void {
  for (let i = pluginAdapters.length - 1; i >= 0; i--) {
    if (pluginAdapters[i].pluginId === pluginId) {
      pluginAdapters.splice(i, 1)
    }
  }
}

// Legacy → new shape wrapper.
function isLegacyAdapter(p: ProviderAdapter | LegacyProviderAdapter): p is LegacyProviderAdapter {
  return "buildModel" in p && typeof (p as LegacyProviderAdapter).buildModel === "function"
}

function wrapLegacy(legacy: LegacyProviderAdapter): ProviderAdapter {
  return {
    id: legacy.id,
    label: legacy.label,
    authMethods: ["apiKey"],
    envVars: [],
    defaultModel: legacy.defaultModel,
    fallbackModels: legacy.fallbackModels,
    pluginId: legacy.pluginId,
    buildLanguageModel({ modelId, auth }) {
      if (auth.kind !== "apiKey") {
        throw new Error(`${legacy.label}: API key required`)
      }
      return legacy.buildModel(modelId, auth.value)
    },
  }
}

// Geriye uyumluluk: PROVIDERS map'i.
export const PROVIDERS: Record<ProviderId, ProviderSpec> = Object.fromEntries(
  BUILTIN.map((a) => [
    a.id,
    {
      id: a.id,
      label: a.label,
      models: a.fallbackModels,
      defaultModel: a.defaultModel,
    },
  ]),
) as Record<ProviderId, ProviderSpec>

// modelStatus settings'i pas ediliyorsa disabled modeller filtrelenir.
export function modelsFor(
  providerId: ProviderId,
  catalog?: ProvidersCatalog,
  modelStatus?: Settings["modelStatus"],
): string[] {
  const raw = (() => {
    if (catalog) {
      const fromCatalog = modelsForProvider(catalog, providerId)
      if (fromCatalog.length > 0) return fromCatalog
    }
    const a = getProviderAdapter(providerId)
    return a?.fallbackModels ?? []
  })()
  const status = modelStatus?.[providerId]
  if (!status) return raw
  const filtered = raw.filter((m) => status[m] !== false)
  return filtered.length > 0 ? filtered : raw
}

export function defaultModelFor(providerId: ProviderId, catalog?: ProvidersCatalog): string {
  const list = modelsFor(providerId, catalog)
  const a = getProviderAdapter(providerId)
  const hardDefault = a?.defaultModel ?? list[0] ?? ""
  if (list.includes(hardDefault)) return hardDefault
  return list[0] ?? hardDefault
}

// ----- New API: buildLanguageModel ---------------------------------------

// Settings-aware factory — auth chain + provider config birlikte.
export async function buildLanguageModel(args: {
  providerId: ProviderId
  modelId: string
  settings: Settings
}): Promise<LanguageModel> {
  const catalog = args.settings.providerCatalog?.data as ProvidersCatalog | undefined
  const adapter = getProviderAdapter(args.providerId, catalog)
  if (!adapter) throw new Error(`Provider not found: ${args.providerId}`)
  const auth = await resolveAuth(adapter, args.settings)
  if (auth.kind === "none" && !adapter.custom && !adapter.keyless) {
    throw new Error(`${adapter.label}: no credentials`)
  }
  const config = args.settings.providerConfigs?.[args.providerId]
  return await adapter.buildLanguageModel({ modelId: args.modelId, auth, config })
}

// ----- Backward-compat: buildModel(provider, model, apiKeys) -------------

export function buildModel(
  providerId: ProviderId,
  modelId: string,
  apiKeys: ApiKeys,
): LanguageModel {
  const adapter = getProviderAdapter(providerId)
  if (!adapter) throw new Error(`Provider not found: ${providerId}`)
  const key = apiKeys[providerId]
  if (!key) throw new Error(`${adapter.label}: API key missing`)
  const auth: ResolvedAuth = { kind: "apiKey", value: key, source: "user" }
  const m = adapter.buildLanguageModel({ modelId, auth })
  if (m instanceof Promise) {
    throw new Error(
      `${adapter.label}: requires async buildLanguageModel. Use buildLanguageModel().`,
    )
  }
  return m
}

export type {
  ApiKeys,
  ProviderAdapter,
  ProviderId,
  ProviderSpec,
  ProviderInfo,
  ProviderConfig,
  ResolvedAuth,
}
export type {
  OAuthCredential,
  AuthMethod,
  LegacyProviderAdapter,
  ReasoningEffort,
  CustomProvider,
  CustomProviderModel,
} from "./types"

// Transform + error layer — message/option tweaks and provider error parsing.
export {
  transformHistory,
  normalizeMessages,
  applyCaching,
  reasoningOptions,
  reasoningEfforts,
  defaultReasoningEffort,
  resolveReasoningEffort,
  buildProviderOptions,
  maxOutputTokens,
  sanitizeToolSchema,
  withSchemaSanitize,
  sanitizeSurrogates,
} from "./transform"
export { parseAPICallError, parseStreamError, isContextOverflow, isOverflow, isAuthErrorMessage, isRetryableError, isContentFilterError, retryDelayMs, stallRetryDelayMs } from "./error"
export type { ParsedError } from "./error"

export { probeModels, LOCAL_PRESETS } from "./discovery"
export type { LocalPreset } from "./discovery"

// Local in-process provider (llama.cpp via localLlmFetch — no TCP server).
export { _syncLocalModels, refreshLocalModels } from "./local"
