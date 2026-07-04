// Perplexity — web grounded search modelleri.
import { loadProviderFactory } from "./lazy-sdk"
import type { LanguageModel } from "ai"
import type { ProviderAdapter } from "./types"

export const perplexityAdapter: ProviderAdapter = {
  id: "perplexity",
  label: "Perplexity",
  authMethods: ["apiKey", "env"],
  envVars: ["PERPLEXITY_API_KEY"],
  npmPackage: "@ai-sdk/perplexity",
  defaultModel: "sonar-pro",
  fallbackModels: ["sonar-pro", "sonar", "sonar-reasoning", "sonar-reasoning-pro", "sonar-deep-research"],
  recommendedModels: ["sonar-pro", "sonar-reasoning-pro"],
  async buildLanguageModel({ modelId, auth, config }): Promise<LanguageModel> {
    if (auth.kind !== "apiKey") throw new Error("Perplexity: API key required")
    const factory = await loadProviderFactory("@ai-sdk/perplexity")
    return factory({
      apiKey: auth.value,
      baseURL: config?.baseURL,
      headers: config?.headers,
    })(modelId) as LanguageModel
  },
}
