// Anthropic provider adapter — @ai-sdk/anthropic wrapper.
// Supports apiKey and env (ANTHROPIC_API_KEY). OAuth (Claude Pro/Max sign-in)
// was removed: those tokens are licensed only for Anthropic's own Claude Code
// client, so using them from a third-party app risks the user's account.
import { createAnthropic } from "@ai-sdk/anthropic"
import type { ProviderAdapter } from "./types"
import { tauriFetch } from "./tauri-fetch"
import { quirkHeaders } from "./provider-quirks"

export const anthropicAdapter: ProviderAdapter = {
  id: "anthropic",
  label: "Anthropic",
  popular: true,
  authMethods: ["apiKey", "env"],
  envVars: ["ANTHROPIC_API_KEY"],
  npmPackage: "@ai-sdk/anthropic",
  defaultModel: "claude-sonnet-4-6",
  fallbackModels: ["claude-opus-4-7", "claude-sonnet-4-6", "claude-haiku-4-5"],
  recommendedModels: ["claude-opus-4-7", "claude-sonnet-4-6", "claude-haiku-4-5"],
  buildLanguageModel({ modelId, auth, config }) {
    if (auth.kind === "apiKey") {
      // Interleaved-thinking + fine-grained tool streaming betas (user wins).
      const headers = { ...quirkHeaders("anthropic"), ...(config?.headers ?? {}) }
      return createAnthropic({
        apiKey: auth.value,
        baseURL: config?.baseURL,
        headers,
        fetch: tauriFetch,
      })(modelId)
    }
    throw new Error("Anthropic: no credentials")
  },
}
