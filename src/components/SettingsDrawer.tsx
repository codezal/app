// Settings — full-page view with sidebar tabs (General, API, Approval, …, About).
// Esc / back button returns to chat.
import { useEffect, useState } from "react"
import {
  ArrowLeft,
  Check,
  ChevronDown,
  ChevronRight,
  Cog,
  Info,
  KeyRound,
  Plug,
  Plus,
  Puzzle,
  RefreshCcw,
  ShieldCheck,
  Sparkles,
  Palette,
  Trash2,
  Webhook,
  X,
  Coins,
} from "lucide-react"
import { PROVIDERS, type ProviderId } from "@/lib/providers"
import { useSettingsStore } from "@/store/settings"
import { useSessionsStore } from "@/store/sessions"
import { listMcpStatus, parseMcpServersJson, type McpServerConfig, type McpStatus } from "@/lib/mcp"
import { buildIndex, loadIndex, type BuildProgress } from "@/lib/semantic-index"
import { cn } from "@/lib/utils"
import type { FontScale } from "@/lib/theme"
import { LOCALES, type Locale } from "@/lib/i18n"
import { useT } from "@/lib/i18n/useT"
import { PluginsTab } from "./PluginsTab"
import { TokenSavingTab } from "./settings/TokenSavingTab"
import { DEFAULT_APPEARANCE, type Appearance, type DiffStyle, type ReduceMotion } from "@/lib/theme"
import {
  BUILTIN_PRESETS,
  PICKABLE_TOKENS,
  presetsForMode,
  type ThemePreset,
  type ThemeTokens,
  type ThemeMode,
} from "@/lib/theme-presets"
import { loadUserThemes, presetToJson, jsonToPreset, saveUserTheme } from "@/lib/theme-loader"
import { hslToHex, hexToHsl } from "@/lib/color-utils"

type Props = {
  onClose: () => void
}

type Tab = "genel" | "gorunum" | "api" | "onay" | "mcp" | "hooks" | "semantic" | "tokens" | "eklentiler" | "hakkinda"

