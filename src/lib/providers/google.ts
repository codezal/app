// Google provider adapter — @ai-sdk/google sarmalayıcısı (Gemini).
import { createGoogleGenerativeAI } from "@ai-sdk/google"
import type { ProviderAdapter } from "./types"

export const googleAdapter: ProviderAdapter = {
  id: "google",
  label: "Google",
  defaultModel: "gemini-3.5-flash",
  fallbackModels: [
    "gemini-3.1-pro",
    "gemini-3.5-flash",
    "gemini-3.1-flash-lite",
    "gemini-2.5-pro",
    "gemini-2.5-flash",
  ],
  buildModel(modelId, apiKey) {
    return createGoogleGenerativeAI({ apiKey })(modelId)
  },
}
