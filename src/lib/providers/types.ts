// Provider adapter contract — her LLM provider'ı bu interface'i export eder.
// providers/index.ts registry pattern ile listeler. Plugin sistemi runtime'da
// _registerPluginProvider() üzerinden yeni adapter ekleyebilir (Faz 3).
import type { LanguageModel } from "ai"
import type { ProvidersCatalog } from "../providers-catalog"

export type ProviderId = "openai" | "anthropic" | "google" | "deepseek"

export type ApiKeys = Partial<Record<ProviderId, string>>

// Tek provider tanımı — registry ve UI bunu kullanır.
export interface ProviderAdapter {
  id: ProviderId
  label: string
  // Offline fallback model listesi — models.dev erişilemediğinde gösterilir.
  fallbackModels: string[]
  defaultModel: string
  // modelId + apiKey → LanguageModel. Throw eder eğer key boşsa.
  buildModel(modelId: string, apiKey: string): LanguageModel
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
