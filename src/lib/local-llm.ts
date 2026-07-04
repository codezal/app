//
// edilebilir; DEFAULT_SETTINGS'i (config/defaults → providers → local-fetch
import type { Settings, LocalLlmSettings } from "@/store/types"

const FALLBACK: LocalLlmSettings = {
  contextWindow: 32768,
  flashAttention: "enabled",
  batchSize: 2048,
  threads: 0,
  batchThreads: 0,
  speculativeMode: "off",
  draftTokens: 4,
  draftModel: "",
  agentMode: true,
}

export function resolveLocalLlm(
  settings: Pick<Settings, "localLlm" | "localLlmByModel">,
  modelId?: string,
): LocalLlmSettings {
  const def = settings.localLlm ?? FALLBACK
  const byModel = modelId ? settings.localLlmByModel?.[modelId] : undefined
  return byModel ? { ...def, ...byModel } : def
}

export function displayModelName(name: string): string {
  const m = name.match(/^(.*)-00001-of-(\d{5})\.gguf$/)
  return m ? `${m[1]} · ${parseInt(m[2], 10)} parça` : name
}
