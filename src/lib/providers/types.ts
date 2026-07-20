import type { LanguageModel } from "ai"
import type { ProvidersCatalog } from "../providers-catalog"

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
  | "mlx"
  | "alibaba"
export type ProviderId = BuiltinProviderId | (string & { _brand?: "ProviderId" })

export type ApiKeys = Partial<Record<string, string>>

// ----- Auth chain --------------------------------------------------------

//   1. UI'da girilen apiKey (settings.apiKeys[providerId])
//   2. Env var (settings.envFallback enabled ise)
//   3. OAuth token (settings.credentials[providerId].oauth)
export type AuthMethod = "apiKey" | "env" | "oauth"

export type ReasoningEffort = "off" | "low" | "medium" | "high" | "max"

export type ResolvedAuth =
  | { kind: "apiKey"; value: string; source: "user" | "env" }
  | { kind: "oauth"; accessToken: string; refreshToken?: string; expiresAt?: number }
  | { kind: "none" }

export type ProviderConfig = {
  baseURL?: string
  headers?: Record<string, string>
  options?: Record<string, unknown>
}

export type CustomProviderModel = {
  id: string
  name?: string
  contextWindow?: number
}

export type CustomProvider = {
  id: string
  name: string
  // OpenAI-compatible base URL (zorunlu).
  baseURL: string
  models: CustomProviderModel[]
  headers?: Record<string, string>
}

export type OAuthCredential = {
  accessToken: string
  refreshToken?: string
  expiresAt?: number // unix ms
  meta?: Record<string, string>
}

// ----- Provider info -----------------------------------------------------

export interface ProviderInfo {
  id: ProviderId
  label: string
  popular?: boolean
  authMethods: AuthMethod[]
  envVars: string[]
  npmPackage?: string
  oauthName?: string
  requiresConfig?: boolean
  // Built-in provider that works without credentials (local runtimes).
  keyless?: boolean
  defaultModel: string
  fallbackModels: string[]
  recommendedModels?: string[]
  // Plugin-registered ise pluginId stamplenir, unload'da temizlenir.
  pluginId?: string
  custom?: boolean
}

export interface ProviderAdapter extends ProviderInfo {
  buildLanguageModel(args: {
    modelId: string
    auth: ResolvedAuth
    config?: ProviderConfig
  }): Promise<LanguageModel> | LanguageModel
}

export interface LegacyProviderAdapter {
  id: ProviderId
  label: string
  defaultModel: string
  fallbackModels: string[]
  buildModel(modelId: string, apiKey: string): LanguageModel
  pluginId?: string
}

export type ProviderSpec = {
  id: ProviderId
  label: string
  models: string[]
  defaultModel: string
}

export type ModelsFor = (providerId: ProviderId, catalog?: ProvidersCatalog) => string[]
