import { describe, it, expect } from "vitest"
import { parseMeta } from "@/lib/orchestra/workflow/meta"

describe("parseMeta", () => {
  it("geçerli meta'yı parse eder", () => {
    const s = `export const meta = { name: 'x', description: 'd', phases: [{ title: 'A' }, { title: 'B' }] }\nreturn 1`
    const m = parseMeta(s)
    expect(m.name).toBe("x")
    expect(m.description).toBe("d")
    expect(m.phases?.map((p) => p.title)).toEqual(["A", "B"])
  })

  it("name yoksa reddeder", () => {
    expect(() => parseMeta(`export const meta = { description: 'd' }`)).toThrow()
  })

  it("`export const meta` yoksa reddeder", () => {
    expect(() => parseMeta(`const x = 1`)).toThrow()
  })

  it("literal-dışı (fonksiyon çağrısı) reddeder", () => {
    expect(() => parseMeta(`export const meta = { name: foo(), description: 'd' }`)).toThrow()
  })

  it("string içindeki brace'i yanlış kapanış saymaz", () => {
    const m = parseMeta(`export const meta = { name: 'a}b', description: 'd' }`)
    expect(m.name).toBe("a}b")
  })
})
