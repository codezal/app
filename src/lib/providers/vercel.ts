// Vercel AI Gateway — Vercel hosted unified API.
import { loadProviderFactory } from "./lazy-sdk"
import type { LanguageModel } from "ai"
import type { ProviderAdapter } from "./types"

export const vercelAdapter: ProviderAdapter = {
  id: "vercel",
  label: "Vercel AI Gateway",
  authMethods: ["apiKey", "env"],
  envVars: ["VERCEL_AI_GATEWAY_API_KEY"],
  npmPackage: "@ai-sdk/vercel",
  defaultModel: "v0-1.5-md",
  fallbackModels: ["v0-1.5-md", "v0-1.5-lg", "v0-1.0-md"],
  recommendedModels: ["v0-1.5-md"],
  async buildLanguageModel({ modelId, auth, config }): Promise<LanguageModel> {
    if (auth.kind !== "apiKey") throw new Error("Vercel AI Gateway: API key required")
    const factory = await loadProviderFactory("@ai-sdk/vercel")
    return factory({
      apiKey: auth.value,
      baseURL: config?.baseURL,
      headers: config?.headers,
    })(modelId) as LanguageModel
  },
}
