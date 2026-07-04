import { loadProviderFactory } from "./lazy-sdk"
import type { LanguageModel } from "ai"
import type { ProviderAdapter } from "./types"
import { tauriFetch } from "./tauri-fetch"
import { quirkHeaders, withQuirkBody } from "./provider-quirks"

export const openrouterAdapter: ProviderAdapter = {
  id: "openrouter",
  label: "OpenRouter",
  popular: true,
  authMethods: ["apiKey", "env"],
  envVars: ["OPENROUTER_API_KEY"],
  npmPackage: "@openrouter/ai-sdk-provider",
  defaultModel: "openrouter/auto",
  fallbackModels: [
    "openrouter/auto",
    "anthropic/claude-opus-4-7",
    "anthropic/claude-sonnet-4-6",
    "openai/gpt-5.5",
    "openai/gpt-5.4-mini",
    "google/gemini-3.1-pro",
    "meta-llama/llama-4-maverick",
    "deepseek/deepseek-v4-pro",
    "x-ai/grok-4",
    "qwen/qwen3-coder",
  ],
  recommendedModels: ["openrouter/auto", "anthropic/claude-sonnet-4-6", "openai/gpt-5.4-mini"],
  async buildLanguageModel({ modelId, auth, config }): Promise<LanguageModel> {
    if (auth.kind !== "apiKey") throw new Error("OpenRouter: API key required")
    const factory = await loadProviderFactory("@openrouter/ai-sdk-provider")
    // Attribution headers (user config wins) + usage/reasoning body quirks.
    const headers = { ...quirkHeaders("openrouter"), ...(config?.headers ?? {}) }
    return factory({
      apiKey: auth.value,
      baseURL: config?.baseURL,
      headers,
      fetch: withQuirkBody(tauriFetch, "openrouter", modelId),
    })(modelId) as LanguageModel
  },
}
