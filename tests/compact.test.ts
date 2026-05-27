// compact — shouldCompact + targetTokensAfterCompact pure logic.
import { describe, it, expect } from "vitest"
import { shouldCompact, targetTokensAfterCompact } from "@/lib/compact"
import type { AutoCompactSettings } from "@/store/types"

const cfg: AutoCompactSettings = {
  enabled: true,
  triggerPct: 90,
  targetPct: 40,
  keepLast: 10,
}

describe("shouldCompact", () => {
  it("enabled=false → her zaman false", () => {
    expect(shouldCompact(999999, "gpt-4o", { ...cfg, enabled: false })).toBe(false)
  })

  it("0 token → false", () => {
    expect(shouldCompact(0, "gpt-4o", cfg)).toBe(false)
  })

  it("trigger altında → false", () => {
    // 128K context cap, %90 = 115200. 50000 < 115200.
    expect(shouldCompact(50_000, "gpt-4o", cfg)).toBe(false)
  })

  it("trigger üstünde → true", () => {
    // Cap modele göre değişir; 10M token'la her cap aşılır.
    expect(shouldCompact(10_000_000, "gpt-4o", cfg)).toBe(true)
  })
})

describe("targetTokensAfterCompact", () => {
  it("targetPct uygulanır", () => {
    const t = targetTokensAfterCompact("gpt-4o", cfg)
    expect(t).toBeGreaterThan(0)
    // %40, küçük bir aralıkta olmalı
    expect(t).toBeLessThan(targetTokensAfterCompact("gpt-4o", { ...cfg, targetPct: 50 }))
  })
})
