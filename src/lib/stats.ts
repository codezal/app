// Usage statistics aggregation — pure, side-effect-free functions over raw
// session rows. Fed by listSessionUsage() (DB) so totals cover ALL sessions, not
// just the RAM-hydrated pool. Label resolution (provider names, project
// basenames) is intentionally LEFT TO THE UI so this module stays dependency-free
// and node-testable (only a type-only provider import, erased at runtime).
import type { ProviderId } from "@/lib/providers"
import type { AgentMode } from "@/store/types"

// One session's stat-relevant fields, parsed from the DB `data` blob + columns.
// usage fields are flattened (and default 0) so callers never branch on absence.
export type SessionUsageRow = {
  id: string
  updatedAt: number
  projectPath?: string
  provider: ProviderId
  model: string
  mode: AgentMode
  reasoningEffort?: string
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  reasoningTokens: number
  costUsd: number
  turns: number
}

// One day of the activity heatmap. `ts` is local midnight; `day` its yyyy-mm-dd.
export type DayBucket = {
  day: string
  ts: number
  tokens: number
  sessions: number
  cost: number
}

// A ranked group (model / provider / project). `key` is the raw identifier; the
// UI turns it into a human label (PROVIDERS[id].label, basename(path), …).
export type RankEntry = {
  key: string
  tokens: number
  sessions: number
}

export type Stats = {
  totalTokens: number
  inputTokens: number
  outputTokens: number
  cacheTokens: number
  reasoningTokens: number
  totalCost: number
  sessionCount: number
  totalTurns: number
  totalMessages: number
  projectCount: number
  currentStreak: number
  longestStreak: number
  activeDays: number
  avgTurnsPerSession: number
  topModel?: RankEntry
  topProvider?: RankEntry
  modeSplit: Record<AgentMode, number>
  reasoningSplit: Record<string, number>
  topProjects: RankEntry[]
  // One entry per calendar day for the last `heatmapDays` days, chronological
  // (oldest → today). Empty days are present with zeroed counts.
  heatmap: DayBucket[]
}

const DAY_MS = 86_400_000

