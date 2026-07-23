// Token Saving — settings tab.
// Independent token-economy features, each with its own toggle card.
//   1. Brief Mode               — system-prompt directive injection (briefDirective).
//   2. Compact Output           — shell-output filtering (applyCompact, in tools/shell).
//   3. Code Map                 — AST symbol index + navigation tools (buildCodeMap/loadCodeMap).
//   4. Deferred MCP Tools       — load tool schemas on demand via tool_search.

import { useT } from "@/lib/i18n/useT"
import type { MessageKey } from "@/lib/i18n/types-messages"
import { useSettingsStore } from "@/store/settings"
import { useSessionsStore } from "@/store/sessions"
import { useTokenSavingsStore } from "@/store/token-savings"
import { useToolTelemetryStore } from "@/store/tool-telemetry"
import {
  DEFAULT_TOKEN_SAVERS,
  type BriefModeLevel,
  type CompactOutputFilters,
  type HistoryHygieneSettings,
} from "@/lib/token-savers/types"
import { briefDirective } from "@/lib/token-savers"
import { invoke } from "@tauri-apps/api/core"
import { cn } from "@/lib/utils"
import {
  Zap,
  Terminal,
  Network,
  Check,
  Plug,
  FileText,
  Scissors,
  Coins,
  RefreshCcw,
  Gauge,
} from "@/lib/icons"
import { useEffect, useMemo, useState } from "react"
import { errorMessage } from "@/lib/errors"
import { toast } from "@/store/toast"

// Local fallback helper: if a locale lacks our new keys, useT returns the
// literal key path — show the English fallback instead of an ugly dotted string.
function useTokensT() {
  const t = useT()
  return (key: MessageKey, fallback: string) => {
    const v = t(key)
    return v === key ? fallback : v
  }
}

export function TokenSavingTab() {
  const tt = useTokensT()
  const settings = useSettingsStore((s) => s.settings)
  const update = useSettingsStore((s) => s.update)
  const cfg = settings.tokenSavers ?? DEFAULT_TOKEN_SAVERS

  function patchBrief(p: Partial<typeof cfg.briefMode>) {
    void update({
      tokenSavers: {
        ...cfg,
        briefMode: { ...cfg.briefMode, ...p },
      },
    })
  }

  function patchCompact(p: Partial<typeof cfg.compactOutput>) {
    void update({
      tokenSavers: {
        ...cfg,
        compactOutput: { ...cfg.compactOutput, ...p },
      },
    })
  }

  function patchCompactFilter(key: keyof CompactOutputFilters, value: boolean) {
    void update({
      tokenSavers: {
        ...cfg,
        compactOutput: {
          ...cfg.compactOutput,
          filters: { ...cfg.compactOutput.filters, [key]: value },
        },
      },
    })
  }

  function patchCodeMap(p: Partial<typeof cfg.codeMap>) {
    void update({
      tokenSavers: {
        ...cfg,
        codeMap: { ...cfg.codeMap, ...p },
      },
    })
  }

  function patchDefer(enabled: boolean) {
    void update({ tokenSavers: { ...cfg, deferMcpTools: enabled } })
  }

  const hh = cfg.historyHygiene ?? DEFAULT_TOKEN_SAVERS.historyHygiene!

  function patchCompressDesc(enabled: boolean) {
    void update({ tokenSavers: { ...cfg, compressToolDescriptions: enabled } })
  }

  function patchHistory(p: Partial<HistoryHygieneSettings>) {
    void update({ tokenSavers: { ...cfg, historyHygiene: { ...hh, ...p } } })
  }

  return (
    <div className="space-y-6">
      <p className="text-base text-codezal-mute">
        {tt(
          "settings.drawer.tokensIntro",
          "Three independent features reduce token usage. Each toggle works on its own.",
        )}
      </p>

      <SavingsPanel />

      <ToolTelemetryPanel />

      <BriefModeCard
        enabled={cfg.briefMode.enabled}
        level={cfg.briefMode.level}
        onToggle={(enabled) => patchBrief({ enabled })}
        onLevel={(level) => patchBrief({ level })}
      />

      <CompactOutputCard
        enabled={cfg.compactOutput.enabled}
        filters={cfg.compactOutput.filters}
        onToggle={(enabled) => patchCompact({ enabled })}
        onFilter={patchCompactFilter}
      />

      <CodeMapCard
        enabled={cfg.codeMap.enabled}
        autoReindex={cfg.codeMap.autoReindex}
        onToggle={(enabled) => patchCodeMap({ enabled })}
        onAutoReindex={(autoReindex) => patchCodeMap({ autoReindex })}
      />

      <FeatureCard
        icon={<Plug className="h-4 w-4" />}
        title={tt("settings.drawer.tokensDeferMcpTitle", "Deferred MCP Tools")}
        desc={tt(
          "settings.drawer.tokensDeferMcpDesc",
          "When MCP servers are connected, send only the tool names to the model and load each schema on demand via tool_search. Big token savings on MCP-heavy setups; costs one extra search step the first time a tool is used.",
        )}
        enabled={cfg.deferMcpTools !== false}
        onToggle={patchDefer}
      />

      <FeatureCard
        icon={<FileText className="h-4 w-4" />}
        title={tt("settings.drawer.tokensCompressDescTitle", "Compress Tool Descriptions")}
        desc={tt(
          "settings.drawer.tokensCompressDescDesc",
          "Shrink tool description text before it reaches the model. Code, paths, identifiers and errors stay verbatim. Helps most on MCP-heavy setups where many tool schemas are sent.",
        )}
        enabled={cfg.compressToolDescriptions === true}
        onToggle={patchCompressDesc}
      />

      <HistoryHygieneCard
        settings={hh}
        onToggle={(enabled) => patchHistory({ enabled })}
        onMaxLines={(maxLines) => patchHistory({ maxLines })}
        onMaxBytes={(maxBytes) => patchHistory({ maxBytes })}
      />
    </div>
  )
}

