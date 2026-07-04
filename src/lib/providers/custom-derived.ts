// gelir (closure'a baked).
import type { LanguageModel } from "ai"
import { loadProviderFactory } from "./lazy-sdk"
import { tauriFetch } from "./tauri-fetch"
import { withSchemaSanitize } from "./transform"
import type { CustomProvider, ProviderAdapter, ProviderId } from "./types"

export function deriveCustomProviders(list: CustomProvider[] | undefined): ProviderAdapter[] {
  if (!list || list.length === 0) return []
  const out: ProviderAdapter[] = []
  for (const cp of list) {
    if (!cp.id?.trim() || !cp.baseURL?.trim()) continue
    out.push(makeCustomAdapter(cp))
  }
  return out
}

function makeCustomAdapter(cp: CustomProvider): ProviderAdapter {
  const modelIds = cp.models.map((m) => m.id.trim()).filter(Boolean)
  const baseURL = cp.baseURL.trim()
  const headers = cp.headers && Object.keys(cp.headers).length > 0 ? cp.headers : undefined
  return {
    id: cp.id,
    label: cp.name?.trim() || cp.id,
    custom: true,
    authMethods: ["apiKey"],
    envVars: [],
    npmPackage: "@ai-sdk/openai-compatible",
    requiresConfig: false,
    defaultModel: modelIds[0] ?? "",
    fallbackModels: modelIds,
    async buildLanguageModel({ modelId, auth, config }): Promise<LanguageModel> {
      const apiKey = auth.kind === "apiKey" ? auth.value : "no-key"
      const factory = await loadProviderFactory("@ai-sdk/openai-compatible")
      const resolvedBase = config?.baseURL?.trim() || baseURL
      const resolvedHeaders = config?.headers ?? headers
      return factory({
        name: cp.id,
        apiKey,
        baseURL: resolvedBase,
        headers: resolvedHeaders,
        fetch: withSchemaSanitize(tauriFetch, cp.id as ProviderId, modelId),
      })(modelId) as LanguageModel
    },
  }
}
