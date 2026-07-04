import { describe, it, expect } from "vitest"
import {
  salience,
  recency,
  relevance,
  jaccard,
  selectForContext,
  consolidate,
  renderMemoryBlock,
  estimateTokens,
} from "../src/lib/memory-store/core"
import { DEFAULT_MEMORY_CONFIG, type MemoryEntry, type MemoryLayer } from "../src/lib/memory-store/types"

const DAY = 86_400_000
const NOW = 1_700_000_000_000

function entry(p: Partial<MemoryEntry> & { text: string; layer: MemoryLayer }): MemoryEntry {
  return {
    id: p.id ?? Math.random().toString(36).slice(2),
    text: p.text,
    layer: p.layer,
    scope: p.scope ?? "project",
    category: p.category,
    createdAt: p.createdAt ?? NOW,
    lastUsedAt: p.lastUsedAt ?? NOW,
    useCount: p.useCount ?? 0,
    baseSalience: p.baseSalience ?? 0.5,
  }
}

describe("salience + recency", () => {
  it("identity/pinned çürümez, episode çürür", () => {
    const old = { createdAt: NOW - 60 * DAY, lastUsedAt: NOW - 60 * DAY }
    expect(recency(entry({ text: "x", layer: "identity", ...old }), NOW, DEFAULT_MEMORY_CONFIG)).toBe(1)
    expect(recency(entry({ text: "x", layer: "episode", ...old }), NOW, DEFAULT_MEMORY_CONFIG)).toBeLessThan(0.1)
  })

  it("yarı-ömürde recency ~0.5", () => {
    const e = entry({ text: "x", layer: "episode", lastUsedAt: NOW - 14 * DAY, createdAt: NOW - 14 * DAY })
    expect(recency(e, NOW, DEFAULT_MEMORY_CONFIG)).toBeCloseTo(0.5, 1)
  })

  it("kullanım salience'ı artırır", () => {
    const a = entry({ text: "x", layer: "episode", useCount: 0 })
    const b = entry({ text: "x", layer: "episode", useCount: 10 })
    expect(salience(b, NOW)).toBeGreaterThan(salience(a, NOW))
  })
})

describe("relevance + jaccard", () => {
  it("sorgu token örtüşmesi", () => {
    const e = entry({ text: "kullanıcı vitest yerine jest tercih eder", layer: "pinned" })
    expect(relevance(e, "jest mi vitest mi")).toBeGreaterThan(0)
    expect(relevance(e, "tamamen alakasız konu")).toBe(0)
  })
  it("jaccard benzerliği", () => {
    expect(jaccard("dark mode tercih", "dark mode tercih")).toBe(1)
    expect(jaccard("a b c", "x y z")).toBe(0)
  })
})

describe("selectForContext", () => {
  it("identity/pinned'i episode'dan önce verir", () => {
    const entries = [
      entry({ text: "ep", layer: "episode", baseSalience: 0.9 }),
      entry({ text: "kimlik", layer: "identity", baseSalience: 0.3 }),
    ]
    const out = selectForContext(entries, { now: NOW })
    expect(out[0].layer).toBe("identity")
  })

  it("token bütçesine uyar", () => {
    const big = "kelime ".repeat(100) // ~700 char ≈ 175 tok
    const entries = Array.from({ length: 20 }, (_, i) =>
      entry({ text: big + i, layer: "episode", baseSalience: 0.5 }),
    )
    const out = selectForContext(entries, { now: NOW, budgetTokens: 800 })
    const tot = out.reduce((s, e) => s + estimateTokens(e.text) + 2, 0)
    expect(tot).toBeLessThanOrEqual(800 + 200)
    expect(out.length).toBeLessThan(20)
  })

  it("sorgu ilgili episode'u öne çeker", () => {
    const entries = [
      entry({ text: "kullanıcı kahveyi sever", layer: "episode", baseSalience: 0.5, id: "coffee" }),
      entry({ text: "proje react kullanır", layer: "episode", baseSalience: 0.5, id: "react" }),
    ]
    const out = selectForContext(entries, { now: NOW, query: "react sürümü ne", budgetTokens: 50 })
    expect(out[0].id).toBe("react")
  })
})

describe("consolidate", () => {
  it("benzer entry'leri merge eder, useCount toplar", () => {
    const entries = [
      entry({ text: "kullanıcı dark mode tercih eder", layer: "episode", useCount: 1 }),
      entry({ text: "kullanıcı dark mode tercih eder", layer: "episode", useCount: 2 }),
    ]
    const r = consolidate(entries, NOW)
    expect(r.merged).toBe(1)
    expect(r.entries).toHaveLength(1)
    expect(r.entries[0].useCount).toBe(3)
  })

  it("sık kullanılan episode'u pinned'e terfi eder", () => {
    const r = consolidate([entry({ text: "sık", layer: "episode", useCount: 5 })], NOW)
    expect(r.promoted).toBe(1)
    expect(r.entries[0].layer).toBe("pinned")
  })

  it("düşük salience + eski episode'u evict eder, identity'i korur", () => {
    const oldWeak = entry({
      text: "zayıf eski gözlem",
      layer: "episode",
      baseSalience: 0.05,
      createdAt: NOW - 30 * DAY,
      lastUsedAt: NOW - 30 * DAY,
    })
    const id = entry({ text: "kimlik", layer: "identity", baseSalience: 0.05, createdAt: NOW - 99 * DAY })
    const r = consolidate([oldWeak, id], NOW)
    expect(r.evicted).toBe(1)
    expect(r.entries.map((e) => e.layer)).toEqual(["identity"])
  })

  it("maxEpisodes tavanını uygular", () => {
    const words = ["react", "vitest", "tailwind", "rust", "tauri", "zustand", "vercel", "monaco", "sqlite", "fflate"]
    const entries = words.map((w, i) =>
      entry({ text: `proje ${w} tercih`, layer: "episode", baseSalience: 0.1 + i * 0.05 }),
    )
    const r = consolidate(entries, NOW, { ...DEFAULT_MEMORY_CONFIG, maxEpisodes: 4 })
    expect(r.entries.filter((e) => e.layer === "episode")).toHaveLength(4)
  })

  it("girişi mutasyon etmez (saf)", () => {
    const entries = [entry({ text: "x", layer: "episode", useCount: 5 })]
    consolidate(entries, NOW)
    expect(entries[0].layer).toBe("episode")
  })
})

describe("renderMemoryBlock", () => {
  it("katmanları gruplar, boşta '' döner", () => {
    expect(renderMemoryBlock([])).toBe("")
    const md = renderMemoryBlock([
      entry({ text: "kimliğim", layer: "identity" }),
      entry({ text: "gözlem", layer: "episode" }),
    ])
    expect(md).toContain("Identity / durable preferences")
    expect(md).toContain("kimliğim")
    expect(md).toContain("Relevant past observations")
  })
})
