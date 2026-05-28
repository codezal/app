// Provider adapter contract — her LLM provider'ı bu interface'i export eder.
// providers/index.ts registry pattern ile listeler. Plugin sistemi runtime'da
// _registerPluginProvider() üzerinden yeni adapter ekleyebilir (Faz 3).
import type { LanguageModel } from "ai"
import type { ProvidersCatalog } from "../providers-catalog"

// Built-in provider id literal type. Plugin-registered providers extend this
// at runtime via the `(string & {})` trick — autocomplete still suggests
// "openai" | "anthropic" | "google" | "deepseek", but arbitrary strings from
// plugins are also assignable.
export type BuiltinProviderId = "openai" | "anthropic" | "google" | "deepseek"
export type ProviderId = BuiltinProviderId | (string & { _brand?: "ProviderId" })

export type ApiKeys = Partial<Record<string, string>>

// Tek provider tanımı — registry ve UI bunu kullanır.
export interface ProviderAdapter {
  id: ProviderId
  label: string
  // Offline fallback model listesi — models.dev erişilemediğinde gösterilir.
  fallbackModels: string[]
  defaultModel: string
  // modelId + apiKey → LanguageModel. Throw eder eğer key boşsa.
  buildModel(modelId: string, apiKey: string): LanguageModel
  // Plugin-registered providers stamp this so unload can clean up.
  pluginId?: string
}

// Geriye uyumluluk için eski tip — UI bazı yerlerde bunu bekliyor.
export type ProviderSpec = {
  id: ProviderId
  label: string
  models: string[]
  defaultModel: string
}

// Runtime katalog varsa onun modellerini, yoksa fallbackModels'i dön.
export type ModelsFor = (providerId: ProviderId, catalog?: ProvidersCatalog) => string[]
