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
      // M23: branch on what the credential actually IS instead of dumping every
      // variant into `credentials`. GOOGLE_APPLICATION_CREDENTIALS is a FILE
      // PATH (→ keyFile), a pasted service-account JSON is an object
      // (→ credentials), and GOOGLE_VERTEX_API_KEY is a plain key (→ apiKey).
      ...resolveVertexAuth(auth.value),
      headers: config?.headers,
    })(modelId) as LanguageModel
  },
}

type VertexAuthOptions = {
  googleAuthOptions?: { credentials?: unknown; keyFile?: string }
  apiKey?: string
}

function resolveVertexAuth(value: string): VertexAuthOptions {
  const v = value.trim()
  // Pasted service-account JSON → credentials object.
  if (v.startsWith("{")) {
    const parsed = tryParseJson(v)
    if (parsed && typeof parsed === "object") {
      return { googleAuthOptions: { credentials: parsed } }
    }
  }
  // A credentials file path (GOOGLE_APPLICATION_CREDENTIALS) → keyFile.
  if (/^(?:[~/\\]|[A-Za-z]:[\\/])/.test(v) || v.endsWith(".json")) {
    return { googleAuthOptions: { keyFile: v } }
  }
  // Anything else is treated as a plain API key (GOOGLE_VERTEX_API_KEY).
  return { apiKey: v }
}

function tryParseJson(s: string): unknown {
  try {
    return JSON.parse(s)
  } catch {
    return null
  }
}
