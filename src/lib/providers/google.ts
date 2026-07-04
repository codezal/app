// Google provider adapter — @ai-sdk/google wrapper (Gemini API).
import { createGoogleGenerativeAI } from "@ai-sdk/google"
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
  buildLanguageModel({ modelId, auth, config }) {
    if (auth.kind !== "apiKey") throw new Error("Google: API key required")
    // Gemini rejects integer enums / tuple `items` in tool schemas — sanitize
    // the outgoing request body so tool calls don't 400.
    return createGoogleGenerativeAI({
      apiKey: auth.value,
      baseURL: config?.baseURL,
      headers: config?.headers,
      fetch: withSchemaSanitize(tauriFetch, "google", modelId),
    })(modelId)
  },
}
