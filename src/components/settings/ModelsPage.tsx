// ModelsPage — collapsible provider accordion with per-model toggle and
// inline connect/disconnect controls. Single page for all provider+model
//
// Layout choices for scale (20 providers × dozens of models each):
//   - Provider rows are collapsed by default (including connected ones); clicking
//     the row reveals its models. The user expands what they need, or "Expand all".
//   - Sticky search bar + filter chips (all/connected/disconnected) reduce the
//     visible set.
//   - When search query is active, all matching groups force-expand.
//   - Header row shows "X / Y enabled" + connect/disconnect button.
import { useEffect, useMemo, useState } from "react"
import { ChevronRight, Plus, Search, Sparkles } from "@/lib/icons"
import {
  listProviderAdapters,
  modelsFor,
  isConnectedSync,
  activeAuthLabel,
  isModelEnabled,
  buildBulkStatus,
  buildRecommendedStatus,
  probeEnvVars,
  type ProviderInfo,
  type CustomProvider,
} from "@/lib/providers"
import { useSettingsStore } from "@/store/settings"
import { useT } from "@/lib/i18n/useT"
import { modelDetail, type CachedCatalog, type ProvidersCatalog } from "@/lib/providers-catalog"
import { ProviderConnectModal } from "./ProviderConnectModal"
import { ProviderPickerModal } from "./ProviderPickerModal"
import { CustomProviderModal } from "./CustomProviderModal"

