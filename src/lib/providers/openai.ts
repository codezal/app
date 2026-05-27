// OpenAI provider adapter — @ai-sdk/openai sarmalayıcısı.
import { createOpenAI } from "@ai-sdk/openai"
import type { ProviderAdapter } from "./types"

export const openaiAdapter: ProviderAdapter = {
  id: "openai",
  label: "OpenAI",
  defaultModel: "gpt-5.4-mini",
  fallbackModels: [
    "gpt-5.5",
    "gpt-5.5-pro",
    "gpt-5.4",
    "gpt-5.4-mini",
    "gpt-5.4-nano",
    "gpt-5.3-codex",
    "gpt-5.2-codex",
    "o4-mini",
  ],
  buildModel(modelId, apiKey) {
    return createOpenAI({ apiKey })(modelId)
  },
}
