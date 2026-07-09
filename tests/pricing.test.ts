import { describe, it, expect } from "vitest"
import { pricingFor, costUsd, contextCap, compactionModelFor } from "@/lib/pricing"
import { resolveContextCap } from "@/lib/providers-catalog"

describe("pricingFor", () => {
  it("bilinen model → pricing döner", () => {
    const p = pricingFor("claude-sonnet-4-6")
    expect(p).not.toBeNull()
    expect(p!.inputPerMTok).toBe(3.0)
    expect(p!.outputPerMTok).toBe(15.0)
  })

  it("bilinmeyen model → null", () => {
    expect(pricingFor("nonexistent-model-xyz")).toBeNull()
  })

  it("cache alanları var olan modelde dolu", () => {
    const p = pricingFor("claude-opus-4-7")!
    expect(p.cacheReadPerMTok).toBeDefined()
    expect(p.cacheWritePerMTok).toBeDefined()
  })
})

describe("costUsd", () => {
  it("bilinmeyen model → 0", () => {
    expect(costUsd("unknown", { input: 1_000_000, output: 1_000_000 })).toBe(0)
  })

  it("sıfır kullanım → 0", () => {
    expect(costUsd("claude-sonnet-4-6", { input: 0, output: 0 })).toBe(0)
  })

  it("1M input token maliyeti doğru", () => {
    const cost = costUsd("claude-sonnet-4-6", { input: 1_000_000, output: 0 })
    expect(cost).toBeCloseTo(3.0)
  })

  it("1M output token maliyeti doğru", () => {
    const cost = costUsd("claude-sonnet-4-6", { input: 0, output: 1_000_000 })
    expect(cost).toBeCloseTo(15.0)
  })

  it("cache read ayrı fiyatlandırılır", () => {
    // cacheReadPerMTok = 0.3, inputPerMTok = 3.0
    const withCache = costUsd("claude-sonnet-4-6", {
      input: 1_000_000,
      output: 0,
      cacheRead: 500_000,
    })
    const withoutCache = costUsd("claude-sonnet-4-6", {
      input: 1_000_000,
      output: 0,
    })
    expect(withCache).toBeLessThan(withoutCache)
  })

  it("cache write ayrı fiyatlandırılır", () => {
    const p = pricingFor("claude-sonnet-4-6")!
    const cost = costUsd("claude-sonnet-4-6", {
      input: 1_000_000,
      output: 0,
      cacheWrite: 1_000_000,
    })
    expect(cost).toBeCloseTo((p.cacheWritePerMTok ?? p.inputPerMTok))
  })

  it("cacheRead cache alanı olmayan modelde inputPerMTok ile hesaplanır", () => {
    const p = pricingFor("gpt-5.5")!
    expect(p.cacheReadPerMTok).toBeUndefined()
    const cost = costUsd("gpt-5.5", { input: 1_000_000, output: 0, cacheRead: 1_000_000 })
    expect(cost).toBeCloseTo(p.inputPerMTok)
  })

  it("negatif billableInput 0 olarak kısıtlanır", () => {
    const cost = costUsd("claude-sonnet-4-6", {
      input: 100,
      output: 0,
      cacheRead: 1_000_000,
    })
    expect(cost).toBeGreaterThanOrEqual(0)
  })

  it(">200K input → üst-tier oranı; <200K → taban oranı", () => {
    const fb = {
      inputPerMTok: 3,
      outputPerMTok: 15,
      contextOver200k: { inputPerMTok: 6, outputPerMTok: 22.5 },
    }
    expect(costUsd("unknown-x", { input: 300_000, output: 0 }, fb)).toBeCloseTo(1.8)
    // 100K input (<200K) → taban inputPerMTok=3
    expect(costUsd("unknown-x", { input: 100_000, output: 0 }, fb)).toBeCloseTo(0.3)
  })

  it("hardcoded modelde tier yok → fallback (katalog) tier'ı uzun bağlamda uygulanır", () => {
    const fb = {
      inputPerMTok: 3,
      outputPerMTok: 15,
      contextOver200k: { inputPerMTok: 6, outputPerMTok: 30 },
    }
    const c = costUsd("claude-sonnet-4-6", { input: 300_000, output: 0 }, fb)
    expect(c).toBeCloseTo(1.8) // 0.3M * 6
  })
})

describe("contextCap", () => {
  it("claude modeli → 1_000_000", () => {
    expect(contextCap("claude-opus-4-7")).toBe(1_000_000)
  })

  it("gemini modeli → 2_000_000", () => {
    expect(contextCap("gemini-2.5-pro")).toBe(2_000_000)
  })

  it("gpt-5 modeli → 400_000", () => {
    expect(contextCap("gpt-5.4")).toBe(400_000)
  })

  it("deepseek-v4 → 1_000_000", () => {
    expect(contextCap("deepseek-v4-pro")).toBe(1_000_000)
  })

  it("deepseek legacy → 128_000", () => {
    expect(contextCap("deepseek-chat")).toBe(128_000)
  })

  it("bilinmeyen → 200_000", () => {
    expect(contextCap("some-unknown-model")).toBe(200_000)
  })
})

describe("resolveContextCap", () => {
  it("mlx local runtime window'unu kullanır", () => {
    expect(resolveContextCap(undefined, "mlx", "mlx-community/Qwen3-4B-4bit", 32768)).toBe(32768)
  })
})

describe("compactionModelFor", () => {
  it("anthropic → haiku", () => {
    const r = compactionModelFor("anthropic")
    expect(r.provider).toBe("anthropic")
    expect(r.model).toContain("haiku")
  })

  it("openai → mini", () => {
    const r = compactionModelFor("openai")
    expect(r.model).toContain("mini")
  })

  it("google → flash", () => {
    const r = compactionModelFor("google")
    expect(r.model).toContain("flash")
  })

  it("deepseek → flash", () => {
    const r = compactionModelFor("deepseek")
    expect(r.model).toContain("flash")
  })

  it("bilinmeyen → aynı provider, boş model", () => {
    const r = compactionModelFor("some-custom")
    expect(r.provider).toBe("some-custom")
    expect(r.model).toBe("")
  })
})
