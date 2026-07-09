import { useEffect, useRef, useState } from "react"
import { ArrowDown, ArrowUp, RefreshCcw } from "@/lib/icons"
import {
  CLI_AGENT_PROVIDERS,
  agentProviderSettings,
  defaultAgentProvidersSettings,
  isCliAgentProvider,
  type AgentRuntimeDiagnostic,
  type CliAgentModel,
  type CliAgentProviderId,
  type CliAgentProviderSettings,
} from "@/lib/agent-providers"
import { getAgentRuntimeClient } from "@/lib/agent-providers/runtime-client"
import { db, listSessionUsage } from "@/lib/db"
import { errorMessage } from "@/lib/errors"
import { formatCount } from "@/lib/format"
import { useT } from "@/lib/i18n/useT"
import { rowTokens, type SessionUsageRow } from "@/lib/stats"
import { useSettingsStore } from "@/store/settings"
import { cn } from "@/lib/utils"
import { Row, Section, Toggle } from "./primitives"

function envToText(env?: Record<string, string>): string {
  return Object.entries(env ?? {})
    .map(([key, value]) => `${key}=${value}`)
    .join("\n")
}

function parseEnvText(text: string): Record<string, string> | undefined {
  const env: Record<string, string> = {}
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith("#")) continue
    const eq = line.indexOf("=")
    if (eq <= 0) continue
    const key = line.slice(0, eq).trim()
    const value = line.slice(eq + 1)
    if (key) env[key] = value
  }
  return Object.keys(env).length ? env : undefined
}

type AgentUsageSummary = {
  sessions: number
  turns: number
  totalTokens: number
  inputTokens: number
  outputTokens: number
  reasoningTokens: number
  costUsd: number
}

function emptyUsage(): AgentUsageSummary {
  return {
    sessions: 0,
    turns: 0,
    totalTokens: 0,
    inputTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
    costUsd: 0,
  }
}

function summarizeCliUsage(rows: SessionUsageRow[]): Record<CliAgentProviderId, AgentUsageSummary> {
  const out: Record<CliAgentProviderId, AgentUsageSummary> = {
    "codex-cli": emptyUsage(),
    "claude-cli": emptyUsage(),
  }
  for (const row of rows) {
    if (!isCliAgentProvider(row.provider)) continue
    const summary = out[row.provider]
    summary.sessions += 1
    summary.turns += row.turns
    summary.totalTokens += rowTokens(row)
    summary.inputTokens += row.inputTokens
    summary.outputTokens += row.outputTokens
    summary.reasoningTokens += row.reasoningTokens
    summary.costUsd += row.costUsd
  }
  return out
}

function formatCost(cost: number): string {
  if (cost <= 0) return "$0"
  if (cost < 1) return `$${cost.toFixed(4)}`
  return `$${cost.toFixed(2)}`
}

function formatFetchedAt(value?: number): string {
  if (!value) return ""
  return new Date(value).toLocaleString()
}

function providerPatch(
  current: CliAgentProviderSettings | undefined,
  patch: Partial<CliAgentProviderSettings>,
): CliAgentProviderSettings {
  return { ...(current ?? {}), ...patch }
}

function StatusLine({
  stored,
  diagnostic,
  error,
  busy,
}: {
  stored: CliAgentProviderSettings
  diagnostic?: AgentRuntimeDiagnostic
  error?: string
  busy?: boolean
}) {
  const t = useT()
  const modelCount = stored.discoveredModels?.length ?? 0
  if (busy) return <span className="text-sm text-codezal-mute">{t("settings.cliAgents.loading")}</span>
  if (error) return <span className="text-sm text-destructive">{error}</span>
  if (diagnostic?.exists === false || stored.lastStatus === "missing") {
    return <span className="text-sm text-destructive">{t("settings.cliAgents.missing")}</span>
  }
  if (stored.lastStatus === "error") {
    return <span className="text-sm text-destructive">{stored.lastError ?? t("settings.cliAgents.error")}</span>
  }
  if (!diagnostic && stored.lastError) {
    return <span className="text-sm text-destructive">{stored.lastError}</span>
  }
  const available = diagnostic?.exists === true || stored.lastStatus === "available"
  if (!available && modelCount > 0) {
    return (
      <span className="text-sm text-codezal-mute">
        {t("settings.cliAgents.cachedWithModels", { count: modelCount })}
      </span>
    )
  }
  if (!available) {
    return <span className="text-sm text-codezal-mute">{t("settings.cliAgents.notChecked")}</span>
  }
  const version = diagnostic?.version ?? stored.lastVersion ?? "?"
  const sdk =
    !diagnostic || diagnostic.sdk === null
      ? ""
      : diagnostic.sdk
        ? ` · ${t("settings.cliAgents.sdkOk")}`
        : ` · ${t("settings.cliAgents.sdkFailed")}: ${diagnostic.sdkError ?? ""}`
  return (
    <span className="text-sm text-codezal-mute">
      {modelCount > 0
        ? t("settings.cliAgents.availableWithModels", { version, count: modelCount })
        : t("settings.cliAgents.available", { version })}
      {sdk}
    </span>
  )
}

