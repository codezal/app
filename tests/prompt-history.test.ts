import { describe, it, expect } from "vitest"
import { appendHistory } from "@/lib/prompt-history"

describe("appendHistory (Ctrl+R prompt geçmişi)", () => {
  it("yeni prompt sona (en yeni) eklenir", () => {
    expect(appendHistory(["a", "b"], "c")).toEqual(["a", "b", "c"])
  })

  it("boş/whitespace eklenmez", () => {
    expect(appendHistory(["a"], "")).toEqual(["a"])
    expect(appendHistory(["a"], "   ")).toEqual(["a"])
  })

  it("trim edilir", () => {
    expect(appendHistory([], "  hi  ")).toEqual(["hi"])
  })

  it("tekrar eden prompt en sona taşınır (dedupe, çift kayıt yok)", () => {
    expect(appendHistory(["a", "b", "c"], "a")).toEqual(["b", "c", "a"])
  })

  it("max aşılınca en eski düşer", () => {
    expect(appendHistory(["a", "b", "c"], "d", 3)).toEqual(["b", "c", "d"])
  })

  it("dedupe + max birlikte", () => {
    expect(appendHistory(["a", "b", "c"], "b", 3)).toEqual(["a", "c", "b"])
  })
})
