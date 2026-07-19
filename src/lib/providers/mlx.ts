import { loadProviderFactory } from "./lazy-sdk"
import type { LanguageModel } from "ai"
import type { ProviderAdapter } from "./types"
import { mlxFetch } from "./mlx-fetch"
import { MLX_MODELS } from "@/lib/mlx-models"
import { invoke } from "@tauri-apps/api/core"

type MlxModelInfo = { id: string; size: number }
type MlxStatus = { available: boolean; reason?: string }

let mlxModels: string[] = []

export function _syncMlxModels(list: string[]): void {
  mlxModels = Array.isArray(list) ? list : []
}

export async function refreshMlxModels(): Promise<string[]> {
  try {
    const status = await invoke<MlxStatus>("mlx_status")
    if (!status.available) {
      mlxModels = []
      return mlxModels
    }
    const list = await invoke<MlxModelInfo[]>("mlx_list_models")
    mlxModels = Array.isArray(list) ? list.map((model) => model.id) : []
  } catch {
    mlxModels = []
  }
  return mlxModels
}

export const mlxAdapter: ProviderAdapter = {
  id: "mlx",
  label: "MLX (native)",
  popular: true,
  keyless: true,
  authMethods: [],
  envVars: [],
  npmPackage: "@ai-sdk/openai-compatible",
  defaultModel: MLX_MODELS[0],
  // Dynamic — only models installed in the native MLX cache are selectable.
  get fallbackModels(): string[] {
    return mlxModels
  },
  async buildLanguageModel({ modelId }): Promise<LanguageModel> {
    const factory = await loadProviderFactory("@ai-sdk/openai-compatible")
    return factory({
      name: "mlx",
      apiKey: "no-key",
      baseURL: "http://mlx.local.invalid/v1",
      fetch: mlxFetch,
    })(modelId || mlxModels[0] || MLX_MODELS[0]) as LanguageModel
  },
}