export function CliAgentsTab() {
  const t = useT()
  const settings = useSettingsStore((s) => s.settings)
  const update = useSettingsStore((s) => s.update)
  const [diagnostics, setDiagnostics] = useState<
    Partial<Record<CliAgentProviderId, AgentRuntimeDiagnostic>>
  >({})
  const [errors, setErrors] = useState<Partial<Record<CliAgentProviderId, string>>>({})
  const [busy, setBusy] = useState<Partial<Record<CliAgentProviderId, boolean>>>({})
  const [usage, setUsage] = useState<Record<CliAgentProviderId, AgentUsageSummary>>(() =>
    summarizeCliUsage([]),
  )
  const [usageLoading, setUsageLoading] = useState(true)
  const autoRefreshStarted = useRef(false)
  const current = settings.agentProviders ?? defaultAgentProvidersSettings()
  const orderedProviders = [...CLI_AGENT_PROVIDERS].sort((a, b) => {
    const aa = agentProviderSettings(settings, a.id).order ?? 0
    const bb = agentProviderSettings(settings, b.id).order ?? 0
    return aa - bb
  })

  async function mergeProviderPatch(
    id: CliAgentProviderId,
    next: Partial<CliAgentProviderSettings>,
  ) {
    const liveSettings = useSettingsStore.getState().settings
    const liveCurrent = liveSettings.agentProviders ?? defaultAgentProvidersSettings()
    await update({
      agentProviders: {
        ...liveCurrent,
        [id]: providerPatch(liveCurrent[id], next),
      },
    })
  }

  function patch(id: CliAgentProviderId, next: Partial<CliAgentProviderSettings>) {
    void mergeProviderPatch(id, next)
  }

  function move(id: CliAgentProviderId, dir: -1 | 1) {
    const ordered = [...CLI_AGENT_PROVIDERS].sort((a, b) => {
      const aa = agentProviderSettings(settings, a.id).order ?? 0
      const bb = agentProviderSettings(settings, b.id).order ?? 0
      return aa - bb
    })
    const index = ordered.findIndex((p) => p.id === id)
    const swap = index + dir
    if (index < 0 || swap < 0 || swap >= ordered.length) return
    const next = { ...current }
    for (const [order, provider] of ordered.entries()) {
      next[provider.id] = { ...(next[provider.id] ?? {}), order }
    }
    const a = ordered[index]
    const b = ordered[swap]
    next[a.id] = { ...(next[a.id] ?? {}), order: swap }
    next[b.id] = { ...(next[b.id] ?? {}), order: index }
    void update({ agentProviders: next })
  }

  async function refreshProvider(id: CliAgentProviderId) {
    setBusy((s) => ({ ...s, [id]: true }))
    setErrors((s) => ({ ...s, [id]: undefined }))
    try {
      const liveSettings = useSettingsStore.getState().settings
      const providerSettings = agentProviderSettings(liveSettings, id)
      const client = getAgentRuntimeClient()
      const result = await client.diagnose(id, providerSettings)
      setDiagnostics((s) => ({ ...s, [id]: result }))
      let models: CliAgentModel[] | undefined
      let listError: string | undefined
      if (result.exists) {
        try {
          models = await client.listModels(id, providerSettings)
        } catch (error) {
          listError = errorMessage(error)
          setErrors((s) => ({ ...s, [id]: listError }))
        }
      }
      await mergeProviderPatch(id, {
        lastStatus: result.exists ? "available" : "missing",
        lastVersion: result.version ?? undefined,
        lastError: listError,
        lastCheckedAt: Date.now(),
        ...(models ? { discoveredModels: models, modelsFetchedAt: Date.now() } : {}),
      })
    } catch (error) {
      const message = errorMessage(error)
      setErrors((s) => ({ ...s, [id]: message }))
      await mergeProviderPatch(id, {
        lastStatus: "error",
        lastError: message,
        lastCheckedAt: Date.now(),
      })
    } finally {
      setBusy((s) => ({ ...s, [id]: false }))
    }
  }

  async function refreshUsage() {
    setUsageLoading(true)
    try {
      setUsage(summarizeCliUsage(await listSessionUsage(db)))
    } catch (error) {
      console.error("[cli-agents] usage aggregation failed:", error)
      setUsage(summarizeCliUsage([]))
    } finally {
      setUsageLoading(false)
    }
  }

  useEffect(() => {
    if (autoRefreshStarted.current) return
    autoRefreshStarted.current = true
    const timer = window.setTimeout(() => {
      for (const provider of CLI_AGENT_PROVIDERS) void refreshProvider(provider.id)
      void refreshUsage()
    }, 0)
    return () => window.clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="space-y-6">
      <Section title={t("settings.cliAgents.title")} description={t("settings.cliAgents.description")}>
        {orderedProviders.map((provider, index) => {
          const stored = agentProviderSettings(settings, provider.id)
          const customModels = stored.models?.join("\n") ?? ""
          return (
            <div key={provider.id} className="border-b border-codezal-hair py-3 last:border-b-0">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div>
                  <h4 className="text-md font-semibold text-codezal-text">{provider.label}</h4>
                  <StatusLine
                    stored={stored}
                    diagnostic={diagnostics[provider.id]}
                    error={errors[provider.id]}
                    busy={busy[provider.id]}
                  />
                </div>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => move(provider.id, -1)}
                    disabled={index === 0}
                    title={t("settings.cliAgents.moveUp")}
                    className="flex h-8 w-8 items-center justify-center rounded-md border border-codezal text-codezal-dim hover:bg-codezal-panel-2 disabled:opacity-40"
                  >
                    <ArrowUp className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => move(provider.id, 1)}
                    disabled={index === orderedProviders.length - 1}
                    title={t("settings.cliAgents.moveDown")}
                    className="flex h-8 w-8 items-center justify-center rounded-md border border-codezal text-codezal-dim hover:bg-codezal-panel-2 disabled:opacity-40"
                  >
                    <ArrowDown className="h-4 w-4" />
                  </button>
                  <Toggle
                    label={t("settings.cliAgents.visible")}
                    checked={stored.enabled !== false}
                    onChange={(enabled) => patch(provider.id, { enabled })}
                  />
                </div>
              </div>
              <div className="space-y-3">
                <Row label={t("settings.cliAgents.command")} description={provider.defaultCommand}>
                  <input
                    value={stored.command ?? ""}
                    onChange={(e) => patch(provider.id, { command: e.target.value.trim() || undefined })}
                    placeholder={provider.defaultCommand}
                    className="w-72 rounded-md border border-codezal bg-codezal-input px-2 py-1 text-md text-codezal-text outline-none focus:border-codezal-strong"
                  />
                </Row>
                <Row
                  label={t("settings.cliAgents.injectTools")}
                  description={t("settings.cliAgents.injectToolsDesc")}
                >
                  <Toggle
                    label={t("settings.cliAgents.injectTools")}
                    checked={stored.injectCodezalTools !== false}
                    onChange={(injectCodezalTools) => patch(provider.id, { injectCodezalTools })}
                  />
                </Row>
                <Row label={t("settings.cliAgents.models")} description={t("settings.cliAgents.modelsDesc")}>
                  <textarea
                    value={customModels}
                    onChange={(e) =>
                      patch(provider.id, {
                        models: e.target.value
                          .split(/\r?\n/)
                          .map((m) => m.trim())
                          .filter(Boolean),
                      })
                    }
                    placeholder={provider.fallbackModels.join("\n")}
                    rows={3}
                    className="w-72 resize-y rounded-md border border-codezal bg-codezal-input px-2 py-1 text-md text-codezal-text outline-none focus:border-codezal-strong"
                  />
                </Row>
                <Row
                  label={t("settings.cliAgents.discoveredModels")}
                  description={
                    stored.modelsFetchedAt
                      ? t("settings.cliAgents.updatedAt", { time: formatFetchedAt(stored.modelsFetchedAt) })
                      : t("settings.cliAgents.discoveredModelsDesc")
                  }
                >
                  <DiscoveredModels models={stored.discoveredModels ?? []} />
                </Row>
                <Row label={t("settings.cliAgents.env")} description={t("settings.cliAgents.envDesc")}>
                  <textarea
                    value={envToText(stored.env)}
                    onChange={(e) => patch(provider.id, { env: parseEnvText(e.target.value) })}
                    placeholder="CODEZAL_EXAMPLE=1"
                    rows={3}
                    className="w-72 resize-y rounded-md border border-codezal bg-codezal-input px-2 py-1 font-mono text-sm text-codezal-text outline-none focus:border-codezal-strong"
                  />
                </Row>
                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={() => void refreshProvider(provider.id)}
                    disabled={busy[provider.id]}
                    className={cn(
                      "inline-flex items-center gap-2 rounded-md border border-codezal px-3 py-1.5 text-md text-codezal-text hover:bg-codezal-panel-2",
                      busy[provider.id] && "opacity-60",
                    )}
                  >
                    <RefreshCcw className={cn("h-4 w-4", busy[provider.id] && "animate-spin")} />
                    {t("settings.cliAgents.refresh")}
                  </button>
                </div>
              </div>
            </div>
          )
        })}
      </Section>
      <CliAgentUsageSection usage={usage} loading={usageLoading} onRefresh={() => void refreshUsage()} />
    </div>
  )
}

