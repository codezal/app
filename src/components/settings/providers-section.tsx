import { useState } from "react"
import { useSettingsStore } from "@/store/settings"
import { useT } from "@/lib/i18n/useT"
import { errorMessage } from "@/lib/errors"
import { Section } from "./primitives"

export function ProviderCatalogSection() {
  const t = useT()
  const settings = useSettingsStore((s) => s.settings)
  const refreshProviderCatalog = useSettingsStore((s) => s.refreshProviderCatalog)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const cache = settings.providerCatalog
  const fetched = cache?.fetchedAt
  const modelCount = cache?.data ? countModels(cache.data) : 0

  async function refresh() {
    setRefreshing(true)
    setError(null)
    try {
      await refreshProviderCatalog()
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setRefreshing(false)
    }
  }

  return (
    <Section title={t("settings.drawer.catalogTitle")}>
      <div className="flex items-center justify-between gap-2 text-base">
        <div className="flex-1 text-codezal-dim">
          {fetched ? (
            <>
              {t("settings.drawer.catalogLastUpdate")} <span className="text-codezal-text">{new Date(fetched).toLocaleString()}</span>
              {modelCount > 0 && <> · <span className="text-codezal-text">{modelCount}</span> {t("settings.drawer.catalogModelsLabel")}</>}
            </>
          ) : (
            <span>{t("settings.drawer.catalogNotLoaded")}</span>
          )}
        </div>
        <button
          type="button"
          onClick={() => void refresh()}
          disabled={refreshing}
          className="rounded-md border border-codezal px-3 py-1.5 text-base text-codezal-dim hover:border-codezal-strong hover:text-codezal-text disabled:opacity-50"
        >
          {refreshing ? t("settings.drawer.catalogRefreshing") : t("settings.drawer.catalogRefresh")}
        </button>
      </div>
      {error && <p className="mt-1.5 text-base text-destructive">{t("settings.drawer.catalogErrorLabel")} {error}</p>}
    </Section>
  )
}

function countModels(data: Record<string, unknown>): number {
  let n = 0
  for (const p of Object.values(data)) {
    const block = p as { models?: Record<string, unknown> } | undefined
    if (block?.models) n += Object.keys(block.models).length
  }
  return n
}

