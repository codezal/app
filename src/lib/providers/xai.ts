// xAI — Grok modelleri.
import { loadProviderFactory } from "./lazy-sdk"
import type { LanguageModel } from "ai"
import type { ProviderAdapter } from "./types"

export const xaiAdapter: ProviderAdapter = {
  id: "xai",
  label: "xAI",
  popular: true,
  authMethods: ["apiKey", "env"],
  envVars: ["XAI_API_KEY"],
  npmPackage: "@ai-sdk/xai",
  defaultModel: "grok-4",
  fallbackModels: ["grok-4", "grok-4-fast", "grok-3", "grok-3-mini", "grok-code-fast-1"],
  recommendedModels: ["grok-4", "grok-code-fast-1"],
  async buildLanguageModel({ modelId, auth, config }): Promise<LanguageModel> {
    if (auth.kind !== "apiKey") throw new Error("xAI: API key required")
    const factory = await loadProviderFactory("@ai-sdk/xai")
    return factory({
      apiKey: auth.value,
      baseURL: config?.baseURL,
      headers: config?.headers,
    })(modelId) as LanguageModel
  },
}