function SavingsPanel() {
  const tt = useTokensT()
  const tokens = useTokenSavingsStore((s) => s.tokens)
  const bySource = useTokenSavingsStore((s) => s.bySource)
  const reset = useTokenSavingsStore((s) => s.reset)
  const unit = tt("settings.drawer.tokenSavingTotalUnit", "tokens")

  const rows: { label: string; value: number }[] = [
    { label: tt("settings.drawer.tokensCompactTitle", "Compact Shell Output"), value: bySource.compactOutput },
    { label: tt("settings.drawer.tokensCompressDescTitle", "Compress Tool Descriptions"), value: bySource.toolDesc },
    { label: tt("settings.drawer.tokensHistoryHygieneTitle", "History Hygiene"), value: bySource.historyHygiene },
  ]

  return (
    <section className="rounded-lg border border-codezal-accent/40 bg-codezal-accent/5 p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-codezal-accent">
          <Coins className="h-4 w-4" />
          <span className="text-md font-semibold uppercase tracking-wider text-codezal-dim">
            {tt("settings.drawer.tokenSavingTotalTitle", "Estimated tokens saved")}
          </span>
        </div>
        <button
          type="button"
          onClick={() => reset()}
          disabled={tokens === 0}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-md border border-codezal bg-codezal-chip px-2.5 py-1 text-base text-codezal-dim",
            "hover:bg-codezal-panel hover:text-codezal-text disabled:cursor-not-allowed disabled:opacity-40",
          )}
        >
          <RefreshCcw className="h-3 w-3" />
          {tt("settings.drawer.tokenSavingReset", "Reset")}
        </button>
      </div>
      <div className="mt-2 font-mono text-md font-semibold tabular-nums text-codezal-text">
        {tokens.toLocaleString()}{" "}
        <span className="text-base font-normal text-codezal-mute">{unit}</span>
      </div>
      <div className="mt-2 grid grid-cols-3 gap-2">
        {rows.map((r) => (
          <div
            key={r.label}
            className="rounded-md border border-codezal bg-codezal-panel-2 px-2 py-1.5 text-base"
          >
            <div className="truncate text-codezal-mute">{r.label}</div>
            <div className="font-mono tabular-nums text-codezal-text">{r.value.toLocaleString()}</div>
          </div>
        ))}
      </div>
    </section>
  )
}

