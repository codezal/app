// Provider type contracts — OpenCode-paritesi geniş şema.
// Eski `ProviderAdapter` shape geriye-uyumluluk için korunur; yeni kod
// `ProviderInfo` + Auth chain kullanır.
import type { LanguageModel } from "ai"
import type { ProvidersCatalog } from "../providers-catalog"

// Built-in provider id literal — registry yeni id'ler runtime'da kabul eder.
// `(string & {})` autocomplete'i korur ama herhangi bir string atanabilir.
export type BuiltinProviderId =
  | "openai"
  | "anthropic"
  | "google"
  | "deepseek"
  | "openrouter"
  | "groq"
  | "mistral"
  | "xai"
  | "perplexity"
  | "cohere"
  | "cerebras"
  | "togetherai"
  | "deepinfra"
  | "openai-compatible"
  | "github-copilot"
  | "amazon-bedrock"
  | "azure"
  | "google-vertex"
  | "vercel"
  | "alibaba"
export type ProviderId = BuiltinProviderId | (string & { _brand?: "ProviderId" })

export type ApiKeys = Partial<Record<string, string>>

// ----- Auth chain --------------------------------------------------------

// Bir provider için credential çözümleyici. Resolver sıra ile dener:
//   1. UI'da girilen apiKey (settings.apiKeys[providerId])
//   2. Env var (settings.envFallback enabled ise)
//   3. OAuth token (settings.credentials[providerId].oauth)
// İlk dolu olan döner. Hiçbiri yoksa null.
export type AuthMethod = "apiKey" | "env" | "oauth"

export type ResolvedAuth =
  | { kind: "apiKey"; value: string; source: "user" | "env" }
  | { kind: "oauth"; accessToken: string; refreshToken?: string; expiresAt?: number }
  | { kind: "none" }

// Provider config — baseURL, custom headers, openai-compatible için endpoint vs.
// settings.providerConfigs[providerId] altında saklanır.
export type ProviderConfig = {
  baseURL?: string
  headers?: Record<string, string>
  // Provider'a özel free-form options (örn azure deployment, vertex project)
  options?: Record<string, unknown>
}

// OAuth credential — token + refresh. Settings'te saklanır.
export type OAuthCredential = {
  accessToken: string
  refreshToken?: string
  expiresAt?: number // unix ms
  // Provider'a özel ek alanlar (örn copilot endpoint, scopes)
  meta?: Record<string, string>
}

// ----- Provider info -----------------------------------------------------

// Genişletilmiş provider sözleşmesi. Built-in + plugin tüm provider'lar bunu döner.
export interface ProviderInfo {
  id: ProviderId
  label: string
  // UI gruplamada kullanılır: "popular" = recommended section üstte
  popular?: boolean
  // Hangi auth metodlarını destekler. UI bağlanma akışını buna göre kurar.
  authMethods: AuthMethod[]
  // Env var isimleri — UI "Ortam" badge için kontrol eder.
  envVars: string[]
  // Lazy npm import edilecek paket adı (@ai-sdk/xxx ya da harici). Build sırasında
  // bundle'a girmez; sadece kullanıldığında dynamic import çekilir.
  npmPackage?: string
  // OAuth desteği varsa provider adı (oauth/<name>.ts dosyasındaki id).
  oauthName?: string
  // Provider config gerekiyor mu (örn openai-compatible için baseURL zorunlu)
  requiresConfig?: boolean
  // Default model id (katalogda enabled olarak işaretlenir)
  defaultModel: string
  // Offline fallback model listesi — models.dev erişilemediğinde gösterilir.
  fallbackModels: string[]
  // "Recommended" model listesi — model toggle sayfasında default-enabled olanlar.
  // Boşsa hepsi enabled kabul edilir.
  recommendedModels?: string[]
  // Plugin-registered ise pluginId stamplenir, unload'da temizlenir.
  pluginId?: string
}

// Tek provider runtime kontratı: info + LanguageModel factory.
// `buildModel` resolved auth + opsiyonel config alır → LanguageModel döner.
export interface ProviderAdapter extends ProviderInfo {
  buildLanguageModel(args: {
    modelId: string
    auth: ResolvedAuth
    config?: ProviderConfig
  }): Promise<LanguageModel> | LanguageModel
}

// Eski adapter sözleşmesi — backward-compat. Eski plugin'ler ve testler hâlâ
// bunu export ediyor. Registry içeride yeni shape'e wrap eder.
export interface LegacyProviderAdapter {
  id: ProviderId
  label: string
  defaultModel: string
  fallbackModels: string[]
  buildModel(modelId: string, apiKey: string): LanguageModel
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
