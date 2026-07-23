// ProviderPickerModal — OpenCode-style "Connect Provider" picker.
//
// Shows every provider Codezal can talk to: the 20 first-class built-ins
// (popular tier) plus every catalog-derived provider from models.dev (~115).
// The user searches by name, picks one, and we hand off to
// ProviderConnectModal to collect the API key (with baseURL pre-filled for
// the dynamic ones).
import { useEffect, useMemo, useState } from "react"
import { X, Search, Sparkles, Plus } from "@/lib/icons"
import {
  listProviderAdapters,
  isConnectedSync,
  probeEnvVars,
  type ProviderInfo,
} from "@/lib/providers"
import { useSettingsStore } from "@/store/settings"
import { useT } from "@/lib/i18n/useT"
import type { CachedCatalog } from "@/lib/providers-catalog"

export function ProviderPickerModal({
  onPick,
  onCreateCustom,
  onClose,
}: {
  onPick: (provider: ProviderInfo) => void
  onCreateCustom: () => void
  onClose: () => void
}): React.ReactElement {
  const t = useT()
  const settings = useSettingsStore((s) => s.settings)
  const [query, setQuery] = useState("")

  const catalog = (settings.providerCatalog as CachedCatalog | undefined)?.data

  const all = useMemo(() => listProviderAdapters(catalog), [catalog])

  // Env fallback counts as connected — probe so env-bound providers are
  // hidden from the "add" list (they're already usable).
  const [envHits, setEnvHits] = useState<Record<string, boolean>>({})
  useEffect(() => {
    const unique = Array.from(new Set(all.flatMap((p) => p.envVars)))
    if (unique.length === 0) return
    void probeEnvVars(unique).then(setEnvHits)
  }, [all])

  // Esc → close
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose()
    }
    window.addEventListener("keydown", handler)
    return () => window.removeEventListener("keydown", handler)
  }, [onClose])

  const q = query.trim().toLowerCase()

  // Split into popular (built-in flagged) + other. Hide already-connected
  // entries (apiKey, oauth, or env fallback); the user manages those from
  // ModelsPage. Apply search across both groups.
  const visible = all.filter((p) => !isConnectedSync(p, settings, envHits))
  const matched = q
    ? visible.filter(
        (p) =>
          p.label.toLowerCase().includes(q) ||
          p.id.toLowerCase().includes(q),
      )
    : visible
  const popular = matched
    .filter((p) => p.popular)
    .sort((a, b) => a.label.localeCompare(b.label))
  const others = matched
    .filter((p) => !p.popular)
    .sort((a, b) => a.label.localeCompare(b.label))

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="flex max-h-[80vh] w-full max-w-lg flex-col rounded-lg border border-codezal bg-codezal-panel shadow-xl">
        <div className="flex items-center justify-between border-b border-codezal px-4 py-3">
          <h3 className="text-md font-semibold text-codezal-text">
            {t("settings.providersPage.pickerTitle")}
          </h3>
          <button
            onClick={onClose}
            className="text-codezal-dim hover:text-codezal-text"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="border-b border-codezal px-4 py-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-codezal-dim" />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("settings.providersPage.pickerSearchPlaceholder")}
              className="w-full rounded-md border border-codezal bg-codezal-input px-8 py-1.5 text-base text-codezal-text outline-none focus:border-codezal-accent"
            />
          </div>
        </div>

        <div className="border-b border-codezal px-4 py-2.5">
          <button
            onClick={onCreateCustom}
            className="flex w-full items-center gap-2 rounded-md border border-dashed border-codezal px-3 py-2 text-left text-base font-medium text-codezal-text hover:border-codezal-accent hover:bg-codezal-input"
          >
            <Plus className="size-4 shrink-0 text-codezal-accent" />
            {t("settings.customProvider.pickerEntry")}
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-3">
          {matched.length === 0 ? (
            <p className="text-base text-codezal-mute">
              {t("settings.modelsPage.noResults")}
            </p>
          ) : (
            <>
              {popular.length > 0 && (
                <Section title={t("settings.providersPage.pickerPopular")}>
                  {popular.map((p) => (
                    <Row key={p.id} provider={p} onPick={onPick} />
                  ))}
                </Section>
              )}
              {others.length > 0 && (
                <Section title={t("settings.providersPage.pickerOther")}>
                  {others.map((p) => (
                    <Row key={p.id} provider={p} onPick={onPick} />
                  ))}
                </Section>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function Section({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}): React.ReactElement {
  return (
    <div className="mb-3 last:mb-0">
      <div className="mb-1.5 text-md font-semibold uppercase tracking-wider text-codezal-dim">
        {title}
      </div>
      <ul className="flex flex-col overflow-hidden rounded-md border border-codezal bg-codezal-bg/40">
        {children}
      </ul>
    </div>
  )
}

function Row({
  provider,
  onPick,
}: {
  provider: ProviderInfo
  onPick: (p: ProviderInfo) => void
}): React.ReactElement {
  const t = useT()
  return (
    <li>
      <button
        onClick={() => onPick(provider)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-codezal-input"
      >
        <span className="truncate text-base font-medium text-codezal-text">
          {provider.label}
        </span>
        {provider.popular && (
          <span className="inline-flex items-center gap-1 rounded-full bg-codezal-accent/15 px-2 py-0.5 text-md font-semibold text-codezal-accent">
            <Sparkles className="size-3" />
            {t("settings.providersPage.recommended")}
          </span>
        )}
        {provider.oauthName && (
          <span className="rounded-full border border-codezal bg-codezal-input px-2 py-0.5 text-base text-codezal-dim">
            {t("settings.providersPage.badgeOauth")}
          </span>
        )}
      </button>
    </li>
  )
}
