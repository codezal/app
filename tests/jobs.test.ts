import { describe, it, expect } from "vitest"
import { pushRing } from "@/store/jobs"

describe("pushRing", () => {
  it("boş buffer → tek eleman", () => {
    expect(pushRing([], "a", 3)).toEqual(["a"])
  })
  it("tavan altı → sona ekler", () => {
    expect(pushRing(["a", "b"], "c", 5)).toEqual(["a", "b", "c"])
  })
  it("tavan aşımı → baştan atar (FIFO)", () => {
    expect(pushRing(["a", "b", "c"], "d", 3)).toEqual(["b", "c", "d"])
  })
  it("tavan tam dolu sınırı", () => {
    expect(pushRing(["a", "b"], "c", 3)).toEqual(["a", "b", "c"])
  })
  it("max=1 → sadece son", () => {
    expect(pushRing(["a", "b"], "c", 1)).toEqual(["c"])
  })

  it("tek satır byte tavanını aşarsa kırpılır", () => {
    const huge = "x".repeat(20_000)
    const r = pushRing([], huge, 500)
    expect(r[0].length).toBeLessThan(20_000)
    expect(r[0]).toContain("kısaltıldı")
  })

  it("toplam byte tavanı aşılınca satır-sayısından önce eski satırlar düşer", () => {
    let buf: string[] = []
    const line = "y".repeat(8_000)
    for (let i = 0; i < 100; i++) buf = pushRing(buf, line, 500)
    const total = buf.reduce((s, l) => s + l.length + 1, 0)
    expect(total).toBeLessThanOrEqual(256 * 1024)
    expect(buf.length).toBeLessThan(100)
  })
})
