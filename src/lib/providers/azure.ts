// Azure OpenAI — Microsoft hosted OpenAI modelleri.
// resourceName + apiKey + opsiyonel deployment id gerek.
import { loadProviderFactory } from "./lazy-sdk"
import type { LanguageModel } from "ai"
import type { ProviderAdapter } from "./types"

export const azureAdapter: ProviderAdapter = {
  id: "azure",
  label: "Azure OpenAI",
  authMethods: ["apiKey", "env"],
  envVars: ["AZURE_API_KEY", "AZURE_OPENAI_API_KEY"],
  npmPackage: "@ai-sdk/azure",
  requiresConfig: true,
  defaultModel: "gpt-5.4",
  fallbackModels: ["gpt-5.5", "gpt-5.4", "gpt-5.4-mini", "o4-mini", "gpt-5.3-codex"],
  recommendedModels: ["gpt-5.4", "gpt-5.4-mini"],
  async buildLanguageModel({ modelId, auth, config }): Promise<LanguageModel> {
    if (auth.kind !== "apiKey") throw new Error("Azure OpenAI: API key required")
    const resourceName = config?.options?.resourceName as string | undefined
    if (!resourceName) throw new Error("Azure OpenAI: resourceName required in provider config")
    const apiVersion = (config?.options?.apiVersion as string | undefined) ?? "2025-04-01-preview"
    const factory = await loadProviderFactory("@ai-sdk/azure")
    return factory({
      apiKey: auth.value,
      resourceName,
      apiVersion,
      baseURL: config?.baseURL,
      headers: config?.headers,
    })(modelId) as LanguageModel
  },
}
