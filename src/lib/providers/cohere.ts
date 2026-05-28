// Cohere — Command serisi modelleri.
import { loadProviderFactory } from "./lazy-sdk"
import type { LanguageModel } from "ai"
import type { ProviderAdapter } from "./types"

export const cohereAdapter: ProviderAdapter = {
  id: "cohere",
  label: "Cohere",
  authMethods: ["apiKey", "env"],
  envVars: ["COHERE_API_KEY"],
  npmPackage: "@ai-sdk/cohere",
  defaultModel: "command-a-03-2025",
  fallbackModels: [
    "command-a-03-2025",
    "command-r-plus-08-2024",
    "command-r-08-2024",
    "command-light",
    "c4ai-aya-expanse-32b",
  ],
  recommendedModels: ["command-a-03-2025", "command-r-plus-08-2024"],
  async buildLanguageModel({ modelId, auth, config }): Promise<LanguageModel> {
    if (auth.kind !== "apiKey") throw new Error("Cohere: API key required")
    const factory = await loadProviderFactory("@ai-sdk/cohere")
    return factory({
      apiKey: auth.value,
      baseURL: config?.baseURL,
      headers: config?.headers,
    })(modelId) as LanguageModel
  },
}
