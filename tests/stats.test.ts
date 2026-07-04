// stats — computeStats aggregation + helpers (pure logic, pinned `now`).
import { describe, it, expect } from "vitest"
import { computeStats, dayStart, dayKey, rowTokens, type SessionUsageRow } from "@/lib/stats"

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
    expect(s.modeSplit).toEqual({ build: 2, plan: 1, orchestra: 0 })
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
