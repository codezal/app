// DeepSeek provider adapter — @ai-sdk/deepseek sarmalayıcısı.
import { createDeepSeek } from "@ai-sdk/deepseek"
import type { ProviderAdapter } from "./types"

export const deepseekAdapter: ProviderAdapter = {
  id: "deepseek",
  label: "DeepSeek",
  defaultModel: "deepseek-v4-flash",
  fallbackModels: ["deepseek-v4-pro", "deepseek-v4-flash"],
  buildModel(modelId, apiKey) {
    return createDeepSeek({ apiKey })(modelId)
  },
}
