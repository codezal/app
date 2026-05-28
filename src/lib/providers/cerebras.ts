// Cerebras — ultra-hızlı inference, Llama + Qwen barındırır.
import { loadProviderFactory } from "./lazy-sdk"
import type { LanguageModel } from "ai"
import type { ProviderAdapter } from "./types"

export const cerebrasAdapter: ProviderAdapter = {
  id: "cerebras",
  label: "Cerebras",
  authMethods: ["apiKey", "env"],
  envVars: ["CEREBRAS_API_KEY"],
  npmPackage: "@ai-sdk/cerebras",
  defaultModel: "llama-3.3-70b",
  fallbackModels: [
    "llama-3.3-70b",
    "llama3.1-8b",
    "qwen-3-32b",
    "qwen-3-coder-480b",
    "gpt-oss-120b",
  ],
  recommendedModels: ["llama-3.3-70b", "qwen-3-coder-480b"],
  async buildLanguageModel({ modelId, auth, config }): Promise<LanguageModel> {
    if (auth.kind !== "apiKey") throw new Error("Cerebras: API key required")
    const factory = await loadProviderFactory("@ai-sdk/cerebras")
    return factory({
      apiKey: auth.value,
      baseURL: config?.baseURL,
      headers: config?.headers,
    })(modelId) as LanguageModel
  },
}
