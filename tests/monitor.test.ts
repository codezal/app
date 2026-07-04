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
})
