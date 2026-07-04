import { describe, it, expect } from "vitest"
import { hslToHex, hexToHsl } from "@/lib/color-utils"

function roughEq(a: string, b: string, tol = 2): boolean {
  const pa = parseHsl(a)
  const pb = parseHsl(b)
  if (!pa || !pb) return a === b
  return (
    Math.abs(pa.h - pb.h) <= tol &&
    Math.abs(pa.s - pb.s) <= tol &&
    Math.abs(pa.l - pb.l) <= tol
  )
}
function parseHsl(s: string) {
  const m = s.match(/^([\d.]+)\s+([\d.]+)%\s+([\d.]+)%$/)
  if (!m) return null
  return { h: +m[1], s: +m[2], l: +m[3] }
}

describe("hslToHex", () => {
  it("siyah (0 0% 0%) → #000000", () => {
    expect(hslToHex("0 0% 0%")).toBe("#000000")
  })

  it("beyaz (0 0% 100%) → #ffffff", () => {
    expect(hslToHex("0 0% 100%")).toBe("#ffffff")
  })

  it("saf kırmızı (0 100% 50%) → #ff0000", () => {
    expect(hslToHex("0 100% 50%")).toBe("#ff0000")
  })

  it("saf yeşil (120 100% 50%) → #00ff00", () => {
    expect(hslToHex("120 100% 50%")).toBe("#00ff00")
  })

  it("saf mavi (240 100% 50%) → #0000ff", () => {
    expect(hslToHex("240 100% 50%")).toBe("#0000ff")
  })

  it("geçersiz string → #000000 fallback", () => {
    expect(hslToHex("not-a-color")).toBe("#000000")
  })

  it("ondalıklı değerler → geçerli hex üretir", () => {
    const h = hslToHex("210.5 65.2% 48.3%")
    expect(h).toMatch(/^#[0-9a-f]{6}$/)
  })
})

describe("hexToHsl", () => {
  it("#000000 → 0 0% 0%", () => {
    expect(hexToHsl("#000000")).toBe("0 0% 0%")
  })

  it("#ffffff → 0 0% 100%", () => {
    expect(hexToHsl("#ffffff")).toBe("0 0% 100%")
  })

  it("#ff0000 → saf kırmızı", () => {
    const r = hexToHsl("#ff0000")
    const p = parseHsl(r)!
    expect(p.h).toBeCloseTo(0, 0)
    expect(p.s).toBeCloseTo(100, 0)
    expect(p.l).toBeCloseTo(50, 0)
  })

  it("#00ff00 → saf yeşil", () => {
    const r = hexToHsl("#00ff00")
    const p = parseHsl(r)!
    expect(p.h).toBeCloseTo(120, 0)
  })

  it("#0000ff → saf mavi", () => {
    const r = hexToHsl("#0000ff")
    const p = parseHsl(r)!
    expect(p.h).toBeCloseTo(240, 0)
  })

  it("3-haneli hex expand edilir", () => {
    // #fff = #ffffff
    expect(hexToHsl("#fff")).toBe(hexToHsl("#ffffff"))
  })

  it("geçersiz hex → 0 0% 0%", () => {
    expect(hexToHsl("not-hex")).toBe("0 0% 0%")
  })
})

describe("gidiş-dönüş tutarlılığı", () => {
  const samples = [
    "0 0% 0%",
    "0 0% 100%",
    "0 100% 50%",
    "120 100% 50%",
    "240 100% 50%",
    "210 65% 48%",
    "30 80% 60%",
  ]
  for (const hsl of samples) {
    it(`${hsl} → hex → hsl yaklaşık eşit`, () => {
      const hex = hslToHex(hsl)
      const back = hexToHsl(hex)
      expect(roughEq(hsl, back)).toBe(true)
    })
  }
})
