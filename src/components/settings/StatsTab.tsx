// Statistics settings tab — usage at a glance, "box by box". Reads ALL sessions
// straight from SQLite (not the LRU RAM pool) so totals are accurate, then runs
// the pure aggregator in src/lib/stats.ts. Layout: headline stat boxes, an
// activity heatmap, model/usage insights, and the most active projects.
import { useEffect, useState } from "react"
import { db, listSessionUsage, countAllMessages } from "@/lib/db"
import { computeStats, type Stats } from "@/lib/stats"
import { PROVIDERS, type ProviderId } from "@/lib/providers"
import { formatCount } from "@/lib/format"
import { basename } from "@/lib/workspace"
import { useT } from "@/lib/i18n/useT"
import { ActivityHeatmap } from "@/components/ActivityHeatmap"
import {
  Activity,
  BarChart3,
  Brain,
  CalendarDays,
  Coins,
  Cpu,
  Flame,
  Folder,
  Gauge,
  Hash,
  MessageSquare,
  TrendingUp,
  Trophy,
  Zap,
} from "@/lib/icons"

// Cost formatting — cents-precise for small spend, two decimals once it grows.
function fmtCost(n: number): string {
  if (n <= 0) return "$0"
  if (n < 1) return `$${n.toFixed(4)}`
  return `$${n.toFixed(2)}`
}

// Resolve "provider/model" → "model · Provider Label" for display.
function modelLabel(key: string): string {
  const [prov, ...rest] = key.split("/")
  const model = rest.join("/") || prov
  const label = PROVIDERS[prov as ProviderId]?.label ?? prov
  return `${model} · ${label}`
}

export function StatsTab() {
  const t = useT()
  const [stats, setStats] = useState<Stats | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        const [rows, msgCount] = await Promise.all([listSessionUsage(db), countAllMessages(db)])
        if (!alive) return
        setStats(computeStats(rows, { totalMessages: msgCount, heatmapDays: 180 }))
      } catch (e) {
        console.error("[stats] aggregate failed:", e)
        if (alive) setStats(computeStats([], { totalMessages: 0 }))
      } finally {
        if (alive) setLoading(false)
      }
    })()
    return () => {
      alive = false
    }
  }, [])

  if (loading) {
    return <div className="py-16 text-center text-base text-codezal-mute">{t("common.loading")}</div>
  }
  if (!stats || stats.sessionCount === 0) {
    return (
      <div className="flex flex-col items-center gap-2 py-16 text-center">
        <BarChart3 className="h-8 w-8 text-codezal-mute" />
        <div className="text-base text-codezal-mute">{t("settings.stats.empty")}</div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Headline boxes — single bordered card split into cells (screenshot top row). */}
      <div className="grid grid-cols-2 overflow-hidden rounded-xl border border-codezal bg-codezal-panel shadow-sm sm:grid-cols-3">
        <StatBox
          icon={Zap}
          label={t("settings.stats.totalTokens")}
          value={formatCount(stats.totalTokens)}
        />
        <StatBox icon={Coins} label={t("settings.stats.totalCost")} value={fmtCost(stats.totalCost)} />
        <StatBox
          icon={MessageSquare}
          label={t("settings.stats.sessions")}
          value={String(stats.sessionCount)}
        />
        <StatBox icon={Hash} label={t("settings.stats.turns")} value={formatCount(stats.totalTurns)} />
        <StatBox
          icon={Flame}
          label={t("settings.stats.currentStreak")}
          value={t("settings.stats.days", { n: stats.currentStreak })}
        />
        <StatBox
          icon={Trophy}
          label={t("settings.stats.longestStreak")}
          value={t("settings.stats.days", { n: stats.longestStreak })}
        />
      </div>

      {/* Activity heatmap */}
      <section>
        <div className="mb-2 flex items-center gap-2">
          <Activity className="h-4 w-4 text-codezal-accent" />
          <h3 className="text-md font-semibold text-codezal-text">{t("settings.stats.heatmapTitle")}</h3>
          <span className="ml-auto text-base text-codezal-mute">
            {t("settings.stats.activeDays", { n: stats.activeDays })}
          </span>
        </div>
        <div className="rounded-xl border border-codezal bg-codezal-panel p-4 shadow-sm">
          <ActivityHeatmap days={stats.heatmap} />
        </div>
      </section>

      {/* Two columns: insights + top projects */}
      <div className="grid gap-4 lg:grid-cols-2">
        <section>
          <div className="mb-2 flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-codezal-accent" />
            <h3 className="text-md font-semibold text-codezal-text">{t("settings.stats.insightsTitle")}</h3>
          </div>
          <div className="rounded-xl border border-codezal bg-codezal-panel px-4 shadow-sm">
            <Insight
              icon={Cpu}
              label={t("settings.stats.topModel")}
              value={stats.topModel ? modelLabel(stats.topModel.key) : "—"}
              sub={stats.topModel ? formatCount(stats.topModel.tokens) : undefined}
            />
            <Insight
              icon={Activity}
              label={t("settings.stats.topProvider")}
              value={stats.topProvider ? (PROVIDERS[stats.topProvider.key as ProviderId]?.label ?? stats.topProvider.key) : "—"}
              sub={stats.topProvider ? t("settings.stats.sessionsN", { n: stats.topProvider.sessions }) : undefined}
            />
            <Insight
              icon={Gauge}
              label={t("settings.stats.avgTurns")}
              value={stats.avgTurnsPerSession.toFixed(1)}
            />
            <Insight
              icon={MessageSquare}
              label={t("settings.stats.totalMessages")}
              value={formatCount(stats.totalMessages)}
            />
            <Insight
              icon={CalendarDays}
              label={t("settings.stats.modeSplit")}
              value={`${stats.modeSplit.build} · ${stats.modeSplit.plan} · ${stats.modeSplit.orchestra}`}
              sub={t("settings.stats.modeLegend")}
            />
            <Insight
              icon={Brain}
              label={t("settings.stats.reasoning")}
              value={reasoningSummary(stats.reasoningSplit) || "—"}
            />
          </div>
        </section>

        <section>
          <div className="mb-2 flex items-center gap-2">
            <Folder className="h-4 w-4 text-codezal-accent" />
            <h3 className="text-md font-semibold text-codezal-text">{t("settings.stats.projectsTitle")}</h3>
          </div>
          <div className="rounded-xl border border-codezal bg-codezal-panel p-4 shadow-sm">
            {stats.topProjects.length === 0 ? (
              <div className="py-6 text-center text-base text-codezal-mute">
                {t("settings.stats.noProjects")}
              </div>
            ) : (
              <ProjectBars
                projects={stats.topProjects}
                max={Math.max(...stats.topProjects.map((p) => p.tokens), 1)}
              />
            )}
          </div>
        </section>
      </div>
    </div>
  )
}

