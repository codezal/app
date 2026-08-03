// stats — computeStats aggregation + helpers (pure logic, pinned `now`).
import { describe, it, expect } from "vitest"
import { computeStats, dayStart, dayKey, rowTokens, daysBefore, isNextDay, type SessionUsageRow } from "@/lib/stats"

const DAY = 86_400_000
// June 9 2026, noon local — mid-summer avoids DST day-boundary drift in tests.
const NOW = new Date(2026, 5, 9, 12, 0, 0).getTime()

// Build a row updated `daysAgo` before NOW with optional usage/meta overrides.
function row(daysAgo: number, over: Partial<SessionUsageRow> = {}): SessionUsageRow {
  return {
    id: `ses_${daysAgo}`,
    updatedAt: NOW - daysAgo * DAY,
    provider: "openai",
    model: "gpt-x",
    mode: "build",
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    reasoningTokens: 0,
    costUsd: 0,
    turns: 0,
    ...over,
  }
}

describe("helpers", () => {
  it("rowTokens sums every token kind", () => {
    expect(
      rowTokens(
        row(0, {
          inputTokens: 100,
          outputTokens: 50,
          cacheReadTokens: 10,
          cacheWriteTokens: 5,
          reasoningTokens: 20,
        }),
      ),
    ).toBe(185)
  })

  it("dayStart is local midnight; dayKey is yyyy-mm-dd", () => {
    const ds = dayStart(NOW)
    expect(new Date(ds).getHours()).toBe(0)
    expect(dayKey(NOW)).toBe("2026-06-09")
  })

  it("daysBefore returns the Nth previous local midnight (M42)", () => {
    const today = dayStart(NOW)
    for (const n of [1, 2, 7, 30]) {
      const d = daysBefore(today, n)
      const dt = new Date(d)
      expect(dt.getHours()).toBe(0)
      expect(dt.getMinutes()).toBe(0)
      // Calendar distance, not a fixed 24 h multiple (DST days are 23/25 h).
      const back = new Date(today)
      back.setDate(back.getDate() - n)
      back.setHours(0, 0, 0, 0)
      expect(d).toBe(back.getTime())
    }
  })

  it("isNextDay detects consecutive calendar days (M42)", () => {
    const today = dayStart(NOW)
    expect(isNextDay(daysBefore(today, 1), today)).toBe(true)
    expect(isNextDay(daysBefore(today, 2), today)).toBe(false)
    expect(isNextDay(today, daysBefore(today, 1))).toBe(false)
  })
})

describe("computeStats — empty", () => {
  const s = computeStats([], { now: NOW, heatmapDays: 7, totalMessages: 0 })
  it("zeroes everything, no top entries", () => {
    expect(s.sessionCount).toBe(0)
    expect(s.totalTokens).toBe(0)
    expect(s.currentStreak).toBe(0)
    expect(s.longestStreak).toBe(0)
    expect(s.topModel).toBeUndefined()
    expect(s.topProjects).toEqual([])
  })
  it("heatmap still spans the full window", () => {
    expect(s.heatmap).toHaveLength(7)
    expect(s.heatmap.every((d) => d.tokens === 0)).toBe(true)
    expect(s.heatmap[6].day).toBe("2026-06-09") // last cell is today
  })
})

describe("computeStats — totals & tokens", () => {
  const rows = [
    row(0, { inputTokens: 100, outputTokens: 50, costUsd: 0.5, turns: 3 }),
    row(1, { outputTokens: 200, cacheReadTokens: 40, costUsd: 0.25, turns: 2 }),
  ]
  const s = computeStats(rows, { now: NOW, totalMessages: 42 })
  it("sums tokens, cost, turns, messages", () => {
    expect(s.totalTokens).toBe(100 + 50 + 200 + 40)
    expect(s.inputTokens).toBe(100)
    expect(s.cacheTokens).toBe(40)
    expect(s.totalCost).toBeCloseTo(0.75)
    expect(s.totalTurns).toBe(5)
    expect(s.totalMessages).toBe(42)
    expect(s.avgTurnsPerSession).toBeCloseTo(2.5)
  })
})

