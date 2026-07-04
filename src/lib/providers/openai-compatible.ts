import { loadProviderFactory } from "./lazy-sdk"
import type { LanguageModel } from "ai"
import type { ProviderAdapter, ProviderId } from "./types"
import { tauriFetch } from "./tauri-fetch"
import { withSchemaSanitize } from "./transform"

export const openaiCompatibleAdapter: ProviderAdapter = {
  id: "openai-compatible",
  label: "OpenAI-Compatible",
  authMethods: ["apiKey", "env"],
  envVars: ["OPENAI_COMPATIBLE_API_KEY"],
  npmPackage: "@ai-sdk/openai-compatible",
  requiresConfig: true,
  defaultModel: "gpt-4",
  fallbackModels: [],
  async buildLanguageModel({ modelId, auth, config }): Promise<LanguageModel> {
    const baseURL = config?.baseURL
    if (!baseURL) throw new Error("OpenAI-Compatible: baseURL required")
    const apiKey = auth.kind === "apiKey" ? auth.value : "no-key"
    const factory = await loadProviderFactory("@ai-sdk/openai-compatible")
    const providerName = String(config?.options?.providerName ?? "openai-compatible")
    // Moonshot/Kimi endpoints reject $ref-sibling / tuple-items tool schemas —
    // sanitize the body. No-op (tauriFetch passthrough) for other endpoints.
    return factory({
      name: providerName,
      apiKey,
      baseURL,
      headers: config?.headers,
      fetch: withSchemaSanitize(tauriFetch, providerName as ProviderId, modelId),
    })(modelId) as LanguageModel
  },
}