export function ModelsPage(): React.ReactElement {
  const t = useT()
  const settings = useSettingsStore((s) => s.settings)
  const setModelEnabled = useSettingsStore((s) => s.setModelEnabled)
  const setProviderModelStatus = useSettingsStore((s) => s.setProviderModelStatus)
  const disconnect = useSettingsStore((s) => s.disconnectProvider)
  const removeCustomProvider = useSettingsStore((s) => s.removeCustomProvider)
  const [query, setQuery] = useState("")
  const [connecting, setConnecting] = useState<ProviderInfo | null>(null)
  const [picking, setPicking] = useState(false)
  const [customEditing, setCustomEditing] = useState<CustomProvider | "new" | null>(null)
  const [envHits, setEnvHits] = useState<Record<string, boolean>>({})

  const cached = settings.providerCatalog as CachedCatalog | undefined
  const catalog = cached?.data

  // Pass the catalog to the registry so catalog-derived adapters appear
  // alongside built-ins. Connected catalog providers show up in the list;
  // disconnected ones live in the picker modal. customProviders is a dep so the
  // list recomputes after a custom provider is added/edited/removed (the
  // registry's custom adapters are synced by the store before this re-render).
  const adapters = useMemo(
    () => listProviderAdapters(catalog),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [catalog, settings.customProviders],
  )

  function openConnect(p: ProviderInfo): void {
    if (p.custom) {
      const cp = (settings.customProviders ?? []).find((c) => c.id === p.id)
      if (cp) {
        setCustomEditing(cp)
        return
      }
    }
    setConnecting(p)
  }

  // resolver itself checks the flag at auth time.
  useEffect(() => {
    const unique = Array.from(new Set(adapters.flatMap((p) => p.envVars)))
    if (unique.length === 0) return
    void probeEnvVars(unique).then(setEnvHits)
  }, [adapters, settings.envFallback])

  // Build group descriptors once per render. The list only shows providers
  // that are actually connected (apiKey, oauth, or env fallback) — new ones
  // are added via the picker modal.
  const groups = adapters
    .filter((p) => isConnectedSync(p, settings, envHits))
    .map((p) => {
      const models = modelsFor(p.id, catalog)
      const enabledCount = models.reduce(
        (n, m) => (isModelEnabled(p, m, settings) ? n + 1 : n),
        0,
      )
      return { provider: p, models, connected: true as const, enabledCount }
    })

  const [expanded, setExpanded] = useState<Record<string, boolean>>({})

  const q = query.trim().toLowerCase()

  // Search across connected providers + their models. `providerMatched`
  // ranks provider-name hits above model-id hits during sort.
  const filtered = groups
    .map((g) => {
      if (!q) {
        return { ...g, matchedModels: g.models, providerMatched: false }
      }
      const providerHit = g.provider.label.toLowerCase().includes(q)
      if (providerHit) {
        return { ...g, matchedModels: g.models, providerMatched: true }
      }
      const matched = g.models.filter((m) => m.toLowerCase().includes(q))
      return { ...g, matchedModels: matched, providerMatched: false }
    })
    .filter((g) => g.matchedModels.length > 0)

  filtered.sort((a, b) => {
    if (q) {
      if (a.providerMatched !== b.providerMatched) return a.providerMatched ? -1 : 1
      if (a.matchedModels.length !== b.matchedModels.length) {
        return b.matchedModels.length - a.matchedModels.length
      }
    }
    if (Boolean(a.provider.popular) !== Boolean(b.provider.popular)) {
      return a.provider.popular ? -1 : 1
    }
    return a.provider.label.localeCompare(b.provider.label)
  })

  function toggleGroup(id: string): void {
    setExpanded((prev) => ({ ...prev, [id]: !prev[id] }))
  }

  function expandAll(): void {
    const all: Record<string, boolean> = {}
    for (const g of filtered) all[g.provider.id] = true
    setExpanded((prev) => ({ ...prev, ...all }))
  }

  function collapseAll(): void {
    const all: Record<string, boolean> = {}
    for (const g of filtered) all[g.provider.id] = false
    setExpanded((prev) => ({ ...prev, ...all }))
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Search + filter chips — sticky so they stay visible while scrolling. */}
      <div className="sticky top-0 z-10 -mx-6 -mt-6 flex flex-col gap-2 border-b border-codezal bg-codezal-bg px-6 pb-3 pt-6">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-codezal-dim" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("settings.modelsPage.searchPlaceholder")}
            className="w-full rounded-md border border-codezal bg-codezal-input px-8 py-1.5 text-base text-codezal-text outline-none focus:border-codezal-accent"
          />
        </div>
        <div className="flex items-center justify-between gap-2">
          <button
            onClick={() => setPicking(true)}
            className="inline-flex items-center gap-1.5 rounded-md bg-codezal-accent px-3 py-1 text-base font-medium text-white hover:bg-codezal-accent/90"
          >
            <Plus className="size-3.5" />
            {t("settings.providersPage.addProvider")}
          </button>
          <div className="flex items-center gap-1 text-base">
            <GhostButton onClick={expandAll}>
              {t("settings.modelsPage.expandAll")}
            </GhostButton>
            <GhostButton onClick={collapseAll}>
              {t("settings.modelsPage.collapseAll")}
            </GhostButton>
          </div>
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-6">
          <p className="text-base text-codezal-mute">
            {groups.length === 0
              ? t("settings.providersPage.emptyHint")
              : t("settings.modelsPage.noResults")}
          </p>
          {groups.length === 0 && (
            <button
              onClick={() => setPicking(true)}
              className="inline-flex items-center gap-1.5 rounded-md bg-codezal-accent px-3 py-1.5 text-base font-medium text-white hover:bg-codezal-accent/90"
            >
              <Plus className="size-3.5" />
              {t("settings.providersPage.addProvider")}
            </button>
          )}
        </div>
      ) : (
        <ul className="flex flex-col overflow-hidden rounded-md border border-codezal bg-codezal-panel">
          {filtered.map((g, idx) => {
            const forceOpen = q.length > 0
            // Disconnected providers never reach this branch when search is
            // active (filtered out above). Outside search they are still listed
            // but cannot expand on click — the row acts as a "Connect" button.
            const expandable = g.connected
            const open = expandable && (forceOpen || expanded[g.provider.id] === true)
            const visibleModels = g.matchedModels
            return (
              <li
                key={g.provider.id}
                className={idx > 0 ? "border-t border-codezal" : ""}
              >
                <ProviderHeader
                  provider={g.provider}
                  connected={g.connected}
                  expandable={expandable}
                  badge={activeAuthLabel(g.provider, settings, envHits)}
                  open={open}
                  enabledCount={g.enabledCount}
                  totalCount={g.models.length}
                  onToggle={() => toggleGroup(g.provider.id)}
                  onConnect={() => openConnect(g.provider)}
                  onDisconnect={() =>
                    g.provider.custom
                      ? void removeCustomProvider(g.provider.id)
                      : void disconnect(g.provider.id)
                  }
                />
                {open && (
                  <ProviderBody
                    provider={g.provider}
                    models={visibleModels}
                    allModels={g.models}
                    catalog={catalog}
                    isEnabled={(modelId) => isModelEnabled(g.provider, modelId, settings)}
                    onModelToggle={(modelId, enabled) =>
                      void setModelEnabled(g.provider.id, modelId, enabled)
                    }
                    onEnableAll={() =>
                      void setProviderModelStatus(g.provider.id, buildBulkStatus(g.models, true))
                    }
                    onDisableAll={() =>
                      void setProviderModelStatus(g.provider.id, buildBulkStatus(g.models, false))
                    }
                    onOnlyRecommended={() =>
                      void setProviderModelStatus(
                        g.provider.id,
                        buildRecommendedStatus(g.provider, g.models),
                      )
                    }
                  />
                )}
              </li>
            )
          })}
        </ul>
      )}

      {connecting && (
        <ProviderConnectModal
          provider={connecting}
          onClose={() => setConnecting(null)}
        />
      )}
      {picking && (
        <ProviderPickerModal
          onPick={(p) => {
            setPicking(false)
            setConnecting(p)
          }}
          onCreateCustom={() => {
            setPicking(false)
            setCustomEditing("new")
          }}
          onClose={() => setPicking(false)}
        />
      )}
      {customEditing && (
        <CustomProviderModal
          existing={customEditing === "new" ? undefined : customEditing}
          onClose={() => setCustomEditing(null)}
        />
      )}
    </div>
  )
}

