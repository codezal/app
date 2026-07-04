import { useMemo } from "react"
import { type DayBucket } from "@/lib/stats"
import { formatCount } from "@/lib/format"
import { useT } from "@/lib/i18n/useT"
import { cn } from "@/lib/utils"

export function ActivityHeatmap({ days, fluid = false }: { days: DayBucket[]; fluid?: boolean }) {
  const t = useT()
  const { weeks, monthLabels, level } = useMemo(() => buildGrid(days), [days])

  const colGap = fluid ? "gap-[2px]" : "gap-[3px]"
  const monthCol = fluid ? "min-w-0 flex-1" : "w-[11px] shrink-0"
  const weekCol = fluid ? "flex min-w-0 flex-1 flex-col" : "flex flex-col"
  const cell = fluid ? "aspect-square w-full rounded-[2px]" : "h-[11px] w-[11px] rounded-[2px]"

  return (
    <div className={fluid ? "w-full" : "overflow-x-auto"}>
      <div className={cn("flex flex-col gap-1", fluid ? "w-full" : "inline-flex min-w-full")}>
        {/* Month labels aligned to week columns. */}
        <div className={cn("flex pl-0 text-sm text-codezal-mute", colGap)}>
          {monthLabels.map((m, i) => (
            <div key={i} className={monthCol}>
              {m}
            </div>
          ))}
        </div>
        {/* Week columns. */}
        <div className={cn("flex", colGap)}>
          {weeks.map((week, wi) => (
            <div key={wi} className={cn(weekCol, colGap)}>
              {week.map((d, di) => (
                <div
                  key={di}
                  title={d ? t("settings.stats.heatCell", { n: formatCount(d.tokens), day: d.day }) : undefined}
                  className={cn(cell, LEVEL_CLASS[d ? level(d.tokens) : 0])}
                />
              ))}
            </div>
          ))}
        </div>
        {/* Legend */}
        <div className="mt-1 flex items-center gap-1.5 text-sm text-codezal-mute">
          <span>{t("settings.stats.less")}</span>
          {[0, 1, 2, 3, 4].map((l) => (
            <div key={l} className={cn("h-[11px] w-[11px] rounded-[2px]", LEVEL_CLASS[l])} />
          ))}
          <span>{t("settings.stats.more")}</span>
        </div>
      </div>
    </div>
  )
}

const LEVEL_CLASS: Record<number, string> = {
  0: "bg-codezal-panel-2",
  1: "bg-emerald-200 dark:bg-emerald-900",
  2: "bg-emerald-400 dark:bg-emerald-700",
  3: "bg-emerald-500 dark:bg-emerald-500",
  4: "bg-emerald-600 dark:bg-emerald-400",
}

// Build week columns (Sunday-first), month labels, and a quartile level() fn.
function buildGrid(days: DayBucket[]): {
  weeks: (DayBucket | null)[][]
  monthLabels: string[]
  level: (tokens: number) => number
} {
  if (days.length === 0) return { weeks: [], monthLabels: [], level: () => 0 }

  // Pad leading nulls so the first column starts on Sunday (getDay() === 0).
  const firstDow = new Date(days[0].ts).getDay()
  const padded: (DayBucket | null)[] = [...Array<null>(firstDow).fill(null), ...days]
  const weeks: (DayBucket | null)[][] = []
  for (let i = 0; i < padded.length; i += 7) weeks.push(padded.slice(i, i + 7))

  // One month label per column, shown only when the month changes.
  const monthFmt = new Intl.DateTimeFormat(undefined, { month: "short" })
  let prevMonth = -1
  const monthLabels = weeks.map((w) => {
    const first = w.find((d): d is DayBucket => d != null)
    if (!first) return ""
    const m = new Date(first.ts).getMonth()
    if (m !== prevMonth) {
      prevMonth = m
      return monthFmt.format(new Date(first.ts))
    }
    return ""
  })

  // Quartile thresholds over nonzero token days.
  const nonzero = days
    .map((d) => d.tokens)
    .filter((n) => n > 0)
    .sort((a, b) => a - b)
  const q = (p: number): number =>
    nonzero.length === 0 ? Infinity : nonzero[Math.min(nonzero.length - 1, Math.floor(p * nonzero.length))]
  const q25 = q(0.25)
  const q50 = q(0.5)
  const q75 = q(0.75)
  const level = (tokens: number): number => {
    if (tokens <= 0) return 0
    if (tokens <= q25) return 1
    if (tokens <= q50) return 2
    if (tokens <= q75) return 3
    return 4
  }

  return { weeks, monthLabels, level }
}
