import { loadProviderFactory } from "./lazy-sdk"
import { readEnvVar } from "./env-reader"
import type { LanguageModel } from "ai"
import type { ProviderAdapter, ProviderId } from "./types"
import { tauriFetch } from "./tauri-fetch"
import { withSchemaSanitize } from "./transform"

export const openaiCompatibleAdapter: ProviderAdapter = {
  id: "openai-compatible",
  label: "OpenAI-Compatible",
  authMethods: ["apiKey", "env"],
  envVars: ["OPENAI_COMPATIBLE_API_KEY"],
  npmPackage: "@ai-sdk/openai-compatible",
  requiresConfig: true,
  defaultModel: "gpt-4",
  fallbackModels: [],
  async buildLanguageModel({ modelId, auth, config }): Promise<LanguageModel> {
    const baseURL = config?.baseURL
    if (!baseURL) throw new Error("OpenAI-Compatible: baseURL required")
    // M29: resolve the env key properly — the old code shipped the literal
    // string "no-key" as a bearer token and never read OPENAI_COMPATIBLE_API_KEY.
    let apiKey: string | undefined
    if (auth.kind === "apiKey") apiKey = auth.value
    if (!apiKey) apiKey = (await readEnvVar("OPENAI_COMPATIBLE_API_KEY")) ?? undefined
    const factory = await loadProviderFactory("@ai-sdk/openai-compatible")
    const providerName = String(config?.options?.providerName ?? "openai-compatible")
    // Moonshot/Kimi endpoints reject $ref-sibling / tuple-items tool schemas —
    // sanitize the body. No-op (tauriFetch passthrough) for other endpoints.
    return factory({
      name: providerName,
      // Keyless local endpoints exist (ollama/vllm without auth); the SDK
      // requires a string but only sends it as a bearer when non-empty would
      // matter — pass an empty string rather than a fake key for those.
      apiKey: apiKey ?? "",
      baseURL,
      headers: config?.headers,
      fetch: withSchemaSanitize(tauriFetch, providerName as ProviderId, modelId),
    })(modelId) as LanguageModel
  },
}