function ProviderHeader({
  provider,
  connected,
  expandable,
  badge,
  open,
  enabledCount,
  totalCount,
  onToggle,
  onConnect,
  onDisconnect,
}: {
  provider: ProviderInfo
  connected: boolean
  expandable: boolean
  badge: "apiKey" | "oauth" | "env" | null
  open: boolean
  enabledCount: number
  totalCount: number
  onToggle: () => void
  onConnect: () => void
  onDisconnect: () => void
}): React.ReactElement {
  const t = useT()
  // Row click behaviour:
  //   - expandable (connected, or forced by search) → toggle open/closed
  //   - disconnected outside search → open the connect modal directly
  const handleClick = expandable ? onToggle : onConnect
  return (
    <div
      onClick={handleClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault()
          handleClick()
        }
      }}
      className="flex w-full cursor-pointer items-center gap-2.5 px-3 py-2 text-left hover:bg-codezal-input"
    >
      {expandable ? (
        <ChevronRight
          className={
            "size-3.5 shrink-0 text-codezal-dim transition-transform " +
            (open ? "rotate-90" : "")
          }
        />
      ) : (
        // Placeholder keeps the row aligned with expandable peers.
        <span className="inline-block size-3.5 shrink-0" />
      )}
      <span className="truncate text-base font-medium text-codezal-text">
        {provider.label}
      </span>
      {provider.popular && !connected && (
        <span className="inline-flex items-center gap-1 rounded-full bg-codezal-accent/15 px-2 py-0.5 text-md font-semibold text-codezal-accent">
          <Sparkles className="size-2.5" />
          {t("settings.providersPage.recommended")}
        </span>
      )}
      {badge === "apiKey" && (
        <span className="rounded-full border border-codezal bg-codezal-input px-2 py-0.5 text-base text-codezal-dim">
          {t("settings.providersPage.badgeApiKey")}
        </span>
      )}
      {badge === "oauth" && (
        <span className="rounded-full border border-codezal bg-codezal-input px-2 py-0.5 text-base text-codezal-dim">
          {t("settings.providersPage.badgeOauth")}
        </span>
      )}
      {badge === "env" && (
        <span className="rounded-full border border-codezal bg-codezal-input px-2 py-0.5 text-base text-codezal-dim">
          {t("settings.providersPage.badgeEnv")}
        </span>
      )}
      <div className="flex-1" />
      {connected && (
        <span className="shrink-0 text-base text-codezal-mute">
          {t("settings.modelsPage.countLabel", {
            enabled: String(enabledCount),
            total: String(totalCount),
          })}
        </span>
      )}
      {connected && provider.keyless ? null : connected ? (
        <>
          <HeaderButton
            onClick={(e) => {
              e.stopPropagation()
              onConnect()
            }}
            kind="ghost"
          >
            {t("settings.providersPage.edit")}
          </HeaderButton>
          <HeaderButton
            onClick={(e) => {
              e.stopPropagation()
              onDisconnect()
            }}
            kind="ghost"
          >
            {t("settings.providersPage.disconnect")}
          </HeaderButton>
        </>
      ) : (
        <HeaderButton
          onClick={(e) => {
            e.stopPropagation()
            onConnect()
          }}
          kind="primary"
        >
          {t("settings.providersPage.connect")}
        </HeaderButton>
      )}
    </div>
  )
}

function HeaderButton({
  onClick,
  kind,
  children,
}: {
  onClick: (e: React.MouseEvent) => void
  kind: "primary" | "ghost"
  children: React.ReactNode
}): React.ReactElement {
  return (
    <button
      onClick={onClick}
      className={
        kind === "primary"
          ? "shrink-0 rounded-md bg-codezal-accent px-2.5 py-0.5 text-base font-medium text-white hover:bg-codezal-accent/90"
          : "shrink-0 rounded-md border border-codezal px-2 py-0.5 text-base text-codezal-dim hover:bg-codezal-input hover:text-codezal-text"
      }
    >
      {children}
    </button>
  )
}

