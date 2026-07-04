import { describe, it, expect } from "vitest"
import { hashString, identiconColor, identiconCells } from "@/lib/identicon"
import { codenameFor } from "@/lib/orchestra/codenames"

describe("hashString", () => {
  it("deterministik — aynı girdi aynı çıktı", () => {
    expect(hashString("code-reviewer")).toBe(hashString("code-reviewer"))
  })

  it("farklı girdi farklı çıktı (çakışma beklenmez)", () => {
    expect(hashString("code-reviewer")).not.toBe(hashString("debugger"))
  })

  it("32-bit unsigned aralığında", () => {
    const h = hashString("worker-xyz")
    expect(h).toBeGreaterThanOrEqual(0)
    expect(h).toBeLessThanOrEqual(0xffffffff)
    expect(Number.isInteger(h)).toBe(true)
  })
})

describe("identiconColor", () => {
  it("deterministik hsl döner", () => {
    const c = identiconColor("Kepler")
    expect(c).toBe(identiconColor("Kepler"))
    expect(c).toMatch(/^hsl\(\d{1,3}, 62%, 58%\)$/)
  })
})

describe("identiconCells", () => {
  it("5x5 grid", () => {
    const g = identiconCells("Curie")
    expect(g).toHaveLength(5)
    for (const row of g) expect(row).toHaveLength(5)
  })

  it("dikey simetrik (col === 4-col)", () => {
    const g = identiconCells("Tesla")
    for (const row of g) {
      expect(row[0]).toBe(row[4])
      expect(row[1]).toBe(row[3])
    }
  })

  it("deterministik", () => {
    expect(identiconCells("Fermi")).toEqual(identiconCells("Fermi"))
  })
})

describe("codenameFor", () => {
  it("deterministik", () => {
    expect(codenameFor("worker-1")).toBe(codenameFor("worker-1"))
  })

  it("havuzdan tek kelimelik isim döner", () => {
    const name = codenameFor("abc123")
    expect(typeof name).toBe("string")
    expect(name.length).toBeGreaterThan(0)
    expect(name).not.toMatch(/\s/)
  })
})
