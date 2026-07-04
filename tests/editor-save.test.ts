import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { markSelfWrite, consumeSelfWrite } from "@/lib/editor-save"

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
})

describe("editor-save self-write baskılama", () => {
  it("işaretlenmemiş path → false", () => {
    expect(consumeSelfWrite("/x.ts")).toBe(false)
  })

  it("işaretleme sonrası pencere içinde → true", () => {
    markSelfWrite("/x.ts")
    expect(consumeSelfWrite("/x.ts")).toBe(true)
  })

  it("pencere içinde birden çok event baskılanır (silinmez)", () => {
    markSelfWrite("/x.ts")
    expect(consumeSelfWrite("/x.ts")).toBe(true)
    vi.advanceTimersByTime(200)
    expect(consumeSelfWrite("/x.ts")).toBe(true)
  })

  it("pencere dışında → false (bayat temizlenir)", () => {
    markSelfWrite("/x.ts")
    vi.advanceTimersByTime(800) // > 750ms
    expect(consumeSelfWrite("/x.ts")).toBe(false)
    expect(consumeSelfWrite("/x.ts")).toBe(false)
  })

  it("path'ler bağımsız", () => {
    markSelfWrite("/a.ts")
    expect(consumeSelfWrite("/b.ts")).toBe(false)
    expect(consumeSelfWrite("/a.ts")).toBe(true)
  })
})
