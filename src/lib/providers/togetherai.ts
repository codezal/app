// Together AI — açık-kaynak modeller (Llama, Mistral, Qwen, DeepSeek) için inference.
import { loadProviderFactory } from "./lazy-sdk"
import type { LanguageModel } from "ai"
import type { ProviderAdapter } from "./types"

export const togetherAiAdapter: ProviderAdapter = {
  id: "togetherai",
  label: "Together AI",
  authMethods: ["apiKey", "env"],
  envVars: ["TOGETHER_API_KEY"],
  npmPackage: "@ai-sdk/togetherai",
  defaultModel: "meta-llama/Llama-3.3-70B-Instruct-Turbo",
  fallbackModels: [
    "meta-llama/Llama-3.3-70B-Instruct-Turbo",
    "meta-llama/Llama-4-Maverick-17B-128E-Instruct-FP8",
    "Qwen/Qwen3-Coder-480B-A35B-Instruct-FP8",
    "deepseek-ai/DeepSeek-V3.1",
    "mistralai/Mixtral-8x22B-Instruct-v0.1",
  ],
  recommendedModels: [
    "meta-llama/Llama-3.3-70B-Instruct-Turbo",
    "Qwen/Qwen3-Coder-480B-A35B-Instruct-FP8",
  ],
  async buildLanguageModel({ modelId, auth, config }): Promise<LanguageModel> {
    if (auth.kind !== "apiKey") throw new Error("Together AI: API key required")
    const factory = await loadProviderFactory("@ai-sdk/togetherai")
    return factory({
      apiKey: auth.value,
      baseURL: config?.baseURL,
      headers: config?.headers,
    })(modelId) as LanguageModel
  },
}
