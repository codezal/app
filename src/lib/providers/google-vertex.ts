// Google Vertex AI — Gemini + üçüncü-parti modeller, GCP üzerinden.
// Service account JSON (apiKey alanında) + project + location gerek.
import { loadProviderFactory } from "./lazy-sdk"
import type { LanguageModel } from "ai"
import type { ProviderAdapter } from "./types"

export const googleVertexAdapter: ProviderAdapter = {
  id: "google-vertex",
  label: "Google Vertex AI",
  authMethods: ["apiKey", "env"],
  envVars: ["GOOGLE_APPLICATION_CREDENTIALS", "GOOGLE_VERTEX_API_KEY"],
  npmPackage: "@ai-sdk/google-vertex",
  requiresConfig: true,
  defaultModel: "gemini-3.1-pro",
  fallbackModels: [
    "gemini-3.1-pro",
    "gemini-3.5-flash",
    "claude-opus-4-7@anthropic",
    "claude-sonnet-4-6@anthropic",
  ],
  recommendedModels: ["gemini-3.1-pro", "gemini-3.5-flash"],
  async buildLanguageModel({ modelId, auth, config }): Promise<LanguageModel> {
    if (auth.kind !== "apiKey") throw new Error("Google Vertex: credentials required")
    const project = config?.options?.project as string | undefined
    const location = (config?.options?.location as string | undefined) ?? "us-central1"
    if (!project) throw new Error("Google Vertex: project required in provider config")
    const factory = await loadProviderFactory("@ai-sdk/google-vertex")
    return factory({
      project,
      location,
      // Service account JSON tek string olarak apiKey'de tutulur; SDK googleAuthOptions
      // bekler, ham JSON'u parse edip credentials objesi olarak veriyoruz.
      googleAuthOptions: { credentials: tryParseJson(auth.value) },
      headers: config?.headers,
    })(modelId) as LanguageModel
  },
}

function tryParseJson(s: string): unknown {
  try {
    return JSON.parse(s)
  } catch {
    return s
  }
}
