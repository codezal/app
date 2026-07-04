// DeepSeek provider adapter — @ai-sdk/deepseek wrapper.
import { createDeepSeek } from "@ai-sdk/deepseek"
import type { ProviderAdapter } from "./types"
import { tauriFetch } from "./tauri-fetch"

export const deepseekAdapter: ProviderAdapter = {
  id: "deepseek",
  label: "DeepSeek",
  popular: true,
  authMethods: ["apiKey", "env"],
  envVars: ["DEEPSEEK_API_KEY"],
  npmPackage: "@ai-sdk/deepseek",
  defaultModel: "deepseek-v4-flash",
  fallbackModels: ["deepseek-v4-pro", "deepseek-v4-flash"],
  recommendedModels: ["deepseek-v4-pro", "deepseek-v4-flash"],
  buildLanguageModel({ modelId, auth, config }) {
    if (auth.kind !== "apiKey") throw new Error("DeepSeek: API key required")
    return createDeepSeek({
      apiKey: auth.value,
      baseURL: config?.baseURL,
      headers: config?.headers,
      fetch: tauriFetch,
    })(modelId)
  },
}
