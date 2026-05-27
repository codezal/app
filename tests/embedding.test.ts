// cosine similarity pure-logic testleri.
import { describe, it, expect } from "vitest"
import { cosine } from "@/lib/embedding"

describe("cosine", () => {
  it("aynı vektör → 1", () => {
    const v = [1, 2, 3]
    expect(cosine(v, v)).toBeCloseTo(1, 6)
  })

  it("dik vektör → 0", () => {
    expect(cosine([1, 0], [0, 1])).toBe(0)
  })

  it("ters vektör → -1", () => {
    expect(cosine([1, 2, 3], [-1, -2, -3])).toBeCloseTo(-1, 6)
  })

  it("sıfır vektör → 0", () => {
    expect(cosine([0, 0, 0], [1, 2, 3])).toBe(0)
  })

  it("farklı uzunluk → 0", () => {
    expect(cosine([1, 2], [1, 2, 3])).toBe(0)
  })

  it("genel durum sembolik", () => {
    // a=(1,2), b=(2,3) → dot=8, |a|=√5, |b|=√13, cos=8/(√5*√13)
    const a = [1, 2]
    const b = [2, 3]
    const expected = 8 / (Math.sqrt(5) * Math.sqrt(13))
    expect(cosine(a, b)).toBeCloseTo(expected, 6)
  })
})
