// OpenAI provider adapter — @ai-sdk/openai wrapper.
import { createOpenAI } from "@ai-sdk/openai"
import type { ProviderAdapter } from "./types"
import { tauriFetch } from "./tauri-fetch"

export const openaiAdapter: ProviderAdapter = {
  id: "openai",
  label: "OpenAI",
  popular: true,
  authMethods: ["apiKey", "env"],
  envVars: ["OPENAI_API_KEY"],
  npmPackage: "@ai-sdk/openai",
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
  recommendedModels: ["gpt-5.5", "gpt-5.4", "gpt-5.4-mini"],
  buildLanguageModel({ modelId, auth, config }) {
    if (auth.kind !== "apiKey") throw new Error("OpenAI: API key required")
    return createOpenAI({
      apiKey: auth.value,
      baseURL: config?.baseURL,
      headers: config?.headers,
      fetch: tauriFetch,
    })(modelId)
  },
}
