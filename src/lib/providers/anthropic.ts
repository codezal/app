// Anthropic provider adapter — @ai-sdk/anthropic sarmalayıcısı.
import { createAnthropic } from "@ai-sdk/anthropic"
import type { ProviderAdapter } from "./types"

export const anthropicAdapter: ProviderAdapter = {
  id: "anthropic",
  label: "Anthropic",
  defaultModel: "claude-sonnet-4-6",
  fallbackModels: ["claude-opus-4-7", "claude-sonnet-4-6", "claude-haiku-4-5"],
  buildModel(modelId, apiKey) {
    return createAnthropic({ apiKey })(modelId)
  },
}
