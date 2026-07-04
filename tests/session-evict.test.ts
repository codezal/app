import { describe, it, expect } from "vitest"
import {
  pickIdleSessionEvictions,
  reconcileSeen,
  planSessionEviction,
  MAX_HYDRATED_SESSIONS,
} from "@/lib/session-evict"

describe("pickIdleSessionEvictions", () => {
  it("limit altında → hiç evict yok", () => {
    const order = ["a", "b", "c"]
    expect(pickIdleSessionEvictions({ order, keep: "c", preserve: [], limit: 12 })).toEqual([])
  })

  it("limit aşımı → en eskiler (LRU başı) düşer", () => {
    const order = ["a", "b", "c", "d", "e"] // a en eski
    const stale = pickIdleSessionEvictions({ order, keep: "e", preserve: [], limit: 3 })
    expect(stale).toEqual(["a", "b"])
  })

  it("active (keep) asla düşmez — eski olsa bile atlanır", () => {
    const order = ["a", "b", "c", "d"] // a en eski ama active
    const stale = pickIdleSessionEvictions({ order, keep: "a", preserve: [], limit: 2 })
    expect(stale).toEqual(["b", "c"])
    expect(stale).not.toContain("a")
  })

  it("preserve (streaming/pinned) korunur", () => {
    const order = ["a", "b", "c", "d", "e"]
    const stale = pickIdleSessionEvictions({
      order,
      keep: "e",
      preserve: ["a", "b"], // stream/pinned
      limit: 2,
    })
    expect(stale).toEqual(["c", "d"])
  })

  it("hepsi korunuyorsa → boş (havuz limit'in üstünde kalır)", () => {
    const order = ["a", "b", "c"]
    const stale = pickIdleSessionEvictions({
      order,
      keep: "a",
      preserve: ["b", "c"],
      limit: 1,
    })
    expect(stale).toEqual([])
  })

  it("keep null + preserve boş → saf LRU", () => {
    const order = ["a", "b", "c", "d"]
    const stale = pickIdleSessionEvictions({ order, keep: null, preserve: [], limit: 2 })
    expect(stale).toEqual(["a", "b"])
  })

  it("default limit makul (>0)", () => {
    expect(MAX_HYDRATED_SESSIONS).toBeGreaterThan(0)
  })
})

describe("reconcileSeen", () => {
  it("havuzda olmayan id'leri atar (sıra korunur)", () => {
    expect(reconcileSeen(["a", "b", "c"], ["a", "c"])).toEqual(["a", "c"])
  })

  it("havuzdaki yeni id'leri sona ekler", () => {
    expect(reconcileSeen(["a", "b"], ["a", "b", "c"])).toEqual(["a", "b", "c"])
  })

  it("boş seen → havuz sırası", () => {
    expect(reconcileSeen([], ["x", "y"])).toEqual(["x", "y"])
  })
})

describe("planSessionEviction", () => {
  it("reconcile + saf LRU evict", () => {
    const plan = planSessionEviction({
      poolKeys: ["a", "b", "c", "d"],
      seenOrder: ["a", "b", "c", "d"],
      activeId: "d",
      streamingIds: [],
      pinnedIds: [],
      isDraft: false,
      limit: 2,
    })
    expect(plan.order).toEqual(["a", "b", "c", "d"])
    expect(plan.stale).toEqual(["a", "b"])
  })

  it("streaming + pinned + active korunur", () => {
    const plan = planSessionEviction({
      poolKeys: ["a", "b", "c", "d", "e"],
      seenOrder: ["a", "b", "c", "d", "e"],
      activeId: "e",
      streamingIds: ["a"],
      pinnedIds: ["b"],
      isDraft: false,
      limit: 2,
    })
    expect(plan.stale).toEqual(["c", "d"])
  })

  it("draft aktif → active da korunur", () => {
    const plan = planSessionEviction({
      poolKeys: ["a", "b", "c"],
      seenOrder: ["a", "b", "c"],
      activeId: "c",
      streamingIds: [],
      pinnedIds: [],
      isDraft: true,
      limit: 1,
    })
    expect(plan.stale).toEqual(["a", "b"])
    expect(plan.stale).not.toContain("c")
  })

  it("commit edilmemiş (index'te yok) session korunur — split detached", () => {
    const plan = planSessionEviction({
      poolKeys: ["a", "b", "c", "d"],
      seenOrder: ["a", "b", "c", "d"],
      activeId: "d",
      streamingIds: [],
      pinnedIds: [],
      isDraft: false,
      limit: 2,
      indexIds: ["b", "c", "d"],
    })
    expect(plan.stale).not.toContain("a")
    expect(plan.stale).toEqual(["b", "c"])
  })

  it("silinmiş seen id'si stale'e girmez (reconcile temizler)", () => {
    const plan = planSessionEviction({
      poolKeys: ["b", "c", "d"],
      seenOrder: ["a", "b", "c", "d"],
      activeId: "d",
      streamingIds: [],
      pinnedIds: [],
      isDraft: false,
      limit: 2,
    })
    expect(plan.order).toEqual(["b", "c", "d"])
    expect(plan.stale).toEqual(["b"]) // 3→2, en eski b
    expect(plan.stale).not.toContain("a")
  })
})
