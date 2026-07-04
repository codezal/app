//
// Kural:
//
import { defaultModelFor, modelsFor, type ProviderId } from "@/lib/providers"
import type { ProvidersCatalog } from "@/lib/providers-catalog"
import type { ProjectMeta, Settings } from "@/store/types"

export function resolveSessionDefaults(
  meta: ProjectMeta | undefined,
  settings: Settings,
): { provider: ProviderId; model: string } {
  if (meta?.defaultProvider && meta.defaultModel) {
    const catalog = settings.providerCatalog?.data as ProvidersCatalog | undefined
    const list = modelsFor(meta.defaultProvider, catalog, settings.modelStatus)
    const valid = list.length === 0 || list.includes(meta.defaultModel)
    if (valid) return { provider: meta.defaultProvider, model: meta.defaultModel }
    const fallbackModel = defaultModelFor(meta.defaultProvider, catalog)
    if (fallbackModel) return { provider: meta.defaultProvider, model: fallbackModel }
  }
  return { provider: settings.defaultProvider, model: settings.defaultModel }
}
