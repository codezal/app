import { describe, it, expect } from "vitest"
import { briefDirective } from "@/lib/token-savers/brief-mode/levels"

describe("briefDirective", () => {
  it("lite → LITE başlığı içerir", () => {
    const d = briefDirective("lite")
    expect(d).toContain("BRIEF MODE — LITE")
  })

  it("full → FULL başlığı içerir", () => {
    const d = briefDirective("full")
    expect(d).toContain("BRIEF MODE — FULL")
  })

  it("ultra → ULTRA başlığı içerir", () => {
    const d = briefDirective("ultra")
    expect(d).toContain("BRIEF MODE — ULTRA")
  })

  it("her seviye farklı string döner", () => {
    const lite = briefDirective("lite")
    const full = briefDirective("full")
    const ultra = briefDirective("ultra")
    expect(lite).not.toBe(full)
    expect(full).not.toBe(ultra)
    expect(lite).not.toBe(ultra)
  })

  it("hiçbir seviye boş string değil", () => {
    expect(briefDirective("lite").length).toBeGreaterThan(0)
    expect(briefDirective("full").length).toBeGreaterThan(0)
    expect(briefDirective("ultra").length).toBeGreaterThan(0)
  })

  it("ultra en az full kadar kısa (karakter sayısı)", () => {
    expect(briefDirective("ultra").length).toBeLessThanOrEqual(briefDirective("full").length)
  })
})
