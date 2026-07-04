import { describe, it, expect } from "vitest"
import { withLock } from "@/lib/lock"

describe("withLock", () => {
  it("aynı key → serialize (örtüşme yok)", async () => {
    let active = 0
    let maxActive = 0
    const task = () =>
      withLock("same", async () => {
        active++
        maxActive = Math.max(maxActive, active)
        await new Promise((r) => setTimeout(r, 10))
        active--
      })
    await Promise.all([task(), task(), task()])
    expect(maxActive).toBe(1)
  })

  it("farklı key → paralel (örtüşür)", async () => {
    let active = 0
    let maxActive = 0
    const task = (k: string) =>
      withLock(k, async () => {
        active++
        maxActive = Math.max(maxActive, active)
        await new Promise((r) => setTimeout(r, 10))
        active--
      })
    await Promise.all([task("a"), task("b"), task("c")])
    expect(maxActive).toBeGreaterThan(1)
  })

  it("hata kilidi serbest bırakır (sonraki çağrı çalışır)", async () => {
    await expect(
      withLock("err", async () => {
        throw new Error("x")
      }),
    ).rejects.toThrow("x")
    const out = await withLock("err", async () => 7)
    expect(out).toBe(7)
  })
})
