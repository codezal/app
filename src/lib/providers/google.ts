// Google provider adapter — @ai-sdk/google wrapper (Gemini API).
// Loaded lazily: the SDK bundles google-auth-library (Node-only EventEmitter
// code) that crashes the WebView at import time if statically bundled.
import { loadProviderFactory } from "./lazy-sdk"
import type { LanguageModel } from "ai"
import type { ProviderAdapter } from "./types"
import { tauriFetch } from "./tauri-fetch"
import { withSchemaSanitize } from "./transform"

export const googleAdapter: ProviderAdapter = {
  id: "google",
  label: "Google",
  popular: true,
  authMethods: ["apiKey", "env"],
  envVars: ["GOOGLE_GENERATIVE_AI_API_KEY", "GEMINI_API_KEY"],
  npmPackage: "@ai-sdk/google",
  defaultModel: "gemini-3.5-flash",
  fallbackModels: [
    "gemini-3.1-pro",
    "gemini-3.5-flash",
    "gemini-3.1-flash-lite",
    "gemini-2.5-pro",
    "gemini-2.5-flash",
  ],
  recommendedModels: ["gemini-3.1-pro", "gemini-3.5-flash"],
  async buildLanguageModel({ modelId, auth, config }): Promise<LanguageModel> {
    if (auth.kind !== "apiKey") throw new Error("Google: API key required")
    // Gemini rejects integer enums / tuple `items` in tool schemas — sanitize
    // the outgoing request body so tool calls don't 400.
    const factory = await loadProviderFactory("@ai-sdk/google")
    return factory({
      apiKey: auth.value,
      baseURL: config?.baseURL,
      headers: config?.headers,
      fetch: withSchemaSanitize(tauriFetch, "google", modelId),
    })(modelId) as LanguageModel
  },
}
