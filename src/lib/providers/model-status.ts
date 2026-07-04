// Per-model enable/disable helpers.
import type { Settings } from "@/store/types"
import type { ProviderId, ProviderInfo } from "./types"

export function isModelEnabled(
  provider: ProviderInfo,
  modelId: string,
  settings: Settings,
): boolean {
  const status = settings.modelStatus?.[provider.id]
  if (status && modelId in status) return status[modelId]
  const recommended = provider.recommendedModels
  if (!recommended || recommended.length === 0) return true
  return recommended.includes(modelId)
}

export function listModelStatus(
  provider: ProviderInfo,
  catalogModels: readonly string[],
  settings: Settings,
): Array<{ modelId: string; enabled: boolean; recommended: boolean }> {
  const recommended = new Set(provider.recommendedModels ?? [])
  return catalogModels.map((modelId) => ({
    modelId,
    enabled: isModelEnabled(provider, modelId, settings),
    recommended: recommended.has(modelId),
  }))
}

export function buildBulkStatus(
  catalogModels: readonly string[],
  enabled: boolean,
): Record<string, boolean> {
  const out: Record<string, boolean> = {}
  for (const m of catalogModels) out[m] = enabled
  return out
}

export function buildRecommendedStatus(
  provider: ProviderInfo,
  catalogModels: readonly string[],
): Record<string, boolean> {
  const recommended = new Set(provider.recommendedModels ?? [])
  const out: Record<string, boolean> = {}
  for (const m of catalogModels) out[m] = recommended.has(m)
  return out
}

export type ProviderModelStatus = Partial<Record<ProviderId, Record<string, boolean>>>