function ToolTelemetryPanel() {
  const ttRaw = useTokensT()
  const tt = (key: string, fb: string) => ttRaw(key as MessageKey, fb)
  const byTool = useToolTelemetryStore((s) => s.byTool)
  const reset = useToolTelemetryStore((s) => s.reset)

  const rows = useMemo(
    () =>
      Object.entries(byTool)
        .map(([name, s]) => ({ name, ...s }))
        .sort((a, b) => b.totalMs - a.totalMs),
    [byTool],
  )

  const fmtMs = (ms: number) => (ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms)}ms`)
  const fmtTok = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}K` : String(n))

  return (
    <section className="rounded-lg border border-codezal bg-codezal-panel p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-codezal-accent">
          <Gauge className="h-4 w-4" />
          <span className="text-md font-semibold uppercase tracking-wider text-codezal-dim">
            {tt("settings.drawer.toolTelemetryTitle", "Tool telemetry (this session)")}
          </span>
        </div>
        <button
          type="button"
          onClick={() => reset()}
          disabled={rows.length === 0}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-md border border-codezal bg-codezal-chip px-2.5 py-1 text-base text-codezal-dim",
            "hover:bg-codezal-panel hover:text-codezal-text disabled:cursor-not-allowed disabled:opacity-40",
          )}
        >
          <RefreshCcw className="h-3 w-3" />
          {tt("settings.drawer.tokenSavingReset", "Reset")}
        </button>
      </div>

      {rows.length === 0 ? (
        <p className="mt-3 text-base text-codezal-mute">
          {tt(
            "settings.drawer.toolTelemetryEmpty",
            "No tool calls yet — run commands to see per-tool timing and token cost.",
          )}
        </p>
      ) : (
        <div className="mt-3 overflow-hidden rounded-md border border-codezal">
          <div className="grid grid-cols-[1fr_auto_auto_auto] gap-x-4 bg-codezal-panel-2 px-3 py-1.5 text-base font-medium text-codezal-dim">
            <span>{tt("settings.drawer.toolTelemetryTool", "Tool")}</span>
            <span className="text-right">{tt("settings.drawer.toolTelemetryCalls", "Calls")}</span>
            <span className="text-right">{tt("settings.drawer.toolTelemetryAvg", "Avg")}</span>
            <span className="text-right">{tt("settings.drawer.toolTelemetryTokens", "Tokens")}</span>
          </div>
          <div className="max-h-64 overflow-auto">
            {rows.map((r) => (
              <div
                key={r.name}
                className="grid grid-cols-[1fr_auto_auto_auto] gap-x-4 border-t border-codezal px-3 py-1.5 text-base"
              >
                <span className="truncate font-mono text-codezal-text">
                  {r.name}
                  {r.errors > 0 && <span className="ml-1.5 text-red-400">({r.errors} err)</span>}
                </span>
                <span className="text-right font-mono tabular-nums text-codezal-dim">{r.count}</span>
                <span className="text-right font-mono tabular-nums text-codezal-dim">
                  {fmtMs(r.totalMs / r.count)}
                </span>
                <span className="text-right font-mono tabular-nums text-codezal-dim">
                  {fmtTok(r.totalTokens)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  )
}

type HistoryHygieneCardProps = {
  settings: HistoryHygieneSettings
  onToggle: (v: boolean) => void
  onMaxLines: (v: number) => void
  onMaxBytes: (v: number) => void
}

function HistoryHygieneCard({ settings, onToggle, onMaxLines, onMaxBytes }: HistoryHygieneCardProps) {
  const tt = useTokensT()
  return (
    <FeatureCard
      icon={<Scissors className="h-4 w-4" />}
      title={tt("settings.drawer.tokensHistoryHygieneTitle", "History Hygiene")}
      desc={tt(
        "settings.drawer.tokensHistoryHygieneDesc",
        "On every request, trim old tool outputs to a line/byte cap (keeps head and tail). The most recent turn is never trimmed and your stored chat history is untouched.",
      )}
      enabled={settings.enabled}
      onToggle={onToggle}
    >
      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1 text-base">
          <span className="text-codezal-dim">
            {tt("settings.drawer.tokensHistoryHygieneMaxLines", "Max lines per tool result")}
          </span>
          <input
            type="number"
            min={10}
            step={10}
            disabled={!settings.enabled}
            value={settings.maxLines}
            onChange={(e) => onMaxLines(Math.max(1, Number(e.target.value) || 0))}
            className="rounded-md border border-codezal bg-codezal-input px-2 py-1 font-mono text-base text-codezal-text disabled:opacity-50"
          />
        </label>
        <label className="flex flex-col gap-1 text-base">
          <span className="text-codezal-dim">
            {tt("settings.drawer.tokensHistoryHygieneMaxBytes", "Max bytes per tool result")}
          </span>
          <input
            type="number"
            min={1024}
            step={1024}
            disabled={!settings.enabled}
            value={settings.maxBytes}
            onChange={(e) => onMaxBytes(Math.max(256, Number(e.target.value) || 0))}
            className="rounded-md border border-codezal bg-codezal-input px-2 py-1 font-mono text-base text-codezal-text disabled:opacity-50"
          />
        </label>
      </div>
    </FeatureCard>
  )
}

type BriefCardProps = {
  enabled: boolean
  level: BriefModeLevel
  onToggle: (v: boolean) => void
  onLevel: (l: BriefModeLevel) => void
}

function BriefModeCard({ enabled, level, onToggle, onLevel }: BriefCardProps) {
  const tt = useTokensT()
  const [showPreview, setShowPreview] = useState(false)

  const levels: { id: BriefModeLevel; titleKey: MessageKey; titleFb: string; descKey: MessageKey; descFb: string }[] = [
    {
      id: "lite",
      titleKey: "settings.drawer.tokensBriefLevelLite",
      titleFb: "Lite",
      descKey: "settings.drawer.tokensBriefLevelLiteDesc",
      descFb: "Drop filler and pleasantries. Keep prose.",
    },
    {
      id: "full",
      titleKey: "settings.drawer.tokensBriefLevelFull",
      titleFb: "Full",
      descKey: "settings.drawer.tokensBriefLevelFullDesc",
      descFb: "Drop articles and hedging. Fragments allowed.",
    },
    {
      id: "ultra",
      titleKey: "settings.drawer.tokensBriefLevelUltra",
      titleFb: "Ultra",
      descKey: "settings.drawer.tokensBriefLevelUltraDesc",
      descFb: "Maximum compression. Telegraph style.",
    },
  ]

  const previewText = useMemo(() => briefDirective(level), [level])

  return (
    <FeatureCard
      icon={<Zap className="h-4 w-4" />}
      title={tt("settings.drawer.tokensBriefTitle", "Brief Mode")}
      desc={tt(
        "settings.drawer.tokensBriefDesc",
        "Inject a style directive into the system prompt so the model responds in compressed prose. Code blocks, paths and errors remain verbatim.",
      )}
      enabled={enabled}
      onToggle={onToggle}
    >
      <div className="mb-2 text-base text-codezal-dim">
        {tt("settings.drawer.tokensBriefLevel", "Compression level")}
      </div>
      <div className="grid grid-cols-3 gap-2">
        {levels.map((l) => {
          const selected = enabled && level === l.id
          return (
            <button
              key={l.id}
              type="button"
              disabled={!enabled}
              onClick={() => onLevel(l.id)}
              className={cn(
                "relative flex flex-col items-start gap-1 rounded-md border-2 px-2.5 py-2 pr-7 text-left text-base transition",
                selected
                  ? "border-codezal-accent bg-codezal-accent/10 text-codezal-text shadow-[0_0_0_2px_rgba(var(--codezal-accent-rgb,251_146_60),0.25)]"
                  : "border-codezal bg-codezal-panel-2 text-codezal-dim hover:bg-codezal-panel",
              )}
              aria-pressed={selected}
            >
              {selected && (
                <span className="absolute right-1.5 top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-codezal-accent text-white">
                  <Check className="h-3 w-3" strokeWidth={3} />
                </span>
              )}
              <span
                className={cn(
                  "font-medium",
                  selected ? "text-codezal-accent" : "text-codezal-text",
                )}
              >
                {tt(l.titleKey, l.titleFb)}
              </span>
              <span className="text-codezal-mute">{tt(l.descKey, l.descFb)}</span>
            </button>
          )
        })}
      </div>

      <button
        type="button"
        onClick={() => setShowPreview((v) => !v)}
        className="mt-3 text-base text-codezal-dim hover:text-codezal-text"
      >
        {showPreview
          ? tt("settings.drawer.tokenSavingHideDirective", "▾ Hide directive preview")
          : tt("settings.drawer.tokenSavingShowDirective", "▸ Show directive preview")}
      </button>
      {showPreview && (
        <pre className="mt-2 max-h-48 overflow-auto rounded-md border border-codezal bg-codezal-input p-2 font-mono text-base leading-relaxed text-codezal-text">
          {previewText}
        </pre>
      )}
    </FeatureCard>
  )
}

type CompactCardProps = {
  enabled: boolean
  filters: CompactOutputFilters
  onToggle: (v: boolean) => void
  onFilter: (key: keyof CompactOutputFilters, value: boolean) => void
}

const COMPACT_FILTERS: {
  key: keyof CompactOutputFilters
  label: string
  descKey: MessageKey
  descFb: string
}[] = [
  { key: "git", label: "git", descKey: "settings.drawer.tokenSavingFilterGitDesc", descFb: "git status / diff / log / show" },
  { key: "test", label: "tests", descKey: "settings.drawer.tokenSavingFilterTestDesc", descFb: "vitest, jest, pytest, cargo test, go test" },
  { key: "build", label: "build", descKey: "settings.drawer.tokenSavingFilterBuildDesc", descFb: "tsc, vite/next build, cargo build" },
  { key: "lint", label: "lint", descKey: "settings.drawer.tokenSavingFilterLintDesc", descFb: "eslint, biome, prettier, ruff" },
  { key: "grep", label: "grep", descKey: "settings.drawer.tokenSavingFilterGrepDesc", descFb: "grep, rg, ag — collapse many hits per file" },
  { key: "pkg", label: "package", descKey: "settings.drawer.tokenSavingFilterPkgDesc", descFb: "npm/pnpm/yarn install — drop progress noise" },
  { key: "generic", label: "generic", descKey: "settings.drawer.tokenSavingFilterGenericDesc", descFb: "fallback: ANSI strip + dedupe consecutive lines" },
]

function CompactOutputCard({ enabled, filters, onToggle, onFilter }: CompactCardProps) {
  const tt = useTokensT()
  return (
    <FeatureCard
      icon={<Terminal className="h-4 w-4" />}
      title={tt("settings.drawer.tokensCompactTitle", "Compact Shell Output")}
      desc={tt(
        "settings.drawer.tokensCompactDesc",
        "Filter shell-command output (git, tests, builds, grep, lint, package managers) before it reaches the model. Saves big context on noisy commands.",
      )}
      enabled={enabled}
      onToggle={onToggle}
    >
      <div className="mb-2 text-base text-codezal-dim">{tt("settings.drawer.tokenSavingFiltersLabel", "Filters")}</div>
      <div className="grid grid-cols-2 gap-1.5">
        {COMPACT_FILTERS.map((f) => (
          <label
            key={f.key}
            className="flex items-start gap-2 rounded-md border border-codezal bg-codezal-panel-2 px-2.5 py-2 text-base"
          >
            <input
              type="checkbox"
              disabled={!enabled}
              checked={filters[f.key]}
              onChange={(e) => onFilter(f.key, e.target.checked)}
              className="mt-0.5"
            />
            <span className="flex min-w-0 flex-col">
              <span className="font-medium text-codezal-text">{f.label}</span>
              <span className="text-codezal-mute">{tt(f.descKey, f.descFb)}</span>
            </span>
          </label>
        ))}
      </div>
    </FeatureCard>
  )
}

type CodeMapCardProps = {
  enabled: boolean
  autoReindex: boolean
  onToggle: (v: boolean) => void
  onAutoReindex: (v: boolean) => void
}

function CodeMapCard({ enabled, autoReindex, onToggle, onAutoReindex }: CodeMapCardProps) {
  const tt = useTokensT()
  const t = useT()
  const active = useSessionsStore((s) => s.active)
  const workspace = active?.workspacePath
  const [building, setBuilding] = useState(false)
  const [stats, setStats] = useState<{ symbols: number; files: number } | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Code Map v2: build/status Rust SQLite backend'inde (codemap_*). Rust build
  async function build() {
    if (!workspace || building) return
    setBuilding(true)
    setError(null)
    try {
      const s = await invoke<{ files: number; symbols: number }>("codemap_build", { workspace })
      setStats({ symbols: s.symbols, files: s.files })
      if (s.symbols > 0) {
        toast.success(
          t("settings.drawer.tokenSavingCodeMapBuilt", {
            symbols: s.symbols.toLocaleString(),
            files: s.files.toLocaleString(),
          }),
        )
      } else {
        toast.info(t("settings.drawer.tokenSavingCodeMapEmpty"))
      }
    } catch (e) {
      const msg = errorMessage(e)
      setError(msg)
      toast.error(t("settings.drawer.tokenSavingCodeMapFailed", { error: msg }))
    } finally {
      setBuilding(false)
    }
  }

  useEffect(() => {
    let alive = true
    if (!workspace) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setStats(null)
      return
    }
    void invoke<{ files: number; symbols: number }>("codemap_status", { workspace })
      .then((st) => {
        if (!alive) return
        setStats(st.symbols > 0 ? { symbols: st.symbols, files: st.files } : null)
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [workspace, building])

  return (
    <FeatureCard
      icon={<Network className="h-4 w-4" />}
      title={tt("settings.drawer.tokensCodeMapTitle", "Code Map")}
      desc={tt(
        "settings.drawer.tokensCodeMapDesc",
        "AST-parsed symbol index. New tools (code_search, code_callers, code_callees, code_trace) let the model navigate the codebase structurally.",
      )}
      enabled={enabled}
      onToggle={onToggle}
    >
      <div className="space-y-2 text-base">
        <p className="rounded-md border border-codezal bg-codezal-panel-2 px-2.5 py-2 text-codezal-mute">
          <strong className="font-medium text-codezal-text">
            {tt("settings.drawer.tokenSavingParserLabel", "Parser:")}
          </strong>{" "}
          {tt(
            "settings.drawer.tokenSavingParserBody",
            "regex MVP — TS/JS, Python, Rust, Go, Java, HTML. Tree-sitter upgrade scheduled for a follow-up release. Index lives in",
          )}{" "}
          <code className="text-codezal-accent">.codezal/code-map.db</code>.
        </p>

        {!workspace ? (
          <p className="text-codezal-mute">{tt("settings.drawer.tokenSavingNoWorkspace", "Connect a workspace folder to build a Code Map.")}</p>
        ) : stats && !building ? (
          <div className="rounded-md border border-codezal bg-codezal-panel-2 px-2.5 py-2 text-codezal-text">
            {t("settings.drawer.tokenSavingCodeMapStats", {
              symbols: stats.symbols.toLocaleString(),
              files: stats.files.toLocaleString(),
            })}
          </div>
        ) : !building ? (
          <p className="text-codezal-mute">{tt("settings.drawer.tokenSavingNoIndexLabel", "No index yet — click Build to generate one.")}</p>
        ) : null}

        {building && (
          <div className="rounded-md border border-codezal-accent/40 bg-codezal-accent/5 px-2.5 py-2 text-codezal-text">
            {tt("settings.drawer.tokenSavingBuildingLabel", "Indexing workspace… please wait")}
          </div>
        )}

        {error && (
          <div className="rounded-md border border-red-500/40 bg-red-500/10 px-2.5 py-2 text-red-400">
            {error}
          </div>
        )}

        <label className="flex items-center gap-2 text-codezal-dim">
          <input
            type="checkbox"
            checked={autoReindex}
            disabled={!enabled}
            onChange={(e) => onAutoReindex(e.target.checked)}
          />
          <span>{tt("settings.drawer.tokenSavingAutoReindexLabel", "Auto-rebuild index when enabling Code Map in a new workspace")}</span>
        </label>

        <div>
          <button
            type="button"
            disabled={!enabled || !workspace || building}
            onClick={() => void build()}
            className={cn(
              "rounded-md border border-codezal bg-codezal-chip px-3 py-1.5 text-base text-codezal-text",
              "hover:bg-codezal-panel disabled:cursor-not-allowed disabled:opacity-50",
            )}
          >
            {building
              ? tt("settings.drawer.tokenSavingBuildingLabel", "Building…")
              : stats
                ? tt("settings.drawer.tokenSavingRebuildBtn", "Rebuild index")
                : tt("settings.drawer.tokenSavingBuildBtn", "Build index")}
          </button>
        </div>
      </div>
    </FeatureCard>
  )
}

type FeatureCardProps = {
  icon: React.ReactNode
  title: string
  desc: string
  enabled: boolean
  onToggle: (v: boolean) => void
  comingSoonLabel?: string
  children?: React.ReactNode
}

function FeatureCard({ icon, title, desc, enabled, onToggle, comingSoonLabel, children }: FeatureCardProps) {
  const tt = useTokensT()
  const placeholder = Boolean(comingSoonLabel)
  return (
    <section
      className={cn(
        "rounded-lg border border-codezal bg-codezal-panel p-4 transition-opacity",
        placeholder && "opacity-70",
      )}
    >
      <div className="mb-3 flex items-start gap-3">
        <div className="mt-0.5 shrink-0 text-codezal-accent">{icon}</div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <h4 className="text-md font-semibold uppercase tracking-wider text-codezal-dim">
              {title}
            </h4>
            {placeholder ? (
              <span className="rounded-full bg-codezal-chip px-2 py-0.5 text-base text-codezal-dim">
                {comingSoonLabel}
              </span>
            ) : (
              <label className="inline-flex cursor-pointer items-center gap-2 text-base">
                <input
                  type="checkbox"
                  checked={enabled}
                  onChange={(e) => onToggle(e.target.checked)}
                />
                <span
                  className={cn(
                    "font-medium",
                    enabled ? "text-codezal-accent" : "text-codezal-dim",
                  )}
                >
                  {enabled
                    ? tt("settings.drawer.tokenSavingOnLabel", "On")
                    : tt("settings.drawer.tokenSavingOffLabel", "Off")}
                </span>
              </label>
            )}
          </div>
          <p className="mt-1 text-base text-codezal-mute">{desc}</p>
        </div>
      </div>
      {!placeholder && children ? (
        <div
          className={cn(
            "pl-7 transition-opacity",
            !enabled && "pointer-events-none opacity-50",
          )}
        >
          {children}
        </div>
      ) : null}
    </section>
  )
}
