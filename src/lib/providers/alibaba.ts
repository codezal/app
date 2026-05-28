// Alibaba Qwen — DashScope endpoint, OpenAI-uyumlu protokol.
import { loadProviderFactory } from "./lazy-sdk"
import type { LanguageModel } from "ai"
import type { ProviderAdapter } from "./types"

const DEFAULT_BASE_URL = "https://dashscope-intl.aliyuncs.com/compatible-mode/v1"

export const alibabaAdapter: ProviderAdapter = {
  id: "alibaba",
  label: "Alibaba (Qwen)",
  authMethods: ["apiKey", "env"],
  envVars: ["DASHSCOPE_API_KEY", "ALIBABA_API_KEY"],
  npmPackage: "@ai-sdk/openai-compatible",
  defaultModel: "qwen3-coder-plus",
  fallbackModels: [
    "qwen3-coder-plus",
    "qwen3-max",
    "qwen3-235b-a22b",
    "qwen3-32b",
    "qwen2.5-coder-32b-instruct",
  ],
  recommendedModels: ["qwen3-coder-plus", "qwen3-max"],
  async buildLanguageModel({ modelId, auth, config }): Promise<LanguageModel> {
    if (auth.kind !== "apiKey") throw new Error("Alibaba: API key required")
    const factory = await loadProviderFactory("@ai-sdk/openai-compatible")
    return factory({
      name: "alibaba",
      apiKey: auth.value,
      baseURL: config?.baseURL ?? DEFAULT_BASE_URL,
      headers: config?.headers,
    })(modelId) as LanguageModel
  },
}
