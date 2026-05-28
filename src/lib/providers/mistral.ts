// Mistral AI — kendi paylaşımlı endpoint ve modeller (Codestral, Mistral Large, Pixtral).
import { loadProviderFactory } from "./lazy-sdk"
import type { LanguageModel } from "ai"
import type { ProviderAdapter } from "./types"

export const mistralAdapter: ProviderAdapter = {
  id: "mistral",
  label: "Mistral",
  popular: true,
  authMethods: ["apiKey", "env"],
  envVars: ["MISTRAL_API_KEY"],
  npmPackage: "@ai-sdk/mistral",
  defaultModel: "mistral-large-latest",
  fallbackModels: [
    "mistral-large-latest",
    "mistral-small-latest",
    "codestral-latest",
    "open-mistral-nemo",
    "pixtral-large-latest",
    "magistral-medium-latest",
  ],
  recommendedModels: ["mistral-large-latest", "codestral-latest"],
  async buildLanguageModel({ modelId, auth, config }): Promise<LanguageModel> {
    if (auth.kind !== "apiKey") throw new Error("Mistral: API key required")
    const factory = await loadProviderFactory("@ai-sdk/mistral")
    return factory({
      apiKey: auth.value,
      baseURL: config?.baseURL,
      headers: config?.headers,
    })(modelId) as LanguageModel
  },
}
