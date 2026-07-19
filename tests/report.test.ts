import { describe, it, expect, beforeEach } from "vitest"
import { isNoiseError, dedupeKey, shouldSurface, __resetReportState } from "@/lib/report"

describe("isNoiseError", () => {
  it("AbortError adı → gürültü", () => {
    expect(isNoiseError("cancelled", "AbortError")).toBe(true)
  })
  it("aborted mesajı → gürültü", () => {
    expect(isNoiseError("The user aborted a request")).toBe(true)
  })
  it("exact cancellation messages are noise", () => {
    expect(isNoiseError("Canceled")).toBe(true)
    expect(isNoiseError("Cancelled")).toBe(true)
    expect(isNoiseError("Request canceled")).toBe(true)
    expect(isNoiseError("Request cancelled.")).toBe(true)
  })
  it("errors that only mention cancellation are not hidden", () => {
    expect(isNoiseError("Cancellation cleanup failed")).toBe(false)
  })
  it("plugin-http stream teardown (resource id invalid) → gürültü", () => {
    expect(isNoiseError("The resource id 12 is invalid.")).toBe(true)
  })
  it("geçici ağ hatası → gürültü", () => {
    expect(isNoiseError("error decoding response body")).toBe(true)
  })
  it("gerçek runtime hatası → gürültü DEĞİL", () => {
    expect(isNoiseError("Cannot read properties of undefined (reading 'x')")).toBe(false)
  })
})

describe("dedupeKey", () => {
  it("tür + mesaj + stack'in ilk frame'i", () => {
    const k = dedupeKey("error", "boom", "Error: boom\n  at foo (a.ts:1:1)\n  at bar")
    expect(k).toBe("error:boom:at foo (a.ts:1:1)")
  })
})

describe("shouldSurface", () => {
  beforeEach(() => __resetReportState())

  it("toggle kapalı → gönderme", () => {
    expect(shouldSurface({ message: "boom", stack: "", enabled: false })).toBe(false)
  })

  it("gürültü hatası → gönderme", () => {
    expect(shouldSurface({ message: "error decoding response body", stack: "", enabled: true })).toBe(false)
  })

  it("gerçek hata → gönder; aynısı tekrar → dedup ile gönderme", () => {
    const e = { message: "boom", stack: "Error: boom\n  at foo (a.ts:1:1)", enabled: true }
    expect(shouldSurface(e)).toBe(true)
    expect(shouldSurface(e)).toBe(false)
  })

  it("session tavanı 5 raporda durur", () => {
    for (let i = 0; i < 5; i++) {
      expect(shouldSurface({ message: `boom-${i}`, stack: "", enabled: true })).toBe(true)
    }
    expect(shouldSurface({ message: "boom-6", stack: "", enabled: true })).toBe(false)
  })
})
