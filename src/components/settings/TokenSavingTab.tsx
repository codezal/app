// Token Saving — settings tab.
// Three independent token-economy features, each with its own toggle card.
//   1. Brief Mode      — fully functional in this phase.
//   2. Compact Output  — disabled placeholder (phase 2).
//   3. Code Map        — disabled placeholder (phase 3).

import { useT } from "@/lib/i18n/useT"
import type { MessageKey } from "@/lib/i18n/types-messages"
import { useSettingsStore } from "@/store/settings"
import { useSessionsStore } from "@/store/sessions"
import {
  DEFAULT_TOKEN_SAVERS,
  type BriefModeLevel,
  type CompactOutputFilters,
} from "@/lib/token-savers/types"
import {
  briefDirective,
  buildCodeMap,
  loadCodeMap,
  type BuildProgress,
  type CodeMap,
} from "@/lib/token-savers"
import { cn } from "@/lib/utils"
import { Zap, Terminal, Network, Check } from "lucide-react"
import { useEffect, useMemo, useState } from "react"

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

  return (
    <div className="space-y-4">
      <header className="mb-2">
        <h3 className="text-[15px] font-semibold text-codezal-text">
          {tt("settings.drawer.tokensTitle", "Token Saving")}
        </h3>
        <p className="mt-1 text-[12px] text-codezal-mute">
          {tt(
            "settings.drawer.tokensIntro",
            "Three independent features reduce token usage. Each toggle works on its own.",
          )}
        </p>
      </header>

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
    </div>
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
      <div className="mb-2 text-[11.5px] text-codezal-dim">
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
                "relative flex flex-col items-start gap-1 rounded-md border-2 px-2.5 py-2 pr-7 text-left text-[11.5px] transition",
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
        className="mt-3 text-[11px] text-codezal-dim hover:text-codezal-text"
      >
        {showPreview ? "▾ Hide directive preview" : "▸ Show directive preview"}
      </button>
      {showPreview && (
        <pre className="mt-2 max-h-48 overflow-auto rounded-md border border-codezal bg-codezal-input p-2 font-mono text-[10.5px] leading-relaxed text-codezal-text">
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

const COMPACT_FILTERS: { key: keyof CompactOutputFilters; label: string; desc: string }[] = [
  { key: "git", label: "git", desc: "git status / diff / log / show" },
  { key: "test", label: "tests", desc: "vitest, jest, pytest, cargo test, go test" },
  { key: "build", label: "build", desc: "tsc, vite/next build, cargo build" },
  { key: "lint", label: "lint", desc: "eslint, biome, prettier, ruff" },
  { key: "grep", label: "grep", desc: "grep, rg, ag — collapse many hits per file" },
  { key: "pkg", label: "package", desc: "npm/pnpm/yarn install — drop progress noise" },
  { key: "generic", label: "generic", desc: "fallback: ANSI strip + dedupe consecutive lines" },
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
      <div className="mb-2 text-[11.5px] text-codezal-dim">Filters</div>
      <div className="grid grid-cols-2 gap-1.5">
        {COMPACT_FILTERS.map((f) => (
          <label
            key={f.key}
            className="flex items-start gap-2 rounded-md border border-codezal bg-codezal-panel-2 px-2.5 py-2 text-[11.5px]"
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
              <span className="text-codezal-mute">{f.desc}</span>
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
  const active = useSessionsStore((s) => s.active)
  const workspace = active?.workspacePath
  const [building, setBuilding] = useState(false)
  const [progress, setProgress] = useState<BuildProgress | null>(null)
  const [stats, setStats] = useState<{
    symbols: number
    edges: number
    builtAt: number
  } | null>(null)
  const [error, setError] = useState<string | null>(null)
  // Tracks whether we've already attempted an auto-build for this
  // workspace+enabled combination so toggling doesn't re-trigger a build.
  const [autoBuildAttempted, setAutoBuildAttempted] = useState(false)

  async function build(reason: "manual" | "auto") {
    if (!workspace || building) return
    setBuilding(true)
    setError(null)
    try {
      await buildCodeMap({ workspace, onProgress: setProgress })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      if (reason === "auto") setAutoBuildAttempted(true)
    } finally {
      setBuilding(false)
      setProgress(null)
    }
  }

  useEffect(() => {
    let alive = true
    if (!workspace) {
      setStats(null)
      setAutoBuildAttempted(false)
      return
    }
    void loadCodeMap(workspace).then((m: CodeMap | null) => {
      if (!alive) return
      setStats(
        m ? { symbols: m.symbols.length, edges: m.edges.length, builtAt: m.builtAt } : null,
      )
    })
    return () => {
      alive = false
    }
  }, [workspace, building])

  // Auto-build when the user enables Code Map and no index exists yet.
  // Runs once per (workspace,enabled) cycle; manual rebuild is always available.
  useEffect(() => {
    if (!enabled || !workspace || building) return
    if (stats !== null) return
    if (autoBuildAttempted) return
    setAutoBuildAttempted(true)
    void build("auto")
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, workspace, stats, autoBuildAttempted])

  // Reset the auto-build guard when card is disabled so re-enabling later
  // (perhaps in a different workspace) triggers a fresh attempt.
  useEffect(() => {
    if (!enabled) setAutoBuildAttempted(false)
  }, [enabled])

  const pct = progress && progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0

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
      <div className="space-y-2 text-[11.5px]">
        <p className="rounded-md border border-codezal bg-codezal-panel-2 px-2.5 py-2 text-codezal-mute">
          <strong className="font-medium text-codezal-text">Parser:</strong> regex MVP — TS/JS, Python, Rust, Go, Java.
          Tree-sitter upgrade scheduled for a follow-up release. Index lives in{" "}
          <code className="text-codezal-accent">.codezal/code-map.json</code>.
        </p>

        {!workspace ? (
          <p className="text-codezal-mute">Connect a workspace folder to build a Code Map.</p>
        ) : stats && !building ? (
          <div className="rounded-md border border-codezal bg-codezal-panel-2 px-2.5 py-2">
            <div className="text-codezal-text">
              <span className="font-medium">{stats.symbols.toLocaleString()}</span> symbols ·{" "}
              <span className="font-medium">{stats.edges.toLocaleString()}</span> call edges
            </div>
            <div className="text-codezal-mute">
              Built {new Date(stats.builtAt).toLocaleString()}
            </div>
          </div>
        ) : !building ? (
          <p className="text-codezal-mute">No index yet — click Build to generate one.</p>
        ) : null}

        {building && (
          <div className="space-y-1.5 rounded-md border border-codezal-accent/40 bg-codezal-accent/5 px-2.5 py-2">
            <div className="flex items-center justify-between gap-2 text-codezal-text">
              <span className="font-medium">Indexing workspace… please wait</span>
              <span className="font-mono tabular-nums">{pct}%</span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-codezal-panel-2">
              <div
                className="h-full rounded-full bg-codezal-accent transition-[width] duration-150"
                style={{ width: `${pct}%` }}
              />
            </div>
            <div className="flex items-center justify-between gap-2 font-mono text-[10.5px] text-codezal-mute">
              <span className="truncate">{progress?.currentFile ?? "preparing…"}</span>
              <span className="shrink-0">
                {progress
                  ? `${progress.done}/${progress.total} files · ${progress.symbolsSoFar} symbols`
                  : ""}
              </span>
            </div>
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
          <span>Auto-rebuild index when enabling Code Map in a new workspace</span>
        </label>

        <div>
          <button
            type="button"
            disabled={!enabled || !workspace || building}
            onClick={() => void build("manual")}
            className={cn(
              "rounded-md border border-codezal bg-codezal-chip px-3 py-1.5 text-[11.5px] text-codezal-text",
              "hover:bg-codezal-panel disabled:cursor-not-allowed disabled:opacity-50",
            )}
          >
            {building ? "Building…" : stats ? "Rebuild index" : "Build index"}
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
            <h4 className="text-[13.5px] font-semibold text-codezal-text">{title}</h4>
            {placeholder ? (
              <span className="rounded-full bg-codezal-chip px-2 py-0.5 text-[10px] text-codezal-dim">
                {comingSoonLabel}
              </span>
            ) : (
              <label className="inline-flex cursor-pointer items-center gap-2 text-[11.5px]">
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
                  {enabled ? "On" : "Off"}
                </span>
              </label>
            )}
          </div>
          <p className="mt-1 text-[11.5px] text-codezal-mute">{desc}</p>
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
