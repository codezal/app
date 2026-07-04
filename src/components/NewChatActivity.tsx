import { useEffect, useState } from "react"
import { db, listSessionUsage } from "@/lib/db"
import { computeStats, type Stats } from "@/lib/stats"
import { ActivityHeatmap } from "@/components/ActivityHeatmap"
import { useT } from "@/lib/i18n/useT"
import { Activity } from "@/lib/icons"

let cachedStats: Stats | null = null
let cachedAt = 0
const STATS_TTL_MS = 30_000

export function NewChatActivity() {
  const t = useT()
  const [stats, setStats] = useState<Stats | null>(cachedStats)

  useEffect(() => {
    let alive = true
    if (cachedStats && Date.now() - cachedAt < STATS_TTL_MS) return
    void (async () => {
      try {
        const rows = await listSessionUsage(db)
        if (!alive) return
        const s = computeStats(rows, { heatmapDays: 371 })
        cachedStats = s
        cachedAt = Date.now()
        setStats(s)
      } catch {
        // Intentionally ignored.
      }
    })()
    return () => {
      alive = false
    }
  }, [])

  if (!stats || stats.sessionCount === 0) return null

  return (
    <div className="mt-8 w-full rounded-xl border border-codezal bg-codezal-panel/60 px-4 py-3 shadow-sm">
      <div className="mb-2 flex items-center gap-2">
        <Activity className="h-4 w-4 text-codezal-accent" />
        <span className="text-sm font-semibold text-codezal-text">{t("settings.stats.heatmapTitle")}</span>
        <span className="ml-auto text-sm text-codezal-mute">
          {t("settings.stats.activeDays", { n: stats.activeDays })}
        </span>
      </div>
      <ActivityHeatmap days={stats.heatmap} fluid />
    </div>
  )
}
