// DeepInfra — açık-kaynak model inference.
import { loadProviderFactory } from "./lazy-sdk"
import type { LanguageModel } from "ai"
import type { ProviderAdapter } from "./types"

export const deepInfraAdapter: ProviderAdapter = {
  id: "deepinfra",
  label: "DeepInfra",
  authMethods: ["apiKey", "env"],
  envVars: ["DEEPINFRA_API_KEY"],
  npmPackage: "@ai-sdk/deepinfra",
  defaultModel: "meta-llama/Llama-3.3-70B-Instruct",
  fallbackModels: [
    "meta-llama/Llama-3.3-70B-Instruct",
    "meta-llama/Llama-4-Maverick-17B-128E-Instruct",
    "Qwen/Qwen3-235B-A22B",
    "deepseek-ai/DeepSeek-V3.1",
    "mistralai/Mistral-Small-3.1-24B-Instruct-2503",
  ],
  recommendedModels: [
    "meta-llama/Llama-3.3-70B-Instruct",
    "deepseek-ai/DeepSeek-V3.1",
  ],
  async buildLanguageModel({ modelId, auth, config }): Promise<LanguageModel> {
    if (auth.kind !== "apiKey") throw new Error("DeepInfra: API key required")
    const factory = await loadProviderFactory("@ai-sdk/deepinfra")
    return factory({
      apiKey: auth.value,
      baseURL: config?.baseURL,
      headers: config?.headers,
    })(modelId) as LanguageModel
  },
}
