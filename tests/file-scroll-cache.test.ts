import { describe, it, expect, beforeEach } from "vitest"
import {
  getFileScroll,
  setFileScroll,
  clearFileScrollCache,
  fileScrollCacheSize,
} from "@/lib/file-scroll-cache"

beforeEach(() => clearFileScrollCache())

describe("file-scroll-cache", () => {
  it("miss → undefined", () => {
    expect(getFileScroll("/x.ts")).toBeUndefined()
  })

  it("set + get", () => {
    setFileScroll("/x.ts", { top: 120, left: 5 })
    expect(getFileScroll("/x.ts")).toEqual({ top: 120, left: 5 })
  })

  it("anahtar normalleştirilir (backslash)", () => {
    setFileScroll("C:\\a\\b.ts", { top: 10, left: 0 })
    expect(getFileScroll("C:/a/b.ts")).toEqual({ top: 10, left: 0 })
  })

  it("upsert son değeri tutar, entry sayısı artmaz", () => {
    setFileScroll("/x.ts", { top: 1, left: 0 })
    setFileScroll("/x.ts", { top: 99, left: 2 })
    expect(getFileScroll("/x.ts")).toEqual({ top: 99, left: 2 })
    expect(fileScrollCacheSize()).toBe(1)
  })

  it("500 cap: aşınca en eski atılır", () => {
    for (let i = 0; i < 505; i++) setFileScroll(`/f${i}.ts`, { top: i, left: 0 })
    expect(fileScrollCacheSize()).toBe(500)
    expect(getFileScroll("/f0.ts")).toBeUndefined()
    expect(getFileScroll("/f504.ts")).toEqual({ top: 504, left: 0 })
  })
})