function DiscoveredModels({ models }: { models: CliAgentModel[] }) {
  const t = useT()
  if (models.length === 0) {
    return (
      <div className="w-72 rounded-md border border-codezal bg-codezal-panel px-3 py-2 text-sm text-codezal-mute">
        {t("settings.cliAgents.noDiscoveredModels")}
      </div>
    )
  }
  return (
    <div className="w-72 overflow-hidden rounded-md border border-codezal bg-codezal-panel">
      {models.slice(0, 6).map((model) => (
        <div key={model.id} className="border-b border-codezal-hair px-3 py-2 last:border-b-0">
          <div className="flex min-w-0 items-baseline gap-2">
            <span className="truncate text-md font-medium text-codezal-text" title={model.label ?? model.id}>
              {model.label ?? model.id}
            </span>
            <span className="shrink-0 font-mono text-sm text-codezal-mute">{model.id}</span>
          </div>
          {model.description && (
            <div className="mt-0.5 truncate text-sm text-codezal-mute" title={model.description}>
              {model.description}
            </div>
          )}
        </div>
      ))}
      {models.length > 6 && (
        <div className="px-3 py-2 text-sm text-codezal-mute">
          {t("settings.cliAgents.moreModels", { count: models.length - 6 })}
        </div>
      )}
    </div>
  )
}

