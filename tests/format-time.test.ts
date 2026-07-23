// formatRowTime artık göreli + dil-nötr ("42m", "3h", "1d"); mutlak tam zaman
// formatRowTimeAbsolute ile (hover title) verilir. now enjekte → deterministik.
import { describe, it, expect } from "vitest"
import { formatRowTime, formatRowTimeAbsolute } from "@/lib/format-time"

describe("formatRowTime (relative, language-neutral)", () => {
  const now = new Date(2026, 5, 4, 14, 30, 0).getTime()

  it("< 1dk → '<1m'", () => {
    expect(formatRowTime(now - 20_000, "en-US", now)).toBe("<1m")
  })

  it("dakika → 'Nm'", () => {
    expect(formatRowTime(now - 42 * 60_000, "en-US", now)).toBe("42m")
  })

  it("saat → 'Nh' (69dk 1h'a yuvarlanır, saat gösterilmez)", () => {
    const t = new Date(2026, 5, 4, 13, 21).getTime()
    expect(formatRowTime(t, "en-US", now)).toBe("1h")
  })

  it("aynı gün 13h fark → '13h' (duvar saati değil)", () => {
    const t = new Date(2026, 5, 4, 0, 50).getTime()
    expect(formatRowTime(t, "en-US", now)).toBe("13h")
  })

  it("gün (<7) → 'Nd'", () => {
    const t = new Date(2026, 5, 1, 9, 0).getTime()
    expect(formatRowTime(t, "en-US", now)).toBe("3d")
  })

  it("locale'den bağımsız — tr de en ile aynı göreli birim", () => {
    const t = new Date(2026, 5, 4, 13, 21).getTime()
    expect(formatRowTime(t, "tr", now)).toBe("1h")
  })

  it(">= 7 gün → kısa mutlak tarih (göreli birim yok)", () => {
    const t = new Date(2026, 3, 1, 9, 0).getTime()
    const out = formatRowTime(t, "en-US", now)
    expect(out).toMatch(/Apr/)
    expect(out).not.toMatch(/^\d+[mhd]$/)
  })

  it("geçersiz ms (NaN) → boş string", () => {
    expect(formatRowTime(NaN, "en-US", now)).toBe("")
  })

  it("bozuk locale throw etmez (göreli yol locale'i yoksayar)", () => {
    const t = new Date(2026, 5, 4, 13, 21).getTime()
    expect(formatRowTime(t, "!!!bad", now)).toBe("1h")
  })
})

describe("formatRowTimeAbsolute (hover title)", () => {
  it("zaman ayırıcı + ay içeren locale string döner", () => {
    const t = new Date(2026, 5, 4, 13, 21).getTime()
    const out = formatRowTimeAbsolute(t, "en-US")
    expect(out).toMatch(/:/)
    expect(out).toMatch(/Jun/)
  })

  it("geçersiz ms → boş string", () => {
    expect(formatRowTimeAbsolute(NaN, "en-US")).toBe("")
  })
})
