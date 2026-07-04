import { describe, it, expect } from "vitest"
import { isDoomRepeat } from "@/lib/tools/doom-loop"

describe("isDoomRepeat (threshold=3)", () => {
  it("boş history → false", () => {
    expect(isDoomRepeat([], "a")).toBe(false)
  })
  it("1 ardışık + bu = 2 < 3 → false", () => {
    expect(isDoomRepeat(["a"], "a")).toBe(false)
  })
  it("2 ardışık + bu = 3 → true", () => {
    expect(isDoomRepeat(["a", "a"], "a")).toBe(true)
  })
  it("3 ardışık + bu = 4 → true", () => {
    expect(isDoomRepeat(["a", "a", "a"], "a")).toBe(true)
  })
  it("farklı son key → ardışık kırılır, false", () => {
    expect(isDoomRepeat(["a", "a", "b"], "a")).toBe(false)
  })
  it("araya farklı girmiş → sadece son 'a' sayılır = 2, false", () => {
    expect(isDoomRepeat(["a", "b", "a"], "a")).toBe(false)
  })
  it("farklı key tamamen → false", () => {
    expect(isDoomRepeat(["a", "a"], "b")).toBe(false)
  })
})

describe("isDoomRepeat (custom threshold)", () => {
  it("threshold=2: 1 ardışık + bu = 2 → true", () => {
    expect(isDoomRepeat(["a"], "a", 2)).toBe(true)
  })
})