function CliAgentUsageSection({
  usage,
  loading,
  onRefresh,
}: {
  usage: Record<CliAgentProviderId, AgentUsageSummary>
  loading: boolean
  onRefresh: () => void
}) {
  const t = useT()
  return (
    <Section title={t("settings.cliAgents.usageTitle")} description={t("settings.cliAgents.usageDesc")}>
      <div className="mb-3 flex justify-end">
        <button
          type="button"
          onClick={onRefresh}
          disabled={loading}
          className={cn(
            "inline-flex items-center gap-2 rounded-md border border-codezal px-3 py-1.5 text-md text-codezal-text hover:bg-codezal-panel-2",
            loading && "opacity-60",
          )}
        >
          <RefreshCcw className={cn("h-4 w-4", loading && "animate-spin")} />
          {t("settings.cliAgents.usageRefresh")}
        </button>
      </div>
      <div className="overflow-hidden rounded-md border border-codezal">
        {CLI_AGENT_PROVIDERS.map((provider) => (
          <UsageRow key={provider.id} label={provider.label} summary={usage[provider.id]} />
        ))}
      </div>
    </Section>
  )
}

function UsageRow({ label, summary }: { label: string; summary: AgentUsageSummary }) {
  const t = useT()
  const hasUsage = summary.sessions > 0 || summary.turns > 0 || summary.totalTokens > 0
  return (
    <div className="border-b border-codezal-hair px-4 py-3 last:border-b-0">
      <div className="mb-2 flex items-center justify-between gap-3">
        <div className="text-md font-semibold text-codezal-text">{label}</div>
        {!hasUsage && <div className="text-sm text-codezal-mute">{t("settings.cliAgents.usageEmpty")}</div>}
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        <UsageMetric label={t("settings.cliAgents.usageTurns")} value={formatCount(summary.turns)} />
        <UsageMetric label={t("settings.cliAgents.usageInput")} value={formatCount(summary.inputTokens)} />
        <UsageMetric label={t("settings.cliAgents.usageOutput")} value={formatCount(summary.outputTokens)} />
        <UsageMetric label={t("settings.cliAgents.usageReasoning")} value={formatCount(summary.reasoningTokens)} />
        <UsageMetric label={t("settings.cliAgents.usageCost")} value={formatCost(summary.costUsd)} />
      </div>
    </div>
  )
}

function UsageMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-codezal-panel px-3 py-2">
      <div className="truncate text-sm text-codezal-mute">{label}</div>
      <div className="mt-0.5 truncate text-md font-medium tabular-nums text-codezal-text" title={value}>
        {value}
      </div>
    </div>
  )
}
