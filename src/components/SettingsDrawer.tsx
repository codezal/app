// Ayarlar modal — sekmeli: Genel, API, Onay, Hakkında.
// Esc / arka plan tıklama / X ile kapanır.
import { useEffect, useState } from "react"
import {
  Check,
  ChevronDown,
  ChevronRight,
  Cog,
  Info,
  KeyRound,
  Moon,
  Plug,
  Plus,
  RefreshCcw,
  ShieldCheck,
  Sparkles,
  Sun,
  Trash2,
  Webhook,
  X,
} from "lucide-react"
import { PROVIDERS, type ProviderId } from "@/lib/providers"
import { useSettingsStore } from "@/store/settings"
import { useSessionsStore } from "@/store/sessions"
import { listMcpStatus, parseMcpServersJson, type McpServerConfig, type McpStatus } from "@/lib/mcp"
import { buildIndex, loadIndex, type BuildProgress } from "@/lib/semantic-index"
import { cn } from "@/lib/utils"
import type { Theme, FontScale } from "@/lib/theme"
import { LOCALES, type Locale } from "@/lib/i18n"
import { useT } from "@/lib/i18n/useT"

type Props = {
  onClose: () => void
}

type Tab = "genel" | "api" | "onay" | "mcp" | "hooks" | "semantic" | "hakkinda"

export function SettingsModal({ onClose }: Props) {
  const t = useT()
  const [tab, setTab] = useState<Tab>("genel")

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onClose])

  const tabs: { id: Tab; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
    { id: "genel", label: t("settings.tabs.general"), icon: Cog },
    { id: "api", label: t("settings.tabs.api"), icon: KeyRound },
    { id: "onay", label: t("settings.tabs.approval"), icon: ShieldCheck },
    { id: "mcp", label: t("settings.tabs.mcp"), icon: Plug },
    { id: "hooks", label: t("settings.tabs.hooks"), icon: Webhook },
    { id: "semantic", label: t("settings.tabs.semantic"), icon: Sparkles },
    { id: "hakkinda", label: t("settings.tabs.about"), icon: Info },
  ]

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="flex h-[560px] w-full max-w-[720px] overflow-hidden rounded-xl border border-codezal bg-codezal-panel shadow-2xl">
        {/* Sol nav */}
        <nav className="w-[160px] shrink-0 border-r border-codezal bg-codezal-sidebar p-2">
          {tabs.map((t) => {
            const Icon = t.icon
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                className={cn(
                  "mb-1 flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12.5px]",
                  tab === t.id
                    ? "bg-codezal-chip text-codezal-text"
                    : "text-codezal-dim hover:bg-codezal-panel-2 hover:text-codezal-text",
                )}
              >
                <Icon className="h-3.5 w-3.5" />
                {t.label}
              </button>
            )
          })}
        </nav>

        {/* Sağ içerik */}
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex shrink-0 items-center justify-between border-b border-codezal px-5 py-3">
            <h2 className="text-[13px] font-semibold text-codezal-text">{t("settings.drawer.headerPrefix", { tab: tabs.find((tt) => tt.id === tab)?.label ?? "" })}</h2>
            <button
              type="button"
              onClick={onClose}
              className="rounded p-1 text-codezal-mute hover:bg-codezal-panel-2 hover:text-codezal-text"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </header>

          <div className="flex-1 overflow-y-auto px-5 py-5">
            {tab === "genel" && <GeneralTab />}
            {tab === "api" && <ApiTab />}
            {tab === "onay" && <ApprovalTab />}
            {tab === "mcp" && <McpTab />}
            {tab === "hooks" && <HooksTab />}
            {tab === "semantic" && <SemanticTab />}
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
          className="w-full rounded-md border border-codezal bg-codezal-input px-2 py-1.5 text-[12px] text-codezal-text"
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

      <Section title={t("settings.drawer.themeTitle")}>
        <div className="flex items-center gap-1.5">
          {(["light", "dark", "system"] as Theme[]).map((th) => (
            <button
              key={th}
              type="button"
              onClick={() => void update({ theme: th })}
              className={cn(
                "flex h-7 items-center gap-1.5 rounded-md border px-2.5 text-[12px]",
                settings.theme === th
                  ? "border-codezal-accent text-codezal-accent"
                  : "border-codezal text-codezal-dim hover:border-codezal-strong",
              )}
            >
              {th === "light" && <Sun className="h-3 w-3" />}
              {th === "dark" && <Moon className="h-3 w-3" />}
              {th === "light" ? t("settings.general.themeLight") : th === "dark" ? t("settings.general.themeDark") : t("settings.general.themeSystem")}
            </button>
          ))}
        </div>
      </Section>

      <Section title={t("settings.drawer.fontSizeTitle")}>
        <div className="flex items-center gap-1.5">
          {(["s", "m", "l", "xl"] as FontScale[]).map((sz) => {
            const active = (settings.fontScale ?? "m") === sz
            return (
              <button
                key={sz}
                type="button"
                onClick={() => void update({ fontScale: sz })}
                className={cn(
                  "flex h-7 min-w-[36px] items-center justify-center rounded-md border px-2.5 text-[12px] uppercase",
                  active
                    ? "border-codezal-accent text-codezal-accent"
                    : "border-codezal text-codezal-dim hover:border-codezal-strong",
                )}
                title={
                  sz === "s"
                    ? t("settings.drawer.fontSmallTitle")
                    : sz === "m"
                      ? t("settings.drawer.fontMediumTitle")
                      : sz === "l"
                        ? t("settings.drawer.fontLargeTitle")
                        : t("settings.drawer.fontXLTitle")
                }
              >
                {sz}
              </button>
            )
          })}
        </div>
      </Section>

      <Section title={t("settings.drawer.defaultProviderModelTitle")}>
        <div className="flex items-center gap-1.5 text-[12px]">
          <select
            value={settings.defaultProvider}
            onChange={(e) => {
              const id = e.target.value as ProviderId
              void update({
                defaultProvider: id,
                defaultModel: PROVIDERS[id].defaultModel,
              })
            }}
            className="rounded-md border border-codezal bg-codezal-input px-2 py-1 text-codezal-text"
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
            className="rounded-md border border-codezal bg-codezal-input px-2 py-1 text-codezal-text"
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
              className="rounded border border-codezal bg-codezal-input px-2 py-1 text-codezal-text"
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
