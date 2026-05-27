// Provider registry — built-in + plugin adapter'larını birleştirir.
// buildModel/listProviders/modelsFor mevcut public API olarak korunur.
// Plugin sistemi runtime'da _registerPluginProvider() üzerinden yeni adapter ekler.
import type { LanguageModel } from "ai"
import { modelsForProvider, type ProvidersCatalog } from "../providers-catalog"
import { openaiAdapter } from "./openai"
import { anthropicAdapter } from "./anthropic"
import { googleAdapter } from "./google"
import { deepseekAdapter } from "./deepseek"
import type { ApiKeys, ProviderAdapter, ProviderId, ProviderSpec } from "./types"

const BUILTIN: ProviderAdapter[] = [
  openaiAdapter,
  anthropicAdapter,
  googleAdapter,
  deepseekAdapter,
]

const pluginAdapters: ProviderAdapter[] = []

// Registry — built-in + plugin
export function listProviderAdapters(): ProviderAdapter[] {
  return [...BUILTIN, ...pluginAdapters]
}

export function getProviderAdapter(id: ProviderId): ProviderAdapter | undefined {
  return listProviderAdapters().find((p) => p.id === id)
}

// Plugin sistemi tarafından çağrılır — provider plugin'i runtime'da register eder.
// Aynı id tekrar register edilirse silent override (Faz 3'te policy belirlenir).
export function _registerPluginProvider(p: ProviderAdapter): void {
  const idx = pluginAdapters.findIndex((x) => x.id === p.id)
  if (idx >= 0) pluginAdapters.splice(idx, 1, p)
  else pluginAdapters.push(p)
}

export function _unregisterPluginProvider(id: ProviderId): void {
  const idx = pluginAdapters.findIndex((p) => p.id === id)
  if (idx >= 0) pluginAdapters.splice(idx, 1)
}

// Geriye uyumluluk: PROVIDERS map'i — UI bazı yerlerde bunu okur.
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

// Runtime katalog varsa onun modellerini, yoksa fallback dön.
export function modelsFor(providerId: ProviderId, catalog?: ProvidersCatalog): string[] {
  if (catalog) {
    const fromCatalog = modelsForProvider(catalog, providerId)
    if (fromCatalog.length > 0) return fromCatalog
  }
  const a = getProviderAdapter(providerId)
  return a?.fallbackModels ?? []
}

// Default model — katalog varsa hardcoded default'u listede tercih et, yoksa ilk model.
export function defaultModelFor(providerId: ProviderId, catalog?: ProvidersCatalog): string {
  const list = modelsFor(providerId, catalog)
  const a = getProviderAdapter(providerId)
  const hardDefault = a?.defaultModel ?? list[0] ?? ""
  if (list.includes(hardDefault)) return hardDefault
  return list[0] ?? hardDefault
}

// Provider + model + apiKey → LanguageModel
export function buildModel(
  providerId: ProviderId,
  modelId: string,
  apiKeys: ApiKeys,
): LanguageModel {
  const adapter = getProviderAdapter(providerId)
  if (!adapter) throw new Error(`Provider yok: ${providerId}`)
  const key = apiKeys[providerId]
  if (!key) throw new Error(`${adapter.label} API key yok`)
  return adapter.buildModel(modelId, key)
}

export type { ApiKeys, ProviderAdapter, ProviderId, ProviderSpec }
