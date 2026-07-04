import { describe, it, expect } from "vitest"
import { Semaphore } from "@/lib/async/semaphore"

describe("Semaphore", () => {
  it("eşzamanlılığı tavanla sınırlar", async () => {
    const sem = new Semaphore(2)
    let active = 0
    let maxActive = 0
    const task = () =>
      sem.run(async () => {
        active++
        maxActive = Math.max(maxActive, active)
        await new Promise((r) => setTimeout(r, 10))
        active--
      })
    await Promise.all([task(), task(), task(), task(), task()])
    expect(maxActive).toBeLessThanOrEqual(2)
    expect(maxActive).toBeGreaterThan(0)
  })

  it("hata atan task slot'u serbest bırakır", async () => {
    const sem = new Semaphore(1)
    await expect(
      sem.run(async () => {
        throw new Error("x")
      }),
    ).rejects.toThrow("x")
    const out = await sem.run(async () => 42)
    expect(out).toBe(42)
  })
})
