// enjekte edilerek deterministik test edilir. 24h (hour12:false) + locale-aware.
import { describe, it, expect } from "vitest"
import { formatRowTime } from "@/lib/format-time"

describe("formatRowTime", () => {
  const now = new Date(2026, 5, 4, 14, 30).getTime()

  it("aynı gün → 24h saat (HH:mm, AM/PM yok)", () => {
    const t = new Date(2026, 5, 4, 13, 21).getTime()
    expect(formatRowTime(t, "en-US", now)).toBe("13:21")
  })

  it("gece yarısı aynı gün → 00:xx (12h değil)", () => {
    const t = new Date(2026, 5, 4, 0, 50).getTime()
    expect(formatRowTime(t, "en-US", now)).toBe("00:50")
  })

  it("locale'den bağımsız 24h — tr de aynı saat formu", () => {
    const t = new Date(2026, 5, 4, 13, 21).getTime()
    expect(formatRowTime(t, "tr", now)).toBe("13:21")
  })

  it("farklı gün → kısa tarih (saat değil)", () => {
    const t = new Date(2026, 5, 1, 9, 0).getTime()
    const out = formatRowTime(t, "en-US", now)
    expect(out).toMatch(/Jun/)
    expect(out).not.toMatch(/:/)
  })

  it("geçersiz ms (NaN) → boş string", () => {
    expect(formatRowTime(NaN, "en-US", now)).toBe("")
  })

  it("geçersiz locale → exception yutulur, runtime default'a düşer", () => {
    const t = new Date(2026, 5, 4, 13, 21).getTime()
    // Bozuk locale tag → toLocale* throw → catch → undefined locale ile 24h.
    expect(formatRowTime(t, "!!!bad", now)).toBe("13:21")
  })
})