function ProviderBody({
  provider,
  models,
  allModels,
  catalog,
  isEnabled,
  onModelToggle,
  onEnableAll,
  onDisableAll,
  onOnlyRecommended,
}: {
  provider: ProviderInfo
  models: readonly string[]
  allModels: readonly string[]
  catalog: ProvidersCatalog | undefined
  isEnabled: (modelId: string) => boolean
  onModelToggle: (modelId: string, enabled: boolean) => void
  onEnableAll: () => void
  onDisableAll: () => void
  onOnlyRecommended: () => void
}): React.ReactElement {
  const t = useT()
  const recommended = new Set(provider.recommendedModels ?? [])
  const filteredOut = allModels.length - models.length
  return (
    <div className="border-t border-codezal bg-codezal-bg/40 px-3 py-2">
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <div className="text-base text-codezal-mute">
          {filteredOut > 0
            ? t("settings.modelsPage.filteredHint", { hidden: String(filteredOut) })
            : ""}
        </div>
        <div className="flex shrink-0 items-center gap-1 text-base">
          <GhostButton onClick={onOnlyRecommended}>
            {t("settings.modelsPage.onlyRecommended")}
          </GhostButton>
          <GhostButton onClick={onEnableAll}>
            {t("settings.modelsPage.enableAll")}
          </GhostButton>
          <GhostButton onClick={onDisableAll}>
            {t("settings.modelsPage.disableAll")}
          </GhostButton>
        </div>
      </div>
      <ul className="flex flex-col divide-y divide-codezal/60 overflow-hidden rounded-md border border-codezal bg-codezal-panel">
        {models.map((m) => {
          // Display the catalog `name` (e.g. "DeepSeek V4 Pro") and fall back
          // to the raw id only when the catalog has no friendly name.
          const detail = modelDetail(catalog, provider.id, m)
          const displayName = detail?.name?.trim() || m
          return (
            <li key={m} className="flex items-center justify-between gap-3 px-3 py-1.5">
              <div className="flex min-w-0 items-center gap-2">
                <span className="truncate text-base text-codezal-text">
                  {displayName}
                </span>
                {recommended.has(m) && (
                  <span
                    title={t("settings.modelsPage.recommendedTooltip")}
                    className="inline-flex items-center gap-1 rounded-full bg-codezal-accent/15 px-2 py-0.5 text-md font-semibold text-codezal-accent"
                  >
                    <Sparkles className="size-2.5" />
                    {t("settings.modelsPage.recommendedBadge")}
                  </span>
                )}
              </div>
              <Toggle label={m} enabled={isEnabled(m)} onChange={(v) => onModelToggle(m, v)} />
            </li>
          )
        })}
      </ul>
    </div>
  )
}

function GhostButton({
  onClick,
  children,
}: {
  onClick: () => void
  children: React.ReactNode
}): React.ReactElement {
  return (
    <button
      onClick={(e) => {
        e.stopPropagation()
        onClick()
      }}
      className="rounded-md border border-codezal px-2 py-0.5 text-codezal-dim hover:bg-codezal-input hover:text-codezal-text"
    >
      {children}
    </button>
  )
}

function Toggle({
  enabled,
  onChange,
  label,
}: {
  enabled: boolean
  onChange: (v: boolean) => void
  label?: string
}): React.ReactElement {
  // Hardcoded Tailwind grays for the off state — `bg-codezal-mute` is a text
  // token (no matching bg utility) and codezal-input matches the row surface
  // in light theme, so both produced an invisible knob in earlier iterations.
  return (
    <button
      onClick={(e) => {
        e.stopPropagation()
        onChange(!enabled)
      }}
      role="switch"
      aria-checked={enabled}
      aria-label={label}
      className={
        enabled
          ? "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border border-codezal-accent bg-codezal-accent transition-colors"
          : "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border border-zinc-300 bg-zinc-200 transition-colors dark:border-zinc-600 dark:bg-zinc-700"
      }
    >
      <span
        className={
          enabled
            ? "inline-block size-3.5 translate-x-[18px] rounded-full bg-white shadow-sm transition-transform"
            : "inline-block size-3.5 translate-x-[2px] rounded-full bg-white shadow-sm transition-transform"
        }
      />
    </button>
  )
}
