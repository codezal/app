import { describe, it, expect } from "vitest"
import { createId, extractTimestamp } from "@/lib/id"

describe("createId / extractTimestamp", () => {
  it("güncel zaman damgasını kayıpsız round-trip eder (48-bit overflow regresyonu)", () => {
    const before = Date.now()
    const id = createId("message")
    const after = Date.now()
    const ts = extractTimestamp(id)
    expect(ts).toBeGreaterThanOrEqual(before)
    expect(ts).toBeLessThanOrEqual(after)
  })

  it("decode edilen zaman 2020 sonrası (1972 bug eşiğinin çok üstünde)", () => {
    const ts = extractTimestamp(createId("session"))
    expect(ts).toBeGreaterThan(1577836800000) // 2020-01-01
  })

  it("aynı ms içinde üretilen id'ler zaman-monotonik string sırasında", () => {
    const ids = Array.from({ length: 50 }, () => createId("message"))
    expect([...ids].sort()).toEqual(ids)
  })

  it("prefix korunur, '_' ayraçlı", () => {
    expect(createId("message").startsWith("msg_")).toBe(true)
    expect(createId("session").startsWith("ses_")).toBe(true)
  })

  it("ayraçsız id throw eder", () => {
    expect(() => extractTimestamp("noseparator")).toThrow()
  })
})
