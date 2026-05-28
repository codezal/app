// Anthropic provider adapter — @ai-sdk/anthropic wrapper.
// Supports apiKey, env (ANTHROPIC_API_KEY), and OAuth (Claude Pro/Max sign-in).
import { createAnthropic } from "@ai-sdk/anthropic"
import type { ProviderAdapter } from "./types"

export const anthropicAdapter: ProviderAdapter = {
  id: "anthropic",
  label: "Anthropic",
  popular: true,
  authMethods: ["apiKey", "env", "oauth"],
  envVars: ["ANTHROPIC_API_KEY"],
  npmPackage: "@ai-sdk/anthropic",
  oauthName: "anthropic",
  defaultModel: "claude-sonnet-4-6",
  fallbackModels: ["claude-opus-4-7", "claude-sonnet-4-6", "claude-haiku-4-5"],
  recommendedModels: ["claude-opus-4-7", "claude-sonnet-4-6", "claude-haiku-4-5"],
  buildLanguageModel({ modelId, auth, config }) {
    if (auth.kind === "apiKey") {
      return createAnthropic({
        apiKey: auth.value,
        baseURL: config?.baseURL,
        headers: config?.headers,
      })(modelId)
    }
    if (auth.kind === "oauth") {
      // Claude Pro/Max OAuth: bearer header + anthropic-beta for OAuth scope.
      return createAnthropic({
        apiKey: "oauth", // dummy — gerçek header bearer ile gönderilir
        baseURL: config?.baseURL,
        headers: {
          authorization: `Bearer ${auth.accessToken}`,
          "anthropic-beta": "oauth-2025-04-20",
          ...(config?.headers ?? {}),
        },
      })(modelId)
    }
    throw new Error("Anthropic: no credentials")
  },
}
