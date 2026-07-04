import { useMemo } from "react"
import { useSessionsStore } from "@/store/sessions"
import { PROVIDERS, type ProviderId } from "@/lib/providers"
import { formatCount } from "@/lib/format"
import { useT } from "@/lib/i18n/useT"

export function StatsView() {
  const t = useT()
  const index = useSessionsStore((s) => s.index)
  const sessions = useSessionsStore((s) => s.sessions)

  const stats = useMemo(() => {
    const pool = Object.values(sessions)
    const modelFreq = new Map<string, number>()
    let inTok = 0
    let outTok = 0
    let cost = 0
    let turns = 0
    for (const s of pool) {
      const key = `${s.provider}/${s.model}`
      modelFreq.set(key, (modelFreq.get(key) ?? 0) + 1)
      if (s.usage) {
        inTok += s.usage.inputTokens
        outTok += s.usage.outputTokens
        cost += s.usage.costUsd
        turns += s.usage.turns
      }
    }
    const favEntry = [...modelFreq.entries()].sort((a, b) => b[1] - a[1])[0]

    const dayKeys = new Set(index.map((m) => new Date(m.updatedAt).toDateString()))
    let streak = 0
    const cursor = new Date()
    while (dayKeys.has(cursor.toDateString())) {
      streak++
      cursor.setDate(cursor.getDate() - 1)
    }

    const today = new Date()
    const buckets: { label: string; count: number }[] = []
    for (let i = 13; i >= 0; i--) {
      const d = new Date(today)
      d.setDate(today.getDate() - i)
      const key = d.toDateString()
      const count = index.filter((m) => new Date(m.updatedAt).toDateString() === key).length
      buckets.push({ label: `${d.getDate()}`, count })
    }
    const maxCount = Math.max(1, ...buckets.map((b) => b.count))

    const costByDay = new Map<string, number>()
    for (const s of pool) {
      if (!s.usage || s.usage.costUsd <= 0) continue
      const key = new Date(s.updatedAt).toDateString()
      costByDay.set(key, (costByDay.get(key) ?? 0) + s.usage.costUsd)
    }
    const costBuckets: { label: string; cost: number }[] = []
    for (let i = 13; i >= 0; i--) {
      const d = new Date(today)
      d.setDate(today.getDate() - i)
      costBuckets.push({ label: `${d.getDate()}`, cost: costByDay.get(d.toDateString()) ?? 0 })
    }
    const maxCost = Math.max(0.0001, ...costBuckets.map((b) => b.cost))

    return {
      favModel: favEntry?.[0],
      favCount: favEntry?.[1] ?? 0,
      inTok,
      outTok,
      cost,
      turns,
      sessionCount: index.length,
      streak,
      buckets,
      maxCount,
      costBuckets,
      maxCost,
    }
  }, [index, sessions])

  const favLabel = (() => {
    if (!stats.favModel) return "—"
    const [prov, model] = stats.favModel.split("/", 2)
    const provLabel = PROVIDERS[prov as ProviderId]?.label ?? prov
    return `${model} · ${provLabel}`
  })()

  return (
    <div className="space-y-4 p-4 text-sm">
      <div className="grid grid-cols-2 gap-3">
        <Stat label={t("statsView.totalChats")} value={String(stats.sessionCount)} />
        <Stat label={t("statsView.streak")} value={stats.streak > 0 ? t("statsView.streakValue", { n: stats.streak }) : "—"} />
        <Stat label={t("statsView.favModel")} value={favLabel} wide />
        <Stat label={t("statsView.totalTurns")} value={String(stats.turns)} />
        <Stat label={t("statsView.totalTokens")} value={formatCount(stats.inTok + stats.outTok)} />
        <Stat label={t("statsView.totalCost")} value={`$${stats.cost.toFixed(4)}`} />
      </div>

      <div>
        <div className="mb-1.5 text-sm text-codezal-mute">{t("statsView.last14Days")}</div>
        <div className="flex items-end gap-1" style={{ height: 56 }}>
          {stats.buckets.map((b, i) => (
            <div key={i} className="flex flex-1 flex-col items-center gap-1" title={t("statsView.chatTooltip", { count: b.count })}>
              <div
                className="w-full rounded-sm bg-codezal-accent/70"
                style={{ height: `${Math.round((b.count / stats.maxCount) * 44)}px`, minHeight: b.count > 0 ? 3 : 1 }}
              />
              <span className="text-sm text-codezal-mute">{b.label}</span>
            </div>
          ))}
        </div>
      </div>

      <div>
        <div className="mb-1.5 text-sm text-codezal-mute">{t("statsView.last14DaysCost")}</div>
        <div className="flex items-end gap-1" style={{ height: 56 }}>
          {stats.costBuckets.map((b, i) => (
            <div key={i} className="flex flex-1 flex-col items-center gap-1" title={`$${b.cost.toFixed(4)}`}>
              <div
                className="w-full rounded-sm bg-codezal-accent/70"
                style={{ height: `${Math.round((b.cost / stats.maxCost) * 44)}px`, minHeight: b.cost > 0 ? 3 : 1 }}
              />
              <span className="text-sm text-codezal-mute">{b.label}</span>
            </div>
          ))}
        </div>
      </div>

      <p className="text-sm text-codezal-mute">
        {t("statsView.footnote")}
      </p>
    </div>
  )
}

function Stat({ label, value, wide }: { label: string; value: string; wide?: boolean }) {
  return (
    <div className={wide ? "col-span-2" : undefined}>
      <div className="text-sm text-codezal-mute">{label}</div>
      <div className="truncate font-medium text-codezal-text" title={value}>
        {value}
      </div>
    </div>
  )
}