export function SettingsPage({ onClose }: Props) {
  const t = useT()
  const [tab, setTab] = useState<Tab>("genel")

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onClose])

  const tokensLabelRaw = t("settings.tabs.tokens")
  const tokensLabel = tokensLabelRaw === "settings.tabs.tokens" ? "Token Saving" : tokensLabelRaw
  const tabs: { id: Tab; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
    { id: "genel", label: t("settings.tabs.general"), icon: Cog },
    { id: "gorunum", label: t("settings.tabs.appearance"), icon: Palette },
    { id: "api", label: t("settings.tabs.api"), icon: KeyRound },
    { id: "onay", label: t("settings.tabs.approval"), icon: ShieldCheck },
    { id: "mcp", label: t("settings.tabs.mcp"), icon: Plug },
    { id: "hooks", label: t("settings.tabs.hooks"), icon: Webhook },
    { id: "semantic", label: t("settings.tabs.semantic"), icon: Sparkles },
    { id: "tokens", label: tokensLabel, icon: Coins },
    { id: "eklentiler", label: t("settings.tabs.plugins"), icon: Puzzle },
    { id: "hakkinda", label: t("settings.tabs.about"), icon: Info },
  ]

  const activeLabel = tabs.find((tt) => tt.id === tab)?.label ?? ""

  return (
    <div className="flex min-h-0 flex-1 bg-codezal-bg">
      {/* Left nav */}
      <nav className="w-[200px] shrink-0 overflow-y-auto border-r border-codezal bg-codezal-sidebar p-3">
        <button
          type="button"
          onClick={onClose}
          title="Back (Esc)"
          className="mb-3 flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12.5px] text-codezal-dim hover:bg-codezal-panel-2 hover:text-codezal-text"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          <span>Back</span>
        </button>
        {tabs.map((tt) => {
          const Icon = tt.icon
          return (
            <button
              key={tt.id}
              type="button"
              onClick={() => setTab(tt.id)}
              className={cn(
                "mb-1 flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12.5px]",
                tab === tt.id
                  ? "bg-codezal-chip text-codezal-text"
                  : "text-codezal-dim hover:bg-codezal-panel-2 hover:text-codezal-text",
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              {tt.label}
            </button>
          )
        })}
      </nav>

      {/* Right content */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex shrink-0 items-center gap-3 border-b border-codezal bg-codezal-panel px-6 py-3">
          <h2 className="text-[14px] font-semibold text-codezal-text">{t("settings.drawer.headerPrefix", { tab: activeLabel })}</h2>
        </header>

        <div className="flex-1 overflow-y-auto">
          <div className="mx-auto max-w-3xl px-6 py-6">
            {tab === "genel" && <GeneralTab />}
            {tab === "gorunum" && <AppearanceTab />}
            {tab === "api" && <ApiTab />}
            {tab === "onay" && <ApprovalTab />}
            {tab === "mcp" && <McpTab />}
            {tab === "hooks" && <HooksTab />}
            {tab === "semantic" && <SemanticTab />}
            {tab === "tokens" && <TokenSavingTab />}
            {tab === "eklentiler" && <PluginsTab />}
            {tab === "hakkinda" && <AboutTab />}
          </div>
        </div>
      </div>
    </div>
  )
}

function GeneralTab() {
  const settings = useSettingsStore((s) => s.settings)
  const update = useSettingsStore((s) => s.update)
  const t = useT()

  return (
    <div className="space-y-5">
      <Section title={t("settings.general.language")}>
        <select
          value={settings.language ?? "tr"}
          onChange={(e) => void update({ language: e.target.value as Locale })}
          className="codezal-select"
        >
          {LOCALES.map((l) => (
            <option key={l.code} value={l.code}>
              {l.nativeName}
            </option>
          ))}
        </select>
        <p className="mt-2 text-[11px] text-codezal-mute">
          {t("settings.general.languageDesc")}
        </p>
      </Section>

      <Section title={t("settings.drawer.defaultProviderModelTitle")}>
        <div className="grid grid-cols-2 gap-2">
          <select
            value={settings.defaultProvider}
            onChange={(e) => {
              const id = e.target.value as ProviderId
              void update({
                defaultProvider: id,
                defaultModel: PROVIDERS[id].defaultModel,
              })
            }}
            className="codezal-select"
          >
            {Object.values(PROVIDERS).map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
          <select
            value={settings.defaultModel}
            onChange={(e) => void update({ defaultModel: e.target.value })}
            className="codezal-select"
          >
            {PROVIDERS[settings.defaultProvider].models.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </div>
        <p className="mt-2 text-[11px] text-codezal-mute">
          {t("settings.drawer.defaultProviderModelHint")}
        </p>
      </Section>

      <Section title={t("settings.drawer.defaultWorkspaceTitle")}>
        <div className="rounded-md border border-codezal bg-codezal-input px-2 py-1.5 text-[12px] text-codezal-text">
          {settings.defaultWorkspacePath ?? t("settings.drawer.defaultWorkspaceUnbound")}
        </div>
        <p className="mt-1 text-[11px] text-codezal-mute">
          {t("settings.drawer.defaultWorkspaceHint")}
        </p>
      </Section>

      <Section title={t("settings.drawer.autoCompactTitle")}>
        <label className="flex items-center gap-2 text-[12px]">
          <input
            type="checkbox"
            checked={settings.autoCompact.enabled}
            onChange={(e) =>
              void update({
                autoCompact: { ...settings.autoCompact, enabled: e.target.checked },
              })
            }
          />
          <span className="text-codezal-text">
            {t("settings.drawer.autoCompactDesc")}
          </span>
        </label>

        <div className="mt-3 grid grid-cols-3 gap-3 text-[11.5px]">
          <label className="flex flex-col gap-1">
            <span className="text-codezal-dim">{t("settings.drawer.triggerPctLabel")}</span>
            <input
              type="number"
              min={20}
              max={95}
              value={settings.autoCompact.triggerPct}
              onChange={(e) => {
                const v = Math.max(20, Math.min(95, Number(e.target.value) || 75))
                void update({
                  autoCompact: { ...settings.autoCompact, triggerPct: v },
                })
              }}
              className="rounded-md border border-codezal bg-codezal-input px-2 py-1 text-codezal-text outline-none focus:border-codezal-accent"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-codezal-dim">{t("settings.drawer.targetPctLabel")}</span>
            <input
              type="number"
              min={10}
              max={80}
              value={settings.autoCompact.targetPct}
              onChange={(e) => {
                const v = Math.max(10, Math.min(80, Number(e.target.value) || 50))
                void update({
                  autoCompact: { ...settings.autoCompact, targetPct: v },
                })
              }}
              className="rounded-md border border-codezal bg-codezal-input px-2 py-1 text-codezal-text outline-none focus:border-codezal-accent"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-codezal-dim">{t("settings.drawer.keepLastLabel")}</span>
            <input
              type="number"
              min={2}
              max={50}
              value={settings.autoCompact.keepLast}
              onChange={(e) => {
                const v = Math.max(2, Math.min(50, Number(e.target.value) || 10))
                void update({
                  autoCompact: { ...settings.autoCompact, keepLast: v },
                })
              }}
              className="rounded-md border border-codezal bg-codezal-input px-2 py-1 text-codezal-text outline-none focus:border-codezal-accent"
            />
          </label>
        </div>

        <label className="mt-3 flex flex-col gap-1 text-[12px]">
          <span className="text-codezal-dim">
            {t("settings.drawer.compactModelLabel")}
          </span>
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
            className="rounded-md border border-codezal bg-codezal-input px-2 py-1.5 text-[12px] text-codezal-text outline-none focus:border-codezal-accent"
          />
        </label>

        <p className="mt-2 text-[11px] text-codezal-mute">
          {t("settings.drawer.compactExplain")}
        </p>
      </Section>
    </div>
  )
}

function ApiTab() {
  const t = useT()
  const settings = useSettingsStore((s) => s.settings)
  const setApiKey = useSettingsStore((s) => s.setApiKey)

  return (
    <div className="space-y-4">
      <Section title={t("settings.drawer.apiKeysTitle")}>
        <div className="grid grid-cols-1 gap-2">
          {Object.values(PROVIDERS).map((p) => (
            <label key={p.id} className="flex flex-col gap-1 text-[12px]">
              <span className="text-codezal-dim">{p.label}</span>
              <input
                type="password"
                placeholder={p.id === "openai" ? "sk-..." : t("settings.drawer.keyPlaceholder")}
                value={settings.apiKeys[p.id] ?? ""}
                onChange={(e) => void setApiKey(p.id, e.target.value)}
                className="rounded-md border border-codezal bg-codezal-input px-2 py-1.5 text-codezal-text outline-none focus:border-codezal-accent"
              />
            </label>
          ))}
        </div>
      </Section>
      <p className="text-[11px] text-codezal-mute">
        {t("settings.drawer.keysHint")}
      </p>
      <ProviderCatalogSection />
    </div>
  )
}

function ProviderCatalogSection() {
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
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setRefreshing(false)
    }
  }

  return (
    <Section title={t("settings.drawer.catalogTitle")}>
      <div className="flex items-center justify-between gap-2 text-[12px]">
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
          className="rounded-md border border-codezal px-2.5 py-1 text-[12px] text-codezal-dim hover:border-codezal-strong hover:text-codezal-text disabled:opacity-50"
        >
          {refreshing ? t("settings.drawer.catalogRefreshing") : t("settings.drawer.catalogRefresh")}
        </button>
      </div>
      {error && <p className="mt-1.5 text-[11px] text-destructive">{t("settings.drawer.catalogErrorLabel")} {error}</p>}
    </Section>
  )
}

function countModels(data: Record<string, unknown>): number {
  let n = 0
  for (const id of ["openai", "anthropic", "google", "deepseek"]) {
    const p = data[id] as { models?: Record<string, unknown> } | undefined
    if (p?.models) n += Object.keys(p.models).length
  }
  return n
}

function ApprovalTab() {
  const t = useT()
  const settings = useSettingsStore((s) => s.settings)
  const update = useSettingsStore((s) => s.update)

  function removeRule(idx: number) {
    const next = settings.approvalRules.filter((_, i) => i !== idx)
    void update({ approvalRules: next })
  }

  return (
    <div className="space-y-5">
      <Section title={t("settings.drawer.modeTitle")}>
        <div className="flex flex-wrap items-center gap-1.5">
          {(
            [
              { v: "ask", label: t("composer.approvalAsk") },
              { v: "auto-review", label: t("composer.approvalAutoReview") },
              { v: "bypass", label: t("composer.approvalBypass") },
            ] as const
          ).map(({ v, label }) => (
            <button
              key={v}
              type="button"
              onClick={() => void update({ approvalMode: v })}
              className={cn(
                "flex h-7 items-center gap-1.5 rounded-md border px-2.5 text-[12px]",
                settings.approvalMode === v
                  ? "border-codezal-accent text-codezal-accent"
                  : "border-codezal text-codezal-dim hover:border-codezal-strong",
              )}
            >
              {label}
            </button>
          ))}
        </div>
        <p className="mt-2 text-[11px] text-codezal-mute">
          {t("settings.drawer.modeHint")}
        </p>
      </Section>

      <Section title={t("settings.drawer.savedRulesTitle")}>
        {settings.approvalRules.length === 0 ? (
          <div className="rounded-md border border-dashed border-codezal px-3 py-4 text-center text-[12px] text-codezal-mute">
            {t("settings.drawer.noRulesHint")}
          </div>
        ) : (
          <ul className="flex flex-col gap-1">
            {settings.approvalRules.map((r, i) => (
              <li
                key={i}
                className="flex items-center gap-2 rounded-md border border-codezal bg-codezal-input/40 px-2 py-1.5 text-[12px]"
              >
                <span
                  className={cn(
                    "rounded px-1.5 py-0.5 text-[10.5px] font-medium",
                    r.decision === "allow"
                      ? "bg-codezal-accent-dim text-codezal-accent"
                      : "bg-destructive/15 text-destructive",
                  )}
                >
                  {r.decision === "allow" ? t("settings.drawer.ruleAllow") : t("settings.drawer.ruleDeny")}
                </span>
                <span className="font-mono text-codezal-text">{r.tool}</span>
                {r.pattern && (
                  <span className="truncate font-mono text-[11px] text-codezal-dim">
                    · {r.pattern}
                  </span>
                )}
                <div className="flex-1" />
                <button
                  type="button"
                  onClick={() => removeRule(i)}
                  className="rounded p-1 text-codezal-mute hover:text-destructive"
                  title={t("settings.drawer.ruleDeleteTitle")}
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  )
}

// Yeni MCP entry için benzersiz isim üret — "yeni", "yeni-2", ...
function uniqueName(servers: McpServerConfig[], base: string): string {
  const taken = new Set(servers.map((s) => s.name))
  if (!taken.has(base)) return base
  let i = 2
  while (taken.has(`${base}-${i}`)) i++
  return `${base}-${i}`
}

function McpTab() {
  const t = useT()
  const settings = useSettingsStore((s) => s.settings)
  const update = useSettingsStore((s) => s.update)
  const servers = settings.mcpServers ?? []
  const [statuses, setStatuses] = useState<McpStatus[]>([])
  const [testing, setTesting] = useState(false)
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [importOpen, setImportOpen] = useState(false)

  function applyImport(parsed: McpServerConfig[], mode: "merge" | "replace") {
    const next =
      mode === "replace"
        ? parsed
        : (() => {
            // Aynı isimli mevcut entry override edilir, yenileri eklenir
            const byName = new Map<string, McpServerConfig>()
            for (const s of servers) byName.set(s.name, s)
            for (const s of parsed) byName.set(s.name, s)
            return Array.from(byName.values())
          })()
    void update({ mcpServers: next })
    setImportOpen(false)
  }

  // Duplicate ad tespiti — model'e expose edilirken aynı isim çakışıp tool'ları override eder
  const nameCounts = servers.reduce<Record<string, number>>((acc, s) => {
    if (s.name) acc[s.name] = (acc[s.name] ?? 0) + 1
    return acc
  }, {})

  function patchAt(idx: number, patch: Partial<McpServerConfig>) {
    const next = servers.map((s, i) => (i === idx ? { ...s, ...patch } : s))
    void update({ mcpServers: next })
  }
  function removeAt(idx: number) {
    void update({ mcpServers: servers.filter((_, i) => i !== idx) })
  }
  function addNew() {
    const next: McpServerConfig[] = [
      ...servers,
      { name: uniqueName(servers, "yeni"), url: "", transport: "http", enabled: true },
    ]
    void update({ mcpServers: next })
  }
  function addStdio() {
    const next: McpServerConfig[] = [
      ...servers,
      {
        name: uniqueName(servers, "yeni-stdio"),
        url: "",
        transport: "stdio",
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-filesystem", "$HOME"],
        enabled: true,
      },
    ]
    void update({ mcpServers: next })
  }

  async function testAll() {
    setTesting(true)
    try {
      const s = await listMcpStatus(
        servers.filter((x) => {
          if (x.enabled === false) return false
          return x.transport === "stdio" ? !!x.command : !!x.url
        }),
      )
      setStatuses(s)
    } finally {
      setTesting(false)
    }
  }

  function statusFor(name: string): McpStatus | undefined {
    return statuses.find((s) => s.name === name)
  }

  function toggleExpand(name: string) {
    setExpanded((p) => ({ ...p, [name]: !p[name] }))
  }

  return (
    <div className="space-y-4">
      <Section title={t("settings.drawer.mcpServersTitle")}>
        <p className="mb-3 text-[11.5px] text-codezal-mute">
          {t("settings.drawer.mcpHint")}
        </p>

        {servers.length === 0 ? (
          <div className="mb-3 rounded-md border border-dashed border-codezal px-3 py-4 text-center text-[12px] text-codezal-mute">
            {t("settings.drawer.mcpNoServers")}
          </div>
        ) : (
          <ul className="mb-3 flex flex-col gap-2">
            {servers.map((s, i) => {
              const st = statusFor(s.name)
              return (
                <li
                  key={i}
                  className="rounded-md border border-codezal bg-codezal-input/40 p-2"
                >
                  <div className="mb-2 flex items-center gap-2">
                    <input
                      value={s.name}
                      onChange={(e) => patchAt(i, { name: e.target.value })}
                      placeholder={t("settings.drawer.mcpNamePlaceholder")}
                      className={cn(
                        "w-[120px] rounded border bg-transparent px-1.5 py-1 text-[12px] text-codezal-text outline-none focus:border-codezal-strong",
                        !s.name || nameCounts[s.name] > 1
                          ? "border-destructive"
                          : "border-codezal",
                      )}
                      title={
                        !s.name
                          ? "Ad boş olamaz"
                          : nameCounts[s.name] > 1
                            ? "Aynı isimde başka sunucu var — tool isimleri çakışır"
                            : ""
                      }
                    />
                    <select
                      value={s.transport ?? "http"}
                      onChange={(e) =>
                        patchAt(i, {
                          transport: e.target.value as "http" | "sse" | "stdio",
                        })
                      }
                      className="rounded border border-codezal bg-transparent px-1.5 py-1 text-[11.5px] text-codezal-text"
                    >
                      <option value="http">HTTP</option>
                      <option value="sse">SSE</option>
                      <option value="stdio">stdio</option>
                    </select>
                    <label className="flex items-center gap-1 text-[11px] text-codezal-dim">
                      <input
                        type="checkbox"
                        checked={s.enabled !== false}
                        onChange={(e) => patchAt(i, { enabled: e.target.checked })}
                      />
                      {t("settings.drawer.mcpEnabledLabel")}
                    </label>
                    {st && (
                      <button
                        type="button"
                        onClick={() => st.ok && toggleExpand(s.name)}
                        disabled={!st.ok}
                        className={cn(
                          "ml-auto flex items-center gap-1 rounded px-1.5 py-0.5 text-[10.5px]",
                          st.ok
                            ? "bg-codezal-accent-dim text-codezal-accent hover:opacity-80"
                            : "cursor-default bg-destructive/15 text-destructive",
                        )}
                        title={st.error ?? (st.ok ? "Tool listesini göster/gizle" : "")}
                      >
                        {st.ok &&
                          (expanded[s.name] ? (
                            <ChevronDown className="h-2.5 w-2.5" />
                          ) : (
                            <ChevronRight className="h-2.5 w-2.5" />
                          ))}
                        {st.ok ? `${st.toolCount} tool` : t("messageList.errorLabel")}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => removeAt(i)}
                      className="rounded p-1 text-codezal-mute hover:text-destructive"
                      title={t("settings.drawer.mcpDeleteTitle")}
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                  {(s.transport ?? "http") === "stdio" ? (
                    <>
                      <div className="mb-1 flex gap-1">
                        <input
                          value={s.command ?? ""}
                          onChange={(e) => patchAt(i, { command: e.target.value })}
                          placeholder="npx | uvx | node | …"
                          className="w-[110px] rounded border border-codezal bg-transparent px-2 py-1 font-mono text-[11.5px] text-codezal-text outline-none focus:border-codezal-strong"
                        />
                        <input
                          value={(s.args ?? []).join(" ")}
                          onChange={(e) =>
                            patchAt(i, {
                              args: e.target.value
                                .split(/\s+/)
                                .filter(Boolean),
                            })
                          }
                          placeholder="-y @modelcontextprotocol/server-filesystem $HOME"
                          className="flex-1 rounded border border-codezal bg-transparent px-2 py-1 font-mono text-[11.5px] text-codezal-text outline-none focus:border-codezal-strong"
                        />
                      </div>
                      <textarea
                        value={JSON.stringify(s.env ?? {}, null, 0)}
                        onChange={(e) => {
                          try {
                            const parsed = JSON.parse(e.target.value || "{}")
                            if (parsed && typeof parsed === "object") {
                              patchAt(i, { env: parsed as Record<string, string> })
                            }
                          } catch {
                            // sessiz — kullanıcı yazarken geçersiz olabilir
                          }
                        }}
                        placeholder={t("settings.drawer.mcpEnvPlaceholder")}
                        rows={1}
                        className="w-full resize-none rounded border border-codezal bg-transparent px-2 py-1 font-mono text-[11px] text-codezal-dim outline-none focus:border-codezal-strong"
                      />
                    </>
                  ) : (
                    <>
                      <input
                        value={s.url}
                        onChange={(e) => patchAt(i, { url: e.target.value })}
                        placeholder={t("settings.drawer.mcpUrlPlaceholder")}
                        className="mb-1 w-full rounded border border-codezal bg-transparent px-2 py-1 font-mono text-[11.5px] text-codezal-text outline-none focus:border-codezal-strong"
                      />
                      <textarea
                        value={JSON.stringify(s.headers ?? {}, null, 0)}
                        onChange={(e) => {
                          try {
                            const parsed = JSON.parse(e.target.value || "{}")
                            if (parsed && typeof parsed === "object") {
                              patchAt(i, { headers: parsed as Record<string, string> })
                            }
                          } catch {
                            // sessiz — kullanıcı yazarken geçersiz olabilir
                          }
                        }}
                        placeholder={t("settings.drawer.mcpHeadersPlaceholder")}
                        rows={1}
                        className="w-full resize-none rounded border border-codezal bg-transparent px-2 py-1 font-mono text-[11px] text-codezal-dim outline-none focus:border-codezal-strong"
                      />
                    </>
                  )}
                  {st?.error && (
                    <div className="mt-1 text-[10.5px] text-destructive">{st.error}</div>
                  )}
                  {st?.ok && expanded[s.name] && st.tools && st.tools.length > 0 && (
                    <ul className="mt-2 space-y-0.5 rounded border border-codezal/60 bg-codezal-panel-2/60 p-1.5 text-[11px]">
                      {st.tools.map((ti) => (
                        <li key={ti.name} className="flex flex-col">
                          <code className="text-codezal-accent">
                            {s.name}__{ti.name}
                          </code>
                          {ti.description && (
                            <span className="ml-2 line-clamp-2 text-codezal-mute">
                              {ti.description}
                            </span>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              )
            })}
          </ul>
        )}

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={addNew}
            className="flex items-center gap-1 rounded-md border border-codezal px-2.5 py-1.5 text-[12px] text-codezal-dim hover:border-codezal-strong hover:text-codezal-text"
          >
            <Plus className="h-3 w-3" /> {t("settings.drawer.mcpHttpAdd")}
          </button>
          <button
            type="button"
            onClick={addStdio}
            className="flex items-center gap-1 rounded-md border border-codezal px-2.5 py-1.5 text-[12px] text-codezal-dim hover:border-codezal-strong hover:text-codezal-text"
          >
            <Plus className="h-3 w-3" /> {t("settings.drawer.mcpStdioAdd")}
          </button>
          <button
            type="button"
            onClick={() => void testAll()}
            disabled={testing || servers.length === 0}
            className="flex items-center gap-1 rounded-md border border-codezal px-2.5 py-1.5 text-[12px] text-codezal-dim hover:border-codezal-strong hover:text-codezal-text disabled:opacity-50"
          >
            <RefreshCcw className={cn("h-3 w-3", testing && "animate-spin")} />
            {t("settings.drawer.mcpTestConnection")}
          </button>
          {statuses.length > 0 && !testing && (
            <span className="flex items-center gap-1 text-[11px] text-codezal-dim">
              <Check className="h-3 w-3 text-codezal-accent" />
              {statuses.filter((s) => s.ok).length}/{statuses.length} ok
            </span>
          )}
        </div>
      </Section>

      {importOpen && (
        <McpImportModal
          onClose={() => setImportOpen(false)}
          onApply={applyImport}
        />
      )}
    </div>
  )
}

// Üst kapsayıcısız veya mcpServers gömülü JSON yapıştırmak için modal.
// merge: aynı isim varsa override, yenilerini ekle. replace: tamamen üzerine yaz.
function McpImportModal({
  onClose,
  onApply,
}: {
  onClose: () => void
  onApply: (parsed: McpServerConfig[], mode: "merge" | "replace") => void
}) {
  const [text, setText] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [preview, setPreview] = useState<McpServerConfig[]>([])
  const [mode, setMode] = useState<"merge" | "replace">("merge")

  function tryParse(t: string) {
    setText(t)
    if (!t.trim()) {
      setError(null)
      setPreview([])
      return
    }
    try {
      const parsed = parseMcpServersJson(t)
      setError(null)
      setPreview(parsed)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setPreview([])
    }
  }

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="flex w-full max-w-[560px] flex-col gap-3 rounded-xl border border-codezal bg-codezal-panel p-4 shadow-2xl">
        <div className="flex items-center justify-between">
          <h3 className="text-[13px] font-semibold text-codezal-text">
            MCP sunucularını JSON'dan içe aktar
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-codezal-mute hover:text-codezal-text"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
        <p className="text-[11.5px] text-codezal-mute">
          Claude Desktop / Cursor / VSCode formatı —{" "}
          <code className="text-codezal-text">{"{ mcpServers: { ... } }"}</code> veya
          doğrudan map.{" "}
          <code className="text-codezal-text">command</code> varsa stdio,{" "}
          <code className="text-codezal-text">url</code> varsa http (type/transport ile
          override).
        </p>
        <textarea
          autoFocus
          value={text}
          onChange={(e) => tryParse(e.target.value)}
          placeholder={`{\n  "mcpServers": {\n    "filesystem": {\n      "command": "npx",\n      "args": ["-y", "@modelcontextprotocol/server-filesystem", "$HOME"]\n    },\n    "remote": {\n      "url": "https://mcp.example.com/v1/mcp",\n      "headers": { "Authorization": "Bearer ..." }\n    }\n  }\n}`}
          rows={12}
          className="w-full rounded-md border border-codezal bg-codezal-input px-2 py-1.5 font-mono text-[11.5px] text-codezal-text outline-none focus:border-codezal-strong"
        />
        {error && (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 px-2 py-1.5 text-[11.5px] text-destructive">
            {error}
          </div>
        )}
        {preview.length > 0 && (
          <div className="rounded-md border border-codezal bg-codezal-panel-2/60 px-2 py-1.5 text-[11.5px]">
            <div className="mb-1 text-codezal-dim">
              {preview.length} sunucu bulundu:
            </div>
            <ul className="space-y-0.5">
              {preview.map((p) => (
                <li key={p.name} className="font-mono text-codezal-text">
                  · {p.name}{" "}
                  <span className="text-codezal-mute">
                    [{p.transport ?? "http"}]
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1.5 text-[12px] text-codezal-dim">
            <input
              type="radio"
              name="import-mode"
              checked={mode === "merge"}
              onChange={() => setMode("merge")}
            />
            Birleştir (aynı isim override)
          </label>
          <label className="flex items-center gap-1.5 text-[12px] text-codezal-dim">
            <input
              type="radio"
              name="import-mode"
              checked={mode === "replace"}
              onChange={() => setMode("replace")}
            />
            Tamamını değiştir
          </label>
          <div className="flex-1" />
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-codezal px-2.5 py-1 text-[12px] text-codezal-dim hover:text-codezal-text"
          >
            İptal
          </button>
          <button
            type="button"
            disabled={preview.length === 0}
            onClick={() => onApply(preview, mode)}
            className="rounded-md border border-codezal-accent bg-codezal-accent-dim px-2.5 py-1 text-[12px] text-codezal-accent disabled:opacity-50"
          >
            Uygula ({preview.length})
          </button>
        </div>
      </div>
    </div>
  )
}

type HookEventLocal = "PreToolUse" | "PostToolUse" | "UserPromptSubmit" | "Stop"

function HooksTab() {
  const t = useT()
  const settings = useSettingsStore((s) => s.settings)
  const update = useSettingsStore((s) => s.update)
  const hooks = settings.hooks ?? []

  function addHook() {
    const id = crypto.randomUUID()
    void update({
      hooks: [
        ...hooks,
        {
          id,
          event: "PreToolUse",
          matcher: "*",
          command: "",
          timeoutMs: 10000,
          blocking: false,
          enabled: true,
          description: "",
        },
      ],
    })
  }

  function patchHook(idx: number, patch: Partial<(typeof hooks)[number]>) {
    const next = hooks.map((h, i) => (i === idx ? { ...h, ...patch } : h))
    void update({ hooks: next })
  }

  function removeHook(idx: number) {
    void update({ hooks: hooks.filter((_, i) => i !== idx) })
  }

  return (
    <div className="space-y-4">
      <Section title={t("settings.drawer.hooksTitle")}>
        <p className="mb-3 text-[11.5px] text-codezal-mute">
          {t("settings.drawer.hooksHint")}
        </p>

        {hooks.length === 0 && (
          <div className="rounded-md border border-dashed border-codezal px-3 py-4 text-center text-[11.5px] text-codezal-mute">
            {t("settings.drawer.hooksNoHooks")}
          </div>
        )}

        <div className="space-y-2">
          {hooks.map((h, idx) => (
            <div key={h.id} className="rounded-md border border-codezal bg-codezal-panel-2 p-2.5">
              <div className="flex items-center gap-1.5">
                <select
                  value={h.event}
                  onChange={(e) => patchHook(idx, { event: e.target.value as HookEventLocal })}
                  className="rounded border border-codezal bg-codezal-input px-1.5 py-0.5 text-[11.5px] text-codezal-text"
                >
                  <option value="PreToolUse">PreToolUse</option>
                  <option value="PostToolUse">PostToolUse</option>
                  <option value="UserPromptSubmit">UserPromptSubmit</option>
                  <option value="Stop">Stop</option>
                </select>
                <input
                  type="text"
                  placeholder={t("settings.drawer.hookMatcherPlaceholder")}
                  value={h.matcher ?? ""}
                  onChange={(e) => patchHook(idx, { matcher: e.target.value })}
                  className="w-32 rounded border border-codezal bg-codezal-input px-1.5 py-0.5 text-[11.5px] text-codezal-text"
                />
                <label className="ml-1 flex items-center gap-1 text-[11px] text-codezal-dim">
                  <input
                    type="checkbox"
                    checked={h.enabled ?? true}
                    onChange={(e) => patchHook(idx, { enabled: e.target.checked })}
                  />
                  {t("settings.drawer.hookActiveLabel")}
                </label>
                {h.event === "PreToolUse" && (
                  <label className="ml-1 flex items-center gap-1 text-[11px] text-codezal-dim">
                    <input
                      type="checkbox"
                      checked={h.blocking ?? false}
                      onChange={(e) => patchHook(idx, { blocking: e.target.checked })}
                    />
                    {t("settings.drawer.hookBlockLabel")}
                  </label>
                )}
                <button
                  type="button"
                  onClick={() => removeHook(idx)}
                  className="ml-auto rounded p-1 text-codezal-mute hover:bg-codezal-panel hover:text-codezal-text"
                  title={t("settings.drawer.hookDeleteTitle")}
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
              <input
                type="text"
                placeholder={t("settings.drawer.hookDescPlaceholder")}
                value={h.description ?? ""}
                onChange={(e) => patchHook(idx, { description: e.target.value })}
                className="mt-1.5 w-full rounded border border-codezal bg-codezal-input px-1.5 py-0.5 text-[11.5px] text-codezal-text"
              />
              <textarea
                placeholder={t("settings.drawer.hookCmdPlaceholder")}
                value={h.command}
                onChange={(e) => patchHook(idx, { command: e.target.value })}
                rows={2}
                className="mt-1.5 w-full rounded border border-codezal bg-codezal-input px-1.5 py-1 font-mono text-[11px] text-codezal-text"
              />
            </div>
          ))}
        </div>

        <button
          type="button"
          onClick={addHook}
          className="mt-3 flex h-7 items-center gap-1.5 rounded-md border border-codezal px-2.5 text-[12px] text-codezal-dim hover:border-codezal-strong hover:text-codezal-text"
        >
          <Plus className="h-3 w-3" />
          {t("settings.drawer.hookAdd")}
        </button>
      </Section>
    </div>
  )
}

function SemanticTab() {
  const t = useT()
  const settings = useSettingsStore((s) => s.settings)
  const update = useSettingsStore((s) => s.update)
  const active = useSessionsStore((s) => s.active)
  const workspace = active?.workspacePath
  const cfg = settings.semantic ?? {
    enabled: false,
    provider: "ollama" as const,
    model: "nomic-embed-text",
    baseUrl: "",
    apiKey: "",
    topK: 5,
  }

  const [stats, setStats] = useState<{ chunks: number; model: string; builtAt: number } | null>(null)
  const [building, setBuilding] = useState(false)
  const [progress, setProgress] = useState<BuildProgress | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    if (!workspace) {
      setStats(null)
      return
    }
    void loadIndex(workspace).then((idx) => {
      if (!alive) return
      setStats(
        idx ? { chunks: idx.chunks.length, model: idx.model, builtAt: idx.builtAt } : null,
      )
    })
    return () => {
      alive = false
    }
  }, [workspace, building])

  function patch(p: Partial<typeof cfg>) {
    void update({ semantic: { ...cfg, ...p } })
  }

  async function onBuild() {
    if (!workspace) {
      setError(t("settings.drawer.semanticNeedWorkspace"))
      return
    }
    setBuilding(true)
    setError(null)
    try {
      await buildIndex({
        workspace,
        cfg: {
          provider: cfg.provider,
          baseUrl: cfg.baseUrl,
          model: cfg.model,
          apiKey: cfg.apiKey,
        },
        onProgress: setProgress,
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBuilding(false)
      setProgress(null)
    }
  }

  return (
    <div className="space-y-4">
      <Section title={t("settings.drawer.semanticTitle")}>
        <p className="mb-3 text-[11.5px] text-codezal-mute">
          {t("settings.drawer.semanticHint")}
        </p>

        <label className="mb-3 flex items-center gap-2 text-[12px]">
          <input
            type="checkbox"
            checked={cfg.enabled}
            onChange={(e) => patch({ enabled: e.target.checked })}
          />
          <span className="text-codezal-text">{t("settings.drawer.semanticEnable")}</span>
        </label>

        <div className="mb-3 grid grid-cols-2 gap-2 text-[11.5px]">
          <label className="flex flex-col gap-1">
            <span className="text-codezal-dim">{t("settings.drawer.semanticProviderLabel")}</span>
            <select
              value={cfg.provider}
              onChange={(e) =>
                patch({ provider: e.target.value as "openai" | "ollama" | "custom" })
              }
              className="codezal-select"
            >
              <option value="ollama">{t("settings.drawer.providerOllama")}</option>
              <option value="openai">{t("settings.drawer.providerOpenai")}</option>
              <option value="custom">{t("settings.drawer.providerCustom")}</option>
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-codezal-dim">{t("settings.drawer.semanticModelLabel")}</span>
            <input
              value={cfg.model}
              onChange={(e) => patch({ model: e.target.value })}
              placeholder={t("settings.drawer.semanticModelPlaceholder")}
              className="rounded border border-codezal bg-codezal-input px-2 py-1 font-mono text-codezal-text"
            />
          </label>
          {(cfg.provider === "custom" || cfg.provider === "ollama") && (
            <label className="col-span-2 flex flex-col gap-1">
              <span className="text-codezal-dim">{t("settings.drawer.semanticBaseUrlLabel")}</span>
              <input
                value={cfg.baseUrl ?? ""}
                onChange={(e) => patch({ baseUrl: e.target.value })}
                placeholder={
                  cfg.provider === "ollama"
                    ? t("settings.drawer.semanticBaseUrlOllamaPh")
                    : t("settings.drawer.semanticBaseUrlCustomPh")
                }
                className="rounded border border-codezal bg-codezal-input px-2 py-1 font-mono text-codezal-text"
              />
            </label>
          )}
          {cfg.provider !== "ollama" && (
            <label className="col-span-2 flex flex-col gap-1">
              <span className="text-codezal-dim">{t("settings.drawer.semanticApiKeyLabel")}</span>
              <input
                type="password"
                value={cfg.apiKey ?? ""}
                onChange={(e) => patch({ apiKey: e.target.value })}
                className="rounded border border-codezal bg-codezal-input px-2 py-1 font-mono text-codezal-text"
              />
            </label>
          )}
          <label className="flex flex-col gap-1">
            <span className="text-codezal-dim">{t("settings.drawer.semanticTopKLabel")}</span>
            <input
              type="number"
              min={1}
              max={20}
              value={cfg.topK ?? 5}
              onChange={(e) => patch({ topK: Math.max(1, Math.min(20, Number(e.target.value) || 5)) })}
              className="rounded border border-codezal bg-codezal-input px-2 py-1 text-codezal-text"
            />
          </label>
        </div>
      </Section>

      <Section title={t("settings.drawer.semanticWsTitle")}>
        <div className="mb-2 rounded-md border border-codezal bg-codezal-panel-2 px-2.5 py-2 text-[11.5px]">
          {!workspace ? (
            <span className="text-codezal-mute">{t("settings.drawer.semanticWsNotConnected")}</span>
          ) : stats ? (
            <>
              <div className="text-codezal-text">
                {t("settings.drawer.semanticChunksLabel", { n: stats.chunks })}{" "}
                <code className="text-codezal-accent">{stats.model}</code>
              </div>
              <div className="text-codezal-mute">
                {t("settings.drawer.semanticBuiltLabel", { date: new Date(stats.builtAt).toLocaleString() })}
              </div>
            </>
          ) : (
            <span className="text-codezal-mute">{t("settings.drawer.semanticNoIndex")}</span>
          )}
        </div>

        {progress && (
          <div className="mb-2 text-[11px] text-codezal-dim">
            {progress.phase}: {progress.done}/{progress.total}
            {progress.current ? ` · ${progress.current}` : ""}
          </div>
        )}

        {error && <div className="mb-2 text-[11px] text-destructive">{error}</div>}

        <button
          type="button"
          disabled={!workspace || building}
          onClick={() => void onBuild()}
          className="flex h-7 items-center gap-1.5 rounded-md border border-codezal px-2.5 text-[12px] text-codezal-dim hover:border-codezal-strong hover:text-codezal-text disabled:opacity-50"
        >
          <RefreshCcw className={cn("h-3 w-3", building && "animate-spin")} />
          {stats ? t("settings.drawer.semanticRebuildBtn") : t("settings.drawer.semanticBuildBtn")}
        </button>
      </Section>
    </div>
  )
}

function AboutTab() {
  const t = useT()
  return (
    <div className="space-y-4 text-[12.5px] text-codezal-dim">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-md bg-codezal-accent-dim text-codezal-accent">
          ◆
        </div>
        <div>
          <div className="text-[14px] font-semibold text-codezal-text">Codezal</div>
          <div className="text-[11px] text-codezal-mute">{t("settings.drawer.aboutSubtitle")}</div>
        </div>
      </div>

      <Section title={t("settings.drawer.aboutComponents")}>
        <ul className="space-y-0.5 text-[12px]">
          <li>· Tauri 2 (Rust shell) + plugin-fs + plugin-shell</li>
          <li>· React 19 + Vite + Tailwind</li>
          <li>· Vercel AI SDK v6 — streamText + tools</li>
          <li>· cmdk · zustand · react-markdown · highlight.js · KaTeX</li>
        </ul>
      </Section>

      <Section title={t("settings.drawer.aboutShortcuts")}>
        <ul className="space-y-0.5 font-mono text-[11.5px]">
          <li>{t("settings.drawer.shortcutNew")}</li>
          <li>{t("settings.drawer.shortcutPalette")}</li>
          <li>{t("settings.drawer.shortcutSettings")}</li>
          <li>{t("settings.drawer.shortcutSearch")}</li>
          <li>{t("settings.drawer.shortcutPanel")}</li>
          <li>{t("settings.drawer.shortcutSend")}</li>
          <li>{t("settings.drawer.shortcutEsc")}</li>
        </ul>
      </Section>

      <Section title={t("settings.drawer.aboutData")}>
        <p className="text-[11.5px]">
          {t("settings.drawer.aboutDataText")}
        </p>
      </Section>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-codezal-dim">
        {title}
      </h3>
      {children}
    </div>
  )
}

function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T
  options: { value: T; label: string }[]
  onChange: (v: T) => void
}) {
  return (
    <div className="inline-flex gap-1 rounded-md border border-codezal bg-codezal-panel-2 p-0.5">
      {options.map((opt) => {
        const active = value === opt.value
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            aria-pressed={active}
            className={cn(
              "rounded px-2.5 py-1 text-[12px] transition-colors",
              active
                ? "bg-codezal-accent font-semibold text-white shadow-sm"
                : "text-codezal-dim hover:bg-codezal-panel hover:text-codezal-text",
            )}
          >
            {opt.label}
          </button>
        )
      })}
    </div>
  )
}

function Row({
  label,
  description,
  children,
}: {
  label: string
  description?: string
  children: React.ReactNode
}) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-codezal py-3 last:border-b-0">
      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-medium text-codezal-text">{label}</div>
        {description && <div className="mt-0.5 text-[11.5px] text-codezal-mute">{description}</div>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  )
}

// Every web-font in this list is loaded via index.css @import (Google Fonts,
// SIL OFL — free for commercial use). System fonts (SF Mono, Segoe UI, etc.)
// are guaranteed by their host OS. CSS keywords (system-ui, ui-monospace) map
// to the platform's default.
const UI_FONTS: { value: string; label: string }[] = [
  { value: "IBM Plex Sans", label: "IBM Plex Sans" },   // Google Fonts
  { value: "Inter", label: "Inter" },                    // Google Fonts
  { value: "Geist", label: "Geist" },                    // Google Fonts
  { value: "Roboto", label: "Roboto" },                  // Google Fonts
  { value: "system-ui", label: "System default" },       // CSS keyword
  { value: "-apple-system", label: "Apple system" },     // CSS keyword (macOS/iOS)
  { value: "Segoe UI", label: "Segoe UI" },              // Windows system
  { value: "Helvetica Neue", label: "Helvetica Neue" },  // macOS system
]

const CODE_FONTS: { value: string; label: string }[] = [
  { value: "IBM Plex Mono", label: "IBM Plex Mono" },    // Google Fonts
  { value: "JetBrains Mono", label: "JetBrains Mono" },  // Google Fonts
  { value: "Fira Code", label: "Fira Code" },            // Google Fonts
  { value: "Cascadia Code", label: "Cascadia Code" },    // Google Fonts
  { value: "SF Mono", label: "SF Mono" },                // macOS system
  { value: "Menlo", label: "Menlo" },                    // macOS system
  { value: "Monaco", label: "Monaco" },                  // macOS system
  { value: "Consolas", label: "Consolas" },              // Windows system
  { value: "ui-monospace", label: "System monospace" },  // CSS keyword
]

function AppearanceTab() {
  const t = useT()
  const settings = useSettingsStore((s) => s.settings)
  const update = useSettingsStore((s) => s.update)
  const appearance: Appearance = settings.appearance ?? DEFAULT_APPEARANCE
  const [userThemes, setUserThemes] = useState<ThemePreset[]>([])
  const [importError, setImportError] = useState<string | null>(null)
  const customSuffix = t("settings.drawer.appearance.customSuffix")

  const tokenLabel: Record<keyof ThemeTokens, string> = {
    codezalAccent: t("settings.drawer.appearance.tokenAccent"),
    codezalBg: t("settings.drawer.appearance.tokenBackground"),
    codezalText: t("settings.drawer.appearance.tokenForeground"),
    codezalPanel: t("settings.drawer.appearance.tokenPanel"),
    codezalSidebar: t("settings.drawer.appearance.tokenSidebar"),
    codezalChip: t("settings.drawer.appearance.tokenChip"),
    codezalDiffAdd: t("settings.drawer.appearance.tokenDiffAdd"),
    codezalDiffDel: t("settings.drawer.appearance.tokenDiffDel"),
  } as Record<keyof ThemeTokens, string>

  useEffect(() => {
    void loadUserThemes().then(setUserThemes)
  }, [])

  function patch(p: Partial<Appearance>) {
    const next: Appearance = { ...appearance, ...p }
    void update({ appearance: next, theme: next.mode })
  }

  const resolvedMode: ThemeMode =
    appearance.mode === "system"
      ? window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light"
      : appearance.mode

  const allPresets = [...BUILTIN_PRESETS, ...userThemes]
  const lightPresets = presetsForMode("light", allPresets)
  const darkPresets = presetsForMode("dark", allPresets)
  const activeLightPreset =
    lightPresets.find((p) => p.id === appearance.lightPreset) ?? BUILTIN_PRESETS[0]
  const activeDarkPreset =
    darkPresets.find((p) => p.id === appearance.darkPreset) ?? BUILTIN_PRESETS[1]
  const activePreset = resolvedMode === "dark" ? activeDarkPreset : activeLightPreset
  const customsByPreset = appearance.customsByPreset ?? {}
  const overrides = customsByPreset[activePreset.id] ?? {}
  const customLightActive =
    Object.keys(customsByPreset[activeLightPreset.id] ?? {}).length > 0
  const customDarkActive =
    Object.keys(customsByPreset[activeDarkPreset.id] ?? {}).length > 0
  // Sentinel option id used when overrides are active — selecting it is a no-op.
  const CUSTOM_LIGHT_ID = "__custom-light__"
  const CUSTOM_DARK_ID = "__custom-dark__"

  function getActiveToken(key: keyof ThemeTokens): string {
    return (overrides[key] as string | undefined) ?? activePreset.tokens[key]
  }

  function setActiveToken(key: keyof ThemeTokens, hsl: string) {
    const prev = customsByPreset[activePreset.id] ?? {}
    patch({
      customsByPreset: {
        ...customsByPreset,
        [activePreset.id]: { ...prev, [key]: hsl },
      },
    })
  }

  function resetOverrides() {
    const next = { ...customsByPreset }
    delete next[activePreset.id]
    patch({ customsByPreset: next })
  }

  function exportCurrent() {
    // Strip a trailing "(custom)" so re-exports don't accumulate suffixes;
    // the dropdown already appends "(custom)" for non-builtin presets at render time.
    const baseName = activePreset.name.replace(/\s*\(custom\)\s*$/i, "")
    const merged: ThemePreset = {
      id: `${activePreset.id}-custom-${Date.now()}`,
      name: baseName,
      mode: resolvedMode,
      tokens: { ...activePreset.tokens, ...overrides } as ThemeTokens,
    }
    const json = presetToJson(merged)
    void navigator.clipboard.writeText(json).catch(() => {})
    // Persist a copy under ~/.codezal/themes/ so it can be re-selected later
    void saveUserTheme(merged).then(async () => {
      const next = await loadUserThemes()
      setUserThemes(next)
    })
  }

  async function onImport(file: File) {
    try {
      const text = await file.text()
      const preset = jsonToPreset(text, file.name.replace(/\.json$/i, ""))
      if (!preset) {
        setImportError(t("settings.drawer.appearance.invalidThemeJson"))
        return
      }
      await saveUserTheme(preset)
      const next = await loadUserThemes()
      setUserThemes(next)
      setImportError(null)
    } catch (e) {
      setImportError(e instanceof Error ? e.message : t("settings.drawer.appearance.importFailed"))
    }
  }

  const localizedMode =
    resolvedMode === "dark"
      ? t("settings.drawer.appearance.modeDark")
      : t("settings.drawer.appearance.modeLight")

  const zoomLabel = (sz: FontScale): string => {
    switch (sz) {
      case "s":
        return t("settings.drawer.appearance.zoomSmall")
      case "m":
        return t("settings.drawer.appearance.zoomMedium")
      case "l":
        return t("settings.drawer.appearance.zoomLarge")
      case "xl":
        return t("settings.drawer.appearance.zoomXL")
    }
  }

  return (
    <div className="space-y-6">
      <Section title={t("settings.drawer.appearance.modeTitle")}>
        <Segmented
          value={appearance.mode}
          options={[
            { value: "light", label: t("settings.drawer.appearance.modeLight") },
            { value: "dark", label: t("settings.drawer.appearance.modeDark") },
            { value: "system", label: t("settings.drawer.appearance.modeSystem") },
          ]}
          onChange={(mode) => patch({ mode })}
        />
      </Section>

      <Section title={t("settings.drawer.appearance.zoomTitle")}>
        <p className="mb-2 text-[11.5px] text-codezal-mute">
          {t("settings.drawer.appearance.zoomDesc")}
        </p>
        <Segmented<FontScale>
          value={settings.fontScale ?? "m"}
          options={(["s", "m", "l", "xl"] as FontScale[]).map((sz) => ({
            value: sz,
            label: zoomLabel(sz),
          }))}
          onChange={(sz) => void update({ fontScale: sz })}
        />
      </Section>

      <Section title={t("settings.drawer.appearance.themePresetsTitle")}>
        <Row
          label={t("settings.drawer.appearance.lightThemeLabel")}
          description={t("settings.drawer.appearance.lightThemeDesc")}
        >
          <select
            value={customLightActive ? CUSTOM_LIGHT_ID : appearance.lightPreset}
            onChange={(e) => {
              const next = e.target.value
              if (next === CUSTOM_LIGHT_ID) return
              patch({ lightPreset: next })
            }}
            className="codezal-select w-auto"
          >
            {customLightActive && (
              <option value={CUSTOM_LIGHT_ID}>
                {activeLightPreset.name.replace(/\s*\(custom\)\s*$/i, "")} ({customSuffix})
              </option>
            )}
            {lightPresets.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name.replace(/\s*\(custom\)\s*$/i, "")}
                {p.builtin === false ? ` (${customSuffix})` : ""}
              </option>
            ))}
          </select>
        </Row>
        <Row
          label={t("settings.drawer.appearance.darkThemeLabel")}
          description={t("settings.drawer.appearance.darkThemeDesc")}
        >
          <select
            value={customDarkActive ? CUSTOM_DARK_ID : appearance.darkPreset}
            onChange={(e) => {
              const next = e.target.value
              if (next === CUSTOM_DARK_ID) return
              patch({ darkPreset: next })
            }}
            className="codezal-select w-auto"
          >
            {customDarkActive && (
              <option value={CUSTOM_DARK_ID}>
                {activeDarkPreset.name.replace(/\s*\(custom\)\s*$/i, "")} ({customSuffix})
              </option>
            )}
            {darkPresets.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name.replace(/\s*\(custom\)\s*$/i, "")}
                {p.builtin === false ? ` (${customSuffix})` : ""}
              </option>
            ))}
          </select>
        </Row>
      </Section>

      <Section title={t("settings.drawer.appearance.customColorsTitle", { mode: localizedMode })}>
        <p className="mb-2 text-[11.5px] text-codezal-mute">
          {t("settings.drawer.appearance.customColorsHint")}
        </p>
        <div className="grid grid-cols-2 gap-2">
          {PICKABLE_TOKENS.map(({ key, label }) => {
            const hsl = getActiveToken(key)
            const hex = hslToHex(hsl)
            return (
              <div
                key={key}
                className="flex items-center justify-between rounded-md border border-codezal bg-codezal-panel px-2.5 py-1.5"
              >
                <span className="text-[12px] text-codezal-text">{tokenLabel[key] ?? label}</span>
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={hex}
                    onChange={(e) => setActiveToken(key, hexToHsl(e.target.value))}
                    className="h-6 w-8 cursor-pointer rounded border border-codezal bg-transparent"
                  />
                  <HexInput
                    value={hex}
                    onCommit={(next) => setActiveToken(key, hexToHsl(next))}
                  />
                </div>
              </div>
            )
          })}
        </div>
        {Object.keys(overrides).length > 0 && (
          <button
            type="button"
            onClick={resetOverrides}
            className="mt-2 text-[12px] text-codezal-accent hover:underline"
          >
            {t("settings.drawer.appearance.resetCustomColors")}
          </button>
        )}
      </Section>

      <Section title={t("settings.drawer.appearance.typographyTitle")}>
        <Row
          label={t("settings.drawer.appearance.uiFontLabel")}
          description={t("settings.drawer.appearance.uiFontDesc")}
        >
          <select
            value={UI_FONTS.some((f) => f.value === appearance.uiFont) ? appearance.uiFont : "Roboto"}
            onChange={(e) => patch({ uiFont: e.target.value })}
            className="codezal-select w-auto"
            style={{ fontFamily: `"${appearance.uiFont}", system-ui, sans-serif` }}
          >
            {UI_FONTS.map((f) => (
              <option key={f.value} value={f.value} style={{ fontFamily: `"${f.value}", system-ui, sans-serif` }}>
                {f.label}
              </option>
            ))}
          </select>
        </Row>
        <Row
          label={t("settings.drawer.appearance.codeFontLabel")}
          description={t("settings.drawer.appearance.codeFontDesc")}
        >
          <select
            value={CODE_FONTS.some((f) => f.value === appearance.codeFont) ? appearance.codeFont : "JetBrains Mono"}
            onChange={(e) => patch({ codeFont: e.target.value })}
            className="codezal-select w-auto"
            style={{ fontFamily: `"${appearance.codeFont}", monospace` }}
          >
            {CODE_FONTS.map((f) => (
              <option key={f.value} value={f.value} style={{ fontFamily: `"${f.value}", monospace` }}>
                {f.label}
              </option>
            ))}
          </select>
        </Row>
        {/* UI font size removed — Tailwind text-[Npx] utilities on most components
            override body font-size, so the slider had no visible effect. Use the
            "Ekran ölçeği" (zoom) control above for whole-UI scaling. */}
        <Row
          label={t("settings.drawer.appearance.codeFontSizeLabel")}
          description={t("settings.drawer.appearance.pixelsHint")}
        >
          <NumberInput
            value={appearance.codeFontSizePx}
            min={9}
            max={20}
            onChange={(v) => patch({ codeFontSizePx: v })}
            suffix="px"
          />
        </Row>
      </Section>

      <Section title={t("settings.drawer.appearance.contrastTitle")}>
        <Row
          label={t("settings.drawer.appearance.lightContrastLabel")}
          description={t("settings.drawer.appearance.contrastDesc")}
        >
          <input
            type="range"
            min={0}
            max={100}
            value={appearance.contrastLight}
            onChange={(e) => patch({ contrastLight: parseInt(e.target.value, 10) })}
            className="w-48"
          />
          <span className="ml-2 text-[11.5px] text-codezal-mute">{appearance.contrastLight}</span>
        </Row>
        <Row
          label={t("settings.drawer.appearance.darkContrastLabel")}
          description={t("settings.drawer.appearance.contrastDesc")}
        >
          <input
            type="range"
            min={0}
            max={100}
            value={appearance.contrastDark}
            onChange={(e) => patch({ contrastDark: parseInt(e.target.value, 10) })}
            className="w-48"
          />
          <span className="ml-2 text-[11.5px] text-codezal-mute">{appearance.contrastDark}</span>
        </Row>
      </Section>

      <Section title={t("settings.drawer.appearance.surfacesTitle")}>
        <Row
          label={t("settings.drawer.appearance.translucentSidebarLabel")}
          description={t("settings.drawer.appearance.translucentSidebarDesc")}
        >
          <Toggle
            checked={appearance.translucentSidebar}
            onChange={(v) => patch({ translucentSidebar: v })}
          />
        </Row>
      </Section>

      <Section title={t("settings.drawer.appearance.motionTitle")}>
        <Row
          label={t("settings.drawer.appearance.reduceMotionLabel")}
          description={t("settings.drawer.appearance.reduceMotionDesc")}
        >
          <Segmented<ReduceMotion>
            value={appearance.reduceMotion}
            options={[
              { value: "system", label: t("settings.drawer.appearance.modeSystem") },
              { value: "on", label: t("settings.drawer.appearance.reduceMotionOn") },
              { value: "off", label: t("settings.drawer.appearance.reduceMotionOff") },
            ]}
            onChange={(v) => patch({ reduceMotion: v })}
          />
        </Row>
        <Row
          label={t("settings.drawer.appearance.pointerCursorLabel")}
          description={t("settings.drawer.appearance.pointerCursorDesc")}
        >
          <Toggle
            checked={appearance.pointerCursor}
            onChange={(v) => patch({ pointerCursor: v })}
          />
        </Row>
        <Row
          label={t("settings.drawer.appearance.fontSmoothingLabel")}
          description={t("settings.drawer.appearance.fontSmoothingDesc")}
        >
          <Toggle
            checked={appearance.fontSmoothing}
            onChange={(v) => patch({ fontSmoothing: v })}
          />
        </Row>
      </Section>

      <Section title={t("settings.drawer.appearance.diffDisplayTitle")}>
        <Row
          label={t("settings.drawer.appearance.diffMarkersLabel")}
          description={t("settings.drawer.appearance.diffMarkersDesc")}
        >
          <Segmented<DiffStyle>
            value={appearance.diffStyle}
            options={[
              { value: "color", label: t("settings.drawer.appearance.diffColor") },
              { value: "symbols", label: "+/-" },
            ]}
            onChange={(v) => patch({ diffStyle: v })}
          />
        </Row>
      </Section>

      <Section title={t("settings.drawer.appearance.importExportTitle")}>
        <div className="flex flex-wrap items-center gap-2">
          <label className="cursor-pointer rounded-md border border-codezal bg-codezal-panel px-3 py-1.5 text-[12px] text-codezal-text hover:bg-codezal-panel-2">
            {t("settings.drawer.appearance.importTheme")}
            <input
              type="file"
              accept=".json,application/json"
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (file) void onImport(file)
                e.target.value = ""
              }}
              className="hidden"
            />
          </label>
          <button
            type="button"
            onClick={exportCurrent}
            className="rounded-md border border-codezal bg-codezal-panel px-3 py-1.5 text-[12px] text-codezal-text hover:bg-codezal-panel-2"
          >
            {t("settings.drawer.appearance.exportCurrent")}
          </button>
        </div>
        <p className="mt-2 text-[11.5px] text-codezal-mute">
          {t("settings.drawer.appearance.userThemesHint")}
        </p>
        {importError && (
          <p className="mt-2 text-[12px] text-destructive">{importError}</p>
        )}
      </Section>
    </div>
  )
}

// Editable hex color input. Accepts #rgb, #rrggbb (with or without #).
// Commits live on every keystroke as soon as the draft is a valid hex —
// invalid intermediate states keep the picker's previous color. Esc reverts.
function HexInput({
  value,
  onCommit,
}: {
  value: string
  onCommit: (hex: string) => void
}) {
  const [draft, setDraft] = useState(value)
  // Re-sync when external value changes (e.g. preset switch, reset).
  useEffect(() => {
    setDraft(value)
  }, [value])

  function normalize(raw: string): string | null {
    const v = raw.trim().replace(/^#/, "")
    if (/^[0-9a-f]{3}$/i.test(v)) {
      const r = v[0], g = v[1], b = v[2]
      return `#${r}${r}${g}${g}${b}${b}`.toLowerCase()
    }
    if (/^[0-9a-f]{6}$/i.test(v)) return `#${v}`.toLowerCase()
    return null
  }

  function handleChange(next: string) {
    setDraft(next)
    const hex = normalize(next)
    if (hex && hex.toLowerCase() !== value.toLowerCase()) {
      onCommit(hex)
    }
  }

  function commitOrRevert() {
    const hex = normalize(draft)
    if (hex) setDraft(hex.toUpperCase())
    else setDraft(value)
  }

  return (
    <input
      type="text"
      value={draft}
      onChange={(e) => handleChange(e.target.value)}
      onBlur={commitOrRevert}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          ;(e.target as HTMLInputElement).blur()
        } else if (e.key === "Escape") {
          setDraft(value)
          ;(e.target as HTMLInputElement).blur()
        }
      }}
      spellCheck={false}
      autoCapitalize="off"
      autoCorrect="off"
      className="w-[72px] rounded border border-codezal bg-codezal-input px-1.5 py-0.5 font-mono text-[10.5px] uppercase tracking-tight text-codezal-text focus:border-codezal-accent focus:outline-none"
    />
  )
}

function NumberInput({
  value,
  min,
  max,
  onChange,
  suffix,
}: {
  value: number
  min: number
  max: number
  onChange: (v: number) => void
  suffix?: string
}) {
  // Draft state so the user can clear the input and type intermediate digits
  // (e.g. typing "1" then "8" without being clamped to min on the first digit).
  // Commit on blur or Enter; Esc reverts.
  const [draft, setDraft] = useState<string>(String(value))
  useEffect(() => {
    setDraft(String(value))
  }, [value])

  function commit(raw: string) {
    if (raw.trim() === "") {
      setDraft(String(value))
      return
    }
    const n = parseInt(raw, 10)
    if (!Number.isFinite(n)) {
      setDraft(String(value))
      return
    }
    const clamped = Math.max(min, Math.min(max, n))
    setDraft(String(clamped))
    if (clamped !== value) onChange(clamped)
  }

  return (
    <div className="inline-flex items-center gap-1">
      <input
        type="number"
        min={min}
        max={max}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={(e) => commit(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            commit((e.target as HTMLInputElement).value)
            ;(e.target as HTMLInputElement).blur()
          } else if (e.key === "Escape") {
            setDraft(String(value))
            ;(e.target as HTMLInputElement).blur()
          }
        }}
        className="w-16 rounded-md border border-codezal bg-codezal-input px-2 py-1 text-right text-[12.5px] text-codezal-text"
      />
      {suffix && <span className="text-[11px] text-codezal-mute">{suffix}</span>}
    </div>
  )
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className={cn(
        "relative inline-flex h-5 w-9 items-center rounded-full transition-colors",
        checked ? "bg-codezal-accent" : "bg-codezal-panel-2",
      )}
    >
      <span
        className={cn(
          "inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition-transform",
          checked ? "translate-x-4" : "translate-x-0.5",
        )}
      />
    </button>
  )
}
