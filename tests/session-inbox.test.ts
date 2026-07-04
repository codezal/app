import { describe, it, expect, beforeEach } from "vitest"
import {
  enqueueInbox,
  hasInbox,
  takeInbox,
  clearInbox,
  normHandle,
  resolveHandle,
  handleTaken,
  listPeers,
  framePeerMessage,
  rateOk,
  clearRateLog,
} from "@/lib/session-inbox"
import type { SessionMeta } from "@/store/types"

const meta = (id: string, title: string, handle?: string): SessionMeta => ({
  id,
  title,
  updatedAt: 0,
  ...(handle ? { handle } : {}),
})

beforeEach(() => {
  clearInbox()
  clearRateLog()
})

describe("inbox FIFO kuyruğu", () => {
  it("enqueue → has → take sırası (FIFO), boşalınca anahtar silinir", () => {
    expect(hasInbox("s1")).toBe(false)
    enqueueInbox("s1", { fromLabel: "@a", text: "first", at: 1 })
    enqueueInbox("s1", { fromLabel: "@b", text: "second", at: 2 })
    expect(hasInbox("s1")).toBe(true)
    expect(takeInbox("s1")?.text).toBe("first")
    expect(takeInbox("s1")?.text).toBe("second")
    expect(hasInbox("s1")).toBe(false)
    expect(takeInbox("s1")).toBeUndefined()
  })

  it("kuyruklar session başına bağımsız", () => {
    enqueueInbox("s1", { fromLabel: "@a", text: "x", at: 1 })
    enqueueInbox("s2", { fromLabel: "@a", text: "y", at: 1 })
    expect(takeInbox("s2")?.text).toBe("y")
    expect(hasInbox("s1")).toBe(true)
    expect(hasInbox("s2")).toBe(false)
  })
})

describe("normHandle", () => {
  it("trim + baştaki @ at + küçük harf", () => {
    expect(normHandle("  @CTO ")).toBe("cto")
    expect(normHandle("@@Build-Lead")).toBe("build-lead")
    expect(normHandle("worker_1")).toBe("worker_1")
  })
  it("geçersiz girişler null", () => {
    expect(normHandle("")).toBeNull()
    expect(normHandle("  @  ")).toBeNull()
    expect(normHandle("has space")).toBeNull()
    expect(normHandle("-leading-dash")).toBeNull()
    expect(normHandle("ünïcode")).toBeNull()
  })
})

describe("resolveHandle", () => {
  const metas = [meta("s1", "Orchestrator", "builder"), meta("s2", "CTO Bot", "CTO"), meta("s3", "Notes")]

  it("case-insensitive eşleşme, doğru id döner", () => {
    expect(resolveHandle(metas, "cto")).toBe("s2")
    expect(resolveHandle(metas, "@CTO")).toBe("s2")
    expect(resolveHandle(metas, "builder")).toBe("s1")
  })
  it("handle'sız / bulunamayan → undefined", () => {
    expect(resolveHandle(metas, "ghost")).toBeUndefined()
    expect(resolveHandle(metas, "")).toBeUndefined()
  })
  it("excludeId atlanır (kendine gönderim elenir)", () => {
    expect(resolveHandle(metas, "cto", "s2")).toBeUndefined()
    expect(resolveHandle(metas, "cto", "s1")).toBe("s2")
  })
})

describe("handleTaken / listPeers", () => {
  const metas = [meta("s1", "Orchestrator", "builder"), meta("s2", "CTO Bot", "cto"), meta("s3", "Notes")]
  it("handleTaken kendini hariç tutar, case-insensitive", () => {
    expect(handleTaken(metas, "CTO", "s1")).toBe(true)
    expect(handleTaken(metas, "cto", "s2")).toBe(false)
    expect(handleTaken(metas, "fresh", "s1")).toBe(false)
  })
  it("listPeers yalnız handle'lı + self hariç", () => {
    expect(listPeers(metas, "s1")).toEqual([{ id: "s2", title: "CTO Bot", handle: "cto" }])
    expect(listPeers(metas).map((p) => p.handle).sort()).toEqual(["builder", "cto"])
  })
})

describe("framePeerMessage", () => {
  it("gönderen etiketiyle çerçeveler", () => {
    expect(framePeerMessage("@builder", "PR 234 hazır")).toBe("[from @builder] PR 234 hazır")
  })
})

describe("rateOk", () => {
  it("pencere içinde RATE_MAX'e kadar izin, sonra blok", () => {
    // RATE_MAX = 12
    for (let i = 0; i < 12; i++) {
      expect(rateOk("a", "b", 1000 + i)).toBe(true)
    }
    expect(rateOk("a", "b", 1020)).toBe(false)
  })
  it("from→to çiftleri bağımsız", () => {
    for (let i = 0; i < 12; i++) rateOk("a", "b", 1000)
    expect(rateOk("a", "b", 1000)).toBe(false)
    expect(rateOk("a", "c", 1000)).toBe(true)
    expect(rateOk("x", "b", 1000)).toBe(true)
  })
  it("pencere kayınca (60s+) tekrar izin verir", () => {
    for (let i = 0; i < 12; i++) rateOk("a", "b", 1000)
    expect(rateOk("a", "b", 1000)).toBe(false)
    expect(rateOk("a", "b", 1000 + 60_001)).toBe(true)
  })
})