function StatBox({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  value: string
}) {
  return (
    <div className="border-b border-r border-codezal-hair px-4 py-3.5 last:border-r-0 [&:nth-child(2n)]:border-r-0 sm:[&:nth-child(2n)]:border-r sm:[&:nth-child(3n)]:border-r-0">
      <div className="flex items-center gap-1.5 text-base text-codezal-mute">
        <Icon className="h-3.5 w-3.5" />
        <span className="truncate">{label}</span>
      </div>
      <div className="mt-1 text-md font-semibold tabular-nums tracking-tight text-codezal-text" title={value}>
        {value}
      </div>
    </div>
  )
}

function Insight({
  icon: Icon,
  label,
  value,
  sub,
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  value: string
  sub?: string
}) {
  return (
    <div className="flex items-center gap-3 border-b border-codezal-hair py-3 last:border-b-0">
      <Icon className="h-4 w-4 shrink-0 text-codezal-mute" />
      <span className="text-base text-codezal-dim">{label}</span>
      <span className="ml-auto flex min-w-0 items-baseline gap-1.5">
        <span className="truncate text-base font-medium text-codezal-text" title={value}>
          {value}
        </span>
        {sub && <span className="shrink-0 text-base tabular-nums text-codezal-mute">{sub}</span>}
      </span>
    </div>
  )
}

function ProjectBars({ projects, max }: { projects: { key: string; tokens: number; sessions: number }[]; max: number }) {
  return (
    <div className="space-y-2.5">
      {projects.map((p) => (
        <div key={p.key}>
          <div className="mb-1 flex items-baseline justify-between gap-2 text-base">
            <span className="truncate text-codezal-text" title={p.key}>
              {basename(p.key) || p.key}
            </span>
            <span className="shrink-0 tabular-nums text-base text-codezal-mute">{formatCount(p.tokens)}</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-codezal-panel-2">
            <div
              className="h-full rounded-full bg-codezal-accent"
              style={{ width: `${Math.max(3, Math.round((p.tokens / max) * 100))}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  )
}

// Compact "high 12 · medium 4" summary from the reasoning-effort split.
function reasoningSummary(split: Record<string, number>): string {
  return Object.entries(split)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([k, n]) => `${k} ${n}`)
    .join(" · ")
}
