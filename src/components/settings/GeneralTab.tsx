import { useEffect, useMemo, useRef, useState } from "react"
import { Check } from "@/lib/icons"
import { listProviderAdapters, modelsFor, defaultModelFor, isConnectedSync, probeEnvVars, type ProviderId } from "@/lib/providers"
import { modelDetail, type ProvidersCatalog } from "@/lib/providers-catalog"
import {
  defaultModelForAgentProvider,
  isCliAgentProvider,
  listVisibleAgentProviders,
  modelsForAgentProvider,
} from "@/lib/agent-providers"
import { useSettingsStore } from "@/store/settings"
import { cn } from "@/lib/utils"
import { Select } from "@/components/Select"
import { LOCALES, type Locale } from "@/lib/i18n"
import { useT } from "@/lib/i18n/useT"
import { Section, Row, Toggle, NumberField } from "./primitives"

function LanguageSelect({
  value,
  onChange,
}: {
  value: Locale
  onChange: (code: Locale) => void
}) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement | null>(null)

  // Outside-click + Esc to close.
  useEffect(() => {
    if (!open) return
    function onDoc(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false)
    }
    document.addEventListener("mousedown", onDoc)
    document.addEventListener("keydown", onKey)
    return () => {
      document.removeEventListener("mousedown", onDoc)
      document.removeEventListener("keydown", onKey)
    }
  }, [open])

  const current = LOCALES.find((l) => l.code === value) ?? LOCALES[0]

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="codezal-select text-left"
      >
        {current.nativeName}
      </button>
      {open && (
        <div className="absolute inset-x-0 top-full z-30 mt-1 max-h-64 overflow-y-auto cz-menu p-1.5">
          {LOCALES.map((l) => {
            const active = l.code === value
            return (
              <button
                key={l.code}
                type="button"
                onClick={() => {
                  onChange(l.code)
                  setOpen(false)
                }}
                className={cn(
                  "flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-left text-base hover:bg-codezal-panel-2 hover:text-codezal-text",
                  active ? "text-codezal-text" : "text-codezal-dim",
                )}
              >
                <span className="min-w-0 flex-1 truncate">{l.nativeName}</span>
                <Check
                  className={cn(
                    "h-4 w-4 shrink-0 text-codezal-accent",
                    active ? "opacity-100" : "opacity-0",
                  )}
                />
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

export function GeneralTab() {
  const settings = useSettingsStore((s) => s.settings)
  const update = useSettingsStore((s) => s.update)
  const t = useT()

  return (
    <div className="space-y-8">
      <Section title={t("settings.general.defaultsTitle")}>
        <div className="border-b border-codezal-hair pb-3 pt-1">
          <div className="mb-2 text-base font-medium text-codezal-text">
            {t("settings.general.language")}
          </div>
          <LanguageSelect
            value={settings.language ?? "tr"}
            onChange={(code) => void update({ language: code })}
          />
          <p className="mt-2 text-base leading-relaxed text-codezal-mute">
            {t("settings.general.languageDesc")}
          </p>
        </div>
        <div className="pb-1 pt-3">
          <div className="mb-2 text-base font-medium text-codezal-text">
            {t("settings.drawer.defaultProviderModelTitle")}
          </div>
          <DefaultProviderModelSelector />
          <p className="mt-2 text-base leading-relaxed text-codezal-mute">
            {t("settings.drawer.defaultProviderModelHint")}
          </p>
        </div>
      </Section>

      <Section title={t("settings.drawer.interfaceSectionTitle")}>
        <Row
          label={t("settings.drawer.openFilesPanelLabel")}
          description={t("settings.drawer.openFilesPanelDesc")}
        >
          <Toggle
            label={t("settings.drawer.openFilesPanelLabel")}
            checked={settings.openFilesPanelOnLaunch ?? true}
            onChange={(v) => void update({ openFilesPanelOnLaunch: v })}
          />
        </Row>
        <Row
          label={t("settings.drawer.suggestionsEnabledLabel")}
          description={t("settings.drawer.suggestionsEnabledDesc")}
        >
          <Toggle
            label={t("settings.drawer.suggestionsEnabledLabel")}
            checked={settings.suggestionsEnabled ?? true}
            onChange={(v) => void update({ suggestionsEnabled: v })}
          />
        </Row>
        <Row
          label={t("settings.drawer.spendCapLabel")}
          description={t("settings.drawer.spendCapDesc")}
        >
          <NumberField
            label={t("settings.drawer.spendCapLabel")}
            name="session-spend-cap"
            value={settings.sessionSpendCapUsd ?? 0}
            min={0}
            max={10000}
            fallback={0}
            onChange={(v) => void update({ sessionSpendCapUsd: v })}
          />
        </Row>
      </Section>

      <Section title={t("settings.drawer.autoCompactTitle")}>
        <Row label={t("settings.drawer.autoCompactDesc")}>
          <Toggle
            label={t("settings.drawer.autoCompactDesc")}
            checked={settings.autoCompact.enabled}
            onChange={(v) =>
              void update({
                autoCompact: { ...settings.autoCompact, enabled: v },
              })
            }
          />
        </Row>
        {settings.autoCompact.enabled && (
          <>
            <Row label={t("settings.drawer.triggerPctLabel")}>
              <NumberField
                label={t("settings.drawer.triggerPctLabel")}
                name="auto-compact-trigger"
                value={settings.autoCompact.triggerPct}
                min={20}
                max={95}
                fallback={75}
                onChange={(v) =>
                  void update({ autoCompact: { ...settings.autoCompact, triggerPct: v } })
                }
              />
            </Row>
            <Row label={t("settings.drawer.targetPctLabel")}>
              <NumberField
                label={t("settings.drawer.targetPctLabel")}
                name="auto-compact-target"
                value={settings.autoCompact.targetPct}
                min={10}
                max={80}
                fallback={50}
                onChange={(v) =>
                  void update({ autoCompact: { ...settings.autoCompact, targetPct: v } })
                }
              />
            </Row>
            <Row label={t("settings.drawer.keepLastLabel")}>
              <NumberField
                label={t("settings.drawer.keepLastLabel")}
                name="auto-compact-keep-last"
                value={settings.autoCompact.keepLast}
                min={2}
                max={50}
                fallback={10}
                onChange={(v) =>
                  void update({ autoCompact: { ...settings.autoCompact, keepLast: v } })
                }
              />
            </Row>
            <div className="border-b border-codezal-hair py-3 last:border-b-0">
              <div className="mb-2 text-base font-medium text-codezal-text">
                {t("settings.drawer.compactModelLabel")}
              </div>
              <input
                type="text"
                placeholder={t("settings.drawer.compactModelPlaceholder")}
                value={settings.autoCompact.model ?? ""}
                onChange={(e) => {
                  const v = e.target.value.trim()
                  void update({
                    autoCompact: {
                      ...settings.autoCompact,
                      model: v === "" ? undefined : v,
                    },
                  })
                }}
                className="w-full rounded-md border border-codezal bg-codezal-input px-3 py-2 text-base text-codezal-text outline-none focus:border-codezal-accent"
              />
              <div className="mt-1.5 text-base leading-relaxed text-codezal-mute">
                {t("settings.drawer.compactExplain")}
              </div>
            </div>
          </>
        )}
      </Section>

      <Section title={t("settings.drawer.terminalSectionTitle")}>
        <Row
          label={t("settings.drawer.terminalShortPromptLabel")}
          description={t("settings.drawer.terminalShortPromptDesc")}
        >
          <Toggle
            label={t("settings.drawer.terminalShortPromptLabel")}
            checked={settings.terminalShortPrompt ?? true}
            onChange={(v) => void update({ terminalShortPrompt: v })}
          />
        </Row>
        <Row
          label={t("settings.drawer.terminalRestoreLabel")}
          description={t("settings.drawer.terminalRestoreDesc")}
        >
          <Toggle
            label={t("settings.drawer.terminalRestoreLabel")}
            checked={settings.terminalRestore ?? true}
            onChange={(v) => void update({ terminalRestore: v })}
          />
        </Row>
      </Section>

      <Section title={t("settings.drawer.agentSectionTitle")}>
        <Row
          label={t("settings.drawer.narrateProgressLabel")}
          description={t("settings.drawer.narrateProgressDesc")}
        >
          <Toggle
            label={t("settings.drawer.narrateProgressLabel")}
            checked={settings.narrateProgress ?? true}
            onChange={(v) => void update({ narrateProgress: v })}
          />
        </Row>
        <Row
          label={t("settings.drawer.vimModeLabel")}
          description={t("settings.drawer.vimModeDesc")}
        >
          <Toggle
            label={t("settings.drawer.vimModeLabel")}
            checked={settings.vimMode ?? false}
            onChange={(v) => void update({ vimMode: v })}
          />
        </Row>
        <Row
          label={t("settings.drawer.autoFormatLabel")}
          description={t("settings.drawer.autoFormatDesc")}
        >
          <Toggle
            label={t("settings.drawer.autoFormatLabel")}
            checked={settings.autoLintOnEdit ?? true}
            onChange={(v) => void update({ autoLintOnEdit: v })}
          />
        </Row>
        <Row
          label={t("settings.drawer.securityScanLabel")}
          description={t("settings.drawer.securityScanDesc")}
        >
          <Toggle
            label={t("settings.drawer.securityScanLabel")}
            checked={settings.securityScan ?? true}
            onChange={(v) => void update({ securityScan: v })}
          />
        </Row>
        <Row
          label={t("settings.drawer.crashReportingLabel")}
          description={t("settings.drawer.crashReportingDesc")}
        >
          <Toggle
            label={t("settings.drawer.crashReportingLabel")}
            checked={settings.crashReporting ?? true}
            onChange={(v) => void update({ crashReporting: v })}
          />
        </Row>
      </Section>
    </div>
  )
}

function DefaultProviderModelSelector() {
  const t = useT()
  const settings = useSettingsStore((s) => s.settings)
  const update = useSettingsStore((s) => s.update)
  const catalog = settings.providerCatalog?.data as ProvidersCatalog | undefined

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const adapters = useMemo(() => listProviderAdapters(catalog), [catalog, settings.customProviders])
  // Env fallback counts as connected — probe so env-bound providers appear.
  const [envHits, setEnvHits] = useState<Record<string, boolean>>({})
  useEffect(() => {
    const unique = Array.from(new Set(adapters.flatMap((p) => p.envVars)))
    if (unique.length === 0) return
    let alive = true
    void probeEnvVars(unique).then((r) => {
      if (alive) setEnvHits(r)
    })
    return () => {
      alive = false
    }
  }, [adapters, settings.envFallback])
  const connected = [
    ...adapters
      .filter((p) => isConnectedSync(p, settings, envHits))
      .sort((a, b) => {
        if (Boolean(a.popular) !== Boolean(b.popular)) return a.popular ? -1 : 1
        return a.label.localeCompare(b.label)
      }),
    ...listVisibleAgentProviders(settings),
  ]

  function modelsForDefault(providerId: ProviderId): string[] {
    if (isCliAgentProvider(providerId)) return modelsForAgentProvider(providerId, settings)
    return modelsFor(providerId, catalog, settings.modelStatus)
  }

  function defaultModelForDefault(providerId: ProviderId): string {
    if (isCliAgentProvider(providerId)) return defaultModelForAgentProvider(providerId, settings)
    return defaultModelFor(providerId, catalog)
  }

  function displayName(providerId: ProviderId, modelId: string): string {
    if (isCliAgentProvider(providerId)) return modelId
    return modelDetail(catalog, providerId, modelId)?.name?.trim() || modelId
  }

  if (connected.length === 0) {
    return (
      <p className="text-base text-codezal-mute">
        {t("composer.noProvidersConnected")}
      </p>
    )
  }

  const currentId = settings.defaultProvider
  // Active provider may no longer be connected (user disconnected it). Fall
  // back to the first connected entry so the dropdowns always have a valid
  // selection.
  const activeProvider = connected.find((p) => p.id === currentId) ?? connected[0]
  const models = modelsForDefault(activeProvider.id)
  const currentModel = models.includes(settings.defaultModel)
    ? settings.defaultModel
    : defaultModelForDefault(activeProvider.id)

  return (
    <div className="grid grid-cols-2 gap-2">
      <Select
        value={activeProvider.id}
        onChange={(id) =>
          void update({
            defaultProvider: id as ProviderId,
            defaultModel: defaultModelForDefault(id as ProviderId),
          })
        }
        options={connected.map((p) => ({ value: p.id, label: p.label }))}
      />
      <Select
        value={currentModel}
        onChange={(m) => void update({ defaultModel: m })}
        options={models.map((m) => ({
          value: m,
          label: displayName(activeProvider.id, m),
        }))}
      />
    </div>
  )
}
