import { describe, it, expect } from "vitest"
import { createBudget } from "@/lib/orchestra/workflow/budget"

describe("createBudget", () => {
  it("total null → sınırsız (remaining Infinity)", () => {
    const b = createBudget(null)
    b.add(1000)
    expect(b.spent()).toBe(1000)
    expect(b.remaining()).toBe(Infinity)
  })

  it("tavan + remaining hesaplar", () => {
    const b = createBudget(100)
    b.add(30)
    b.add(50)
    expect(b.spent()).toBe(80)
    expect(b.remaining()).toBe(20)
  })

  it("aşımda remaining 0'da kalır (negatif değil)", () => {
    const b = createBudget(100)
    b.add(150)
    expect(b.remaining()).toBe(0)
  })

  it("negatif/sıfır eklemeyi yok sayar", () => {
    const b = createBudget(100)
    b.add(-5)
    b.add(0)
    expect(b.spent()).toBe(0)
  })
})
