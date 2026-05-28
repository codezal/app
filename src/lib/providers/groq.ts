// Groq — düşük gecikme inference, Llama + Mixtral + Qwen barındırır.
import { loadProviderFactory } from "./lazy-sdk"
import type { LanguageModel } from "ai"
import type { ProviderAdapter } from "./types"

export const groqAdapter: ProviderAdapter = {
  id: "groq",
  label: "Groq",
  popular: true,
  authMethods: ["apiKey", "env"],
  envVars: ["GROQ_API_KEY"],
  npmPackage: "@ai-sdk/groq",
  defaultModel: "llama-3.3-70b-versatile",
  fallbackModels: [
    "llama-3.3-70b-versatile",
    "llama-3.1-8b-instant",
    "qwen-2.5-coder-32b",
    "mixtral-8x7b-32768",
    "moonshotai/kimi-k2-instruct",
  ],
  recommendedModels: ["llama-3.3-70b-versatile", "qwen-2.5-coder-32b"],
  async buildLanguageModel({ modelId, auth, config }): Promise<LanguageModel> {
    if (auth.kind !== "apiKey") throw new Error("Groq: API key required")
    const factory = await loadProviderFactory("@ai-sdk/groq")
    return factory({
      apiKey: auth.value,
      baseURL: config?.baseURL,
      headers: config?.headers,
    })(modelId) as LanguageModel
  },
}
