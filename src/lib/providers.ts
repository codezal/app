import { createOpenAI } from "@ai-sdk/openai"
import { createAnthropic } from "@ai-sdk/anthropic"
import { createGoogleGenerativeAI } from "@ai-sdk/google"
import { createDeepSeek } from "@ai-sdk/deepseek"
import type { LanguageModel } from "ai"
import { modelsForProvider, type ProvidersCatalog } from "./providers-catalog"

export type ProviderId = "openai" | "anthropic" | "google" | "deepseek"

export type ProviderSpec = {
  id: ProviderId
  label: string
  models: string[]
  defaultModel: string
}

// Offline fallback — models.dev erişilemediğinde kullanılır.
// İlk açılış + cache yoksa burada listelenen modeller görünür.
export const PROVIDERS: Record<ProviderId, ProviderSpec> = {
  openai: {
    id: "openai",
    label: "OpenAI",
    models: [
      "gpt-5.5",
      "gpt-5.5-pro",
      "gpt-5.4",
      "gpt-5.4-mini",
      "gpt-5.4-nano",
      "gpt-5.3-codex",
      "gpt-5.2-codex",
      "o4-mini",
    ],
    defaultModel: "gpt-5.4-mini",
  },
  anthropic: {
    id: "anthropic",
    label: "Anthropic",
    models: [
      "claude-opus-4-7",
      "claude-sonnet-4-6",
      "claude-haiku-4-5",
    ],
    defaultModel: "claude-sonnet-4-6",
  },
  google: {
    id: "google",
    label: "Google",
    models: [
      "gemini-3.1-pro",
      "gemini-3.5-flash",
      "gemini-3.1-flash-lite",
      "gemini-2.5-pro",
      "gemini-2.5-flash",
    ],
    defaultModel: "gemini-3.5-flash",
  },
  deepseek: {
    id: "deepseek",
    label: "DeepSeek",
    models: ["deepseek-v4-pro", "deepseek-v4-flash"],
    defaultModel: "deepseek-v4-flash",
  },
}

export type ApiKeys = Partial<Record<ProviderId, string>>

// Runtime'da katalog (models.dev) varsa onun modellerini, yoksa hardcoded PROVIDERS modellerini dön.
// UI dropdown bu fonksiyonu kullanır — provider değiştirince taze liste gelir.
export function modelsFor(providerId: ProviderId, catalog?: ProvidersCatalog): string[] {
  if (catalog) {
    const fromCatalog = modelsForProvider(catalog, providerId)
    if (fromCatalog.length > 0) return fromCatalog
  }
  return PROVIDERS[providerId].models
}

// Varsayılan model — katalog varsa ilk model, yoksa hardcoded default.
export function defaultModelFor(providerId: ProviderId, catalog?: ProvidersCatalog): string {
  const list = modelsFor(providerId, catalog)
  // Hardcoded default katalog listesinde de varsa onu tercih et (kullanıcı seçimi muhtemel)
  const hardDefault = PROVIDERS[providerId].defaultModel
  if (list.includes(hardDefault)) return hardDefault
  return list[0] ?? hardDefault
}

// Provider + model → LanguageModel
export function buildModel(
  providerId: ProviderId,
  modelId: string,
  apiKeys: ApiKeys,
): LanguageModel {
  const key = apiKeys[providerId]
  if (!key) throw new Error(`${PROVIDERS[providerId].label} API key yok`)

  switch (providerId) {
    case "openai":
      return createOpenAI({ apiKey: key })(modelId)
    case "anthropic":
      return createAnthropic({ apiKey: key })(modelId)
    case "google":
      return createGoogleGenerativeAI({ apiKey: key })(modelId)
    case "deepseek":
      return createDeepSeek({ apiKey: key })(modelId)
  }
}