// Local midnight epoch for a timestamp — heatmap/streak bucket key.
export function dayStart(ts: number): number {
  const d = new Date(ts)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

// yyyy-mm-dd in LOCAL time (not UTC — avoids day drift for evening activity).
export function dayKey(ts: number): string {
  const d = new Date(ts)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  return `${y}-${m}-${day}`
}

// All token kinds summed — input + output + cache (read+write) + reasoning.
export function rowTokens(r: SessionUsageRow): number {
  return r.inputTokens + r.outputTokens + r.cacheReadTokens + r.cacheWriteTokens + r.reasoningTokens
}

function topOf(map: Map<string, RankEntry>): RankEntry | undefined {
  let best: RankEntry | undefined
  for (const e of map.values()) {
    if (!best) {
      best = e
      continue
    }
    // Rank by tokens, fall back to session count when all-zero tokens.
    if (e.tokens > best.tokens || (e.tokens === best.tokens && e.sessions > best.sessions)) best = e
  }
  return best
}

type ComputeOpts = {
  // Reference "today" for streak + heatmap window. Tests pin this; UI omits → Date.now().
  now?: number
  // Heatmap window length in days (default ~1 year, includes today).
  heatmapDays?: number
  // Total message rows across all sessions (separate COUNT query) — not derivable
  // from usage rows. 0 when unavailable.
  totalMessages?: number
}

export function computeStats(rows: SessionUsageRow[], opts: ComputeOpts = {}): Stats {
  const now = opts.now ?? Date.now()
  const heatmapDays = opts.heatmapDays ?? 371 // 53 weeks → clean grid
  const totalMessages = opts.totalMessages ?? 0

  let inputTokens = 0
  let outputTokens = 0
  let cacheTokens = 0
  let reasoningTokens = 0
  let totalCost = 0
  let totalTurns = 0

  const modelMap = new Map<string, RankEntry>()
  const providerMap = new Map<string, RankEntry>()
  const projectMap = new Map<string, RankEntry>()
  const modeSplit: Record<AgentMode, number> = { build: 0, plan: 0, orchestra: 0 }
  const reasoningSplit: Record<string, number> = {}
  // day-start → aggregate for the heatmap.
  const dayAgg = new Map<number, { tokens: number; sessions: number; cost: number }>()
  const activeDaySet = new Set<number>()

  const bump = (map: Map<string, RankEntry>, key: string, tokens: number): void => {
    const e = map.get(key)
    if (e) {
      e.tokens += tokens
      e.sessions += 1
    } else {
      map.set(key, { key, tokens, sessions: 1 })
    }
  }

  for (const r of rows) {
    const tok = rowTokens(r)
    inputTokens += r.inputTokens
    outputTokens += r.outputTokens
    cacheTokens += r.cacheReadTokens + r.cacheWriteTokens
    reasoningTokens += r.reasoningTokens
    totalCost += r.costUsd
    totalTurns += r.turns

    bump(modelMap, `${r.provider}/${r.model}`, tok)
    bump(providerMap, r.provider, tok)
    if (r.projectPath) bump(projectMap, r.projectPath, tok)

    modeSplit[r.mode] = (modeSplit[r.mode] ?? 0) + 1
    if (r.reasoningEffort) reasoningSplit[r.reasoningEffort] = (reasoningSplit[r.reasoningEffort] ?? 0) + 1

    const ds = dayStart(r.updatedAt)
    activeDaySet.add(ds)
    const agg = dayAgg.get(ds)
    if (agg) {
      agg.tokens += tok
      agg.sessions += 1
      agg.cost += r.costUsd
    } else {
      dayAgg.set(ds, { tokens: tok, sessions: 1, cost: r.costUsd })
    }
  }

  // Current streak — consecutive active days counting back from today. Matches
  // the legacy StatsView behaviour: if today has no activity the streak is 0.
  const today = dayStart(now)
  let currentStreak = 0
  for (let d = today; activeDaySet.has(d); d -= DAY_MS) currentStreak++

  // Longest streak — max run of consecutive days across all history.
  const sortedDays = [...activeDaySet].sort((a, b) => a - b)
  let longestStreak = sortedDays.length > 0 ? 1 : 0
  let run = sortedDays.length > 0 ? 1 : 0
  for (let i = 1; i < sortedDays.length; i++) {
    run = sortedDays[i] - sortedDays[i - 1] === DAY_MS ? run + 1 : 1
    if (run > longestStreak) longestStreak = run
  }

  // Heatmap window — every calendar day from (today - heatmapDays + 1) … today.
  const heatmap: DayBucket[] = []
  const start = today - (heatmapDays - 1) * DAY_MS
  for (let d = start; d <= today; d += DAY_MS) {
    const agg = dayAgg.get(d)
    heatmap.push({
      day: dayKey(d),
      ts: d,
      tokens: agg?.tokens ?? 0,
      sessions: agg?.sessions ?? 0,
      cost: agg?.cost ?? 0,
    })
  }

  const topProjects = [...projectMap.values()]
    .sort((a, b) => b.tokens - a.tokens || b.sessions - a.sessions)
    .slice(0, 5)

  return {
    totalTokens: inputTokens + outputTokens + cacheTokens + reasoningTokens,
    inputTokens,
    outputTokens,
    cacheTokens,
    reasoningTokens,
    totalCost,
    sessionCount: rows.length,
    totalTurns,
    totalMessages,
    projectCount: projectMap.size,
    currentStreak,
    longestStreak,
    activeDays: activeDaySet.size,
    avgTurnsPerSession: rows.length > 0 ? totalTurns / rows.length : 0,
    topModel: topOf(modelMap),
    topProvider: topOf(providerMap),
    modeSplit,
    reasoningSplit,
    topProjects,
    heatmap,
  }
}
