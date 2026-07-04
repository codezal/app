import { loadProviderFactory } from "./lazy-sdk"
import type { LanguageModel } from "ai"
import type { ProviderAdapter } from "./types"
import { mlxFetch } from "./mlx-fetch"
import { MLX_MODELS } from "@/lib/mlx-models"

export const mlxAdapter: ProviderAdapter = {
  id: "mlx",
  label: "MLX (native)",
  popular: true,
  keyless: true,
  authMethods: [],
  envVars: [],
  npmPackage: "@ai-sdk/openai-compatible",
  defaultModel: MLX_MODELS[0],
  fallbackModels: MLX_MODELS,
  async buildLanguageModel({ modelId }): Promise<LanguageModel> {
    const factory = await loadProviderFactory("@ai-sdk/openai-compatible")
    return factory({
      name: "mlx",
      apiKey: "no-key",
      baseURL: "http://mlx.local.invalid/v1",
      fetch: mlxFetch,
    })(modelId || MLX_MODELS[0]) as LanguageModel
  },
}