describe("computeStats — streaks", () => {
  // Active: today, -1, -2 (run of 3) … gap … -5, -6 (run of 2).
  const rows = [row(0), row(1), row(2), row(5), row(6)]
  const s = computeStats(rows, { now: NOW })
  it("current streak counts back from today", () => {
    expect(s.currentStreak).toBe(3)
  })
  it("longest streak is the max consecutive run", () => {
    expect(s.longestStreak).toBe(3)
    expect(s.activeDays).toBe(5)
  })
  it("current streak is 0 when today is inactive", () => {
    const s2 = computeStats([row(1), row(2)], { now: NOW })
    expect(s2.currentStreak).toBe(0)
    expect(s2.longestStreak).toBe(2)
  })

  it("streak/heatmap use calendar days, not fixed 24 h steps (M42)", () => {
    // Build rows on EXPLICIT consecutive calendar days (noon local) so the test
    // does not itself rely on `now - n*DAY` arithmetic. The streak must count
    // every day even though real day lengths vary (DST = 23/25 h).
    const y = 2026
    const m = 2 // March — contains DST transitions in many zones.
    const day = (d: number, hh = 12) => new Date(y, m, d, hh, 0, 0).getTime()
    const todayNoon = day(12)
    const rows = [10, 11, 12].map((d, i) => row(0, { id: `dst_${i}`, updatedAt: day(d) }))
    const s = computeStats(rows, { now: todayNoon, heatmapDays: 5 })
    expect(s.currentStreak).toBe(3)
    expect(s.longestStreak).toBe(3)
    // Heatmap covers 5 consecutive calendar days ending on today.
    expect(s.heatmap).toHaveLength(5)
    expect(s.heatmap[4].day).toBe("2026-03-12")
    expect(s.heatmap[3].day).toBe("2026-03-11")
    expect(s.heatmap[0].day).toBe("2026-03-08")
    // All heatmap cells are distinct, ordered, on local midnight.
    for (let i = 0; i < s.heatmap.length; i++) {
      expect(new Date(s.heatmap[i].ts).getHours()).toBe(0)
      if (i > 0) expect(isNextDay(s.heatmap[i - 1].ts, s.heatmap[i].ts)).toBe(true)
    }
  })
})

describe("computeStats — rankings & splits", () => {
  const rows = [
    row(0, { provider: "openai", model: "gpt-x", inputTokens: 500, reasoningEffort: "high", mode: "build" }),
    row(1, { provider: "anthropic", model: "claude", inputTokens: 100, reasoningEffort: "high", mode: "plan" }),
    row(2, { provider: "anthropic", model: "claude", inputTokens: 50, reasoningEffort: "medium", mode: "build" }),
  ]
  const s = computeStats(rows, { now: NOW })
  it("top model/provider ranked by tokens", () => {
    expect(s.topModel?.key).toBe("openai/gpt-x")
    // openai = 500 tokens (1 session) beats anthropic = 150 tokens (2 sessions).
    expect(s.topProvider?.key).toBe("openai")
  })
  it("mode split counts sessions per mode", () => {
    expect(s.modeSplit).toEqual({ build: 2, plan: 1 })
  })
  it("reasoning split counts per effort", () => {
    expect(s.reasoningSplit).toEqual({ high: 2, medium: 1 })
  })
})

describe("computeStats — top projects", () => {
  const rows = [
    row(0, { projectPath: "/a", inputTokens: 100 }),
    row(1, { projectPath: "/b", inputTokens: 300 }),
    row(2, { projectPath: "/a", inputTokens: 50 }),
    row(3, {}), // unfiled → excluded from projects
  ]
  const s = computeStats(rows, { now: NOW })
  it("groups by path, sorts by tokens, excludes unfiled", () => {
    expect(s.projectCount).toBe(2)
    expect(s.topProjects.map((p) => p.key)).toEqual(["/b", "/a"])
    expect(s.topProjects[1].tokens).toBe(150)
    expect(s.topProjects[1].sessions).toBe(2)
  })
})
