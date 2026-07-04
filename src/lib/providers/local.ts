// Local (in-process) provider — llama.cpp running inside the Tauri process,
// exposed to the chat flow through the OpenAI-compatible adapter with a custom
// fetch (localLlmFetch) instead of a TCP server. See local-fetch.ts.
//
// Models are the GGUF files in the Rust models dir (~/.cache/codezal/models),
// listed via the `llm_list_models` command and refreshed at boot.
import { loadProviderFactory } from "./lazy-sdk"
import type { LanguageModel } from "ai"
import type { ProviderAdapter } from "./types"
import { localLlmFetch } from "./local-fetch"
import { invoke } from "@tauri-apps/api/core"

// Downloaded GGUF basenames — populated at runtime from the Rust models dir.
let localModels: string[] = []

export function _syncLocalModels(list: string[]): void {
  localModels = Array.isArray(list) ? list : []
}

// Fetch the local model list from Rust and refresh the picker. No-op off-Tauri.
export async function refreshLocalModels(): Promise<string[]> {
  try {
    const list = await invoke<string[]>("llm_list_models")
    localModels = Array.isArray(list) ? list : []
  } catch {
    localModels = []
  }
  return localModels
}

export const localAdapter: ProviderAdapter = {
  id: "local",
  label: "Local (in-process)",
  popular: true,
  keyless: true,
  authMethods: [],
  envVars: [],
  npmPackage: "@ai-sdk/openai-compatible",
  defaultModel: "",
  // Dynamic — reflects whatever GGUFs are on disk (refreshed via refreshLocalModels).
  get fallbackModels(): string[] {
    return localModels
  },
  async buildLanguageModel({ modelId }): Promise<LanguageModel> {
    const factory = await loadProviderFactory("@ai-sdk/openai-compatible")
    // baseURL is a sentinel — localLlmFetch never touches the network.
    return factory({
      name: "local",
      apiKey: "no-key",
      baseURL: "http://local.invalid/v1",
      fetch: localLlmFetch,
    })(modelId) as LanguageModel
  },
}
