import { describe, it, expect } from "vitest"
import { lineMatches } from "@/lib/tools/monitor"

describe("lineMatches", () => {
  it("pattern yoksa her satır eşleşir", () => {
    expect(lineMatches("anything", undefined)).toBe(true)
    expect(lineMatches("", undefined)).toBe(true)
  })

  it("regex eşleşmesi", () => {
    expect(lineMatches("Build ERROR: failed", "ERROR|FAILED")).toBe(true)
    expect(lineMatches("all good", "ERROR|FAILED")).toBe(false)
  })

  it("regex büyük/küçük harf duyarlı (verildiği gibi)", () => {
    expect(lineMatches("ready in 200ms", "ready")).toBe(true)
    expect(lineMatches("READY", "ready")).toBe(false)
  })

  it("geçersiz regex literal substring aramasına düşer", () => {
    expect(lineMatches("got [error] here", "[error")).toBe(true)
    expect(lineMatches("clean line", "[error")).toBe(false)
  })

  it("anchor / quantifier desteklenir", () => {
    expect(lineMatches("elapsed_steps=42", "elapsed_steps=\\d+")).toBe(true)
    expect(lineMatches("elapsed_steps=", "elapsed_steps=\\d+")).toBe(false)
  })

  it("nested-quantifier patterns fall back to literal match (ReDoS guard)", () => {
    // (a+)+ is the classic catastrophic-backtracking shape — it must never be
    // compiled as a regex here, only matched literally.
    expect(lineMatches("x (a+)+ y", "(a+)+")).toBe(true)
    expect(lineMatches("aaa", "(a+)+")).toBe(false)
    expect(lineMatches("repeat (\\d+)* end", "(\\d+)*")).toBe(true)
    // Safe quantifiers are unaffected.
    expect(lineMatches("ab ab", "(ab)+")).toBe(true)
  })

  it("very long lines are capped before matching", () => {
    const head = "a".repeat(20000)
    expect(lineMatches(`${head}needle`, "needle")).toBe(false) // past the cap
    expect(lineMatches(`${"a".repeat(100)}needle`, "needle")).toBe(true)
  })
})
