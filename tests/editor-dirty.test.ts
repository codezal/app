// editor-dirty store — imperatif API (set/clear/isDirty) + referans stabilitesi.
import { describe, it, expect, beforeEach } from "vitest"
import { useDirtyFiles, isDirty, setDirty, clearDirty } from "@/lib/editor-dirty"

beforeEach(() => {
  useDirtyFiles.setState({ dirty: {} })
})

describe("editor-dirty", () => {
  it("setDirty(true) işaretler, isDirty true döner", () => {
    setDirty("/a/b.ts", true)
    expect(isDirty("/a/b.ts")).toBe(true)
    expect(isDirty("/a/other.ts")).toBe(false)
  })

  it("setDirty(false) işareti kaldırır", () => {
    setDirty("/a/b.ts", true)
    setDirty("/a/b.ts", false)
    expect(isDirty("/a/b.ts")).toBe(false)
  })

  it("clearDirty işareti kaldırır", () => {
    setDirty("/a/b.ts", true)
    clearDirty("/a/b.ts")
    expect(isDirty("/a/b.ts")).toBe(false)
  })

  it("aynı değeri set etmek state referansını korur (gereksiz render yok)", () => {
    setDirty("/a/b.ts", true)
    const ref1 = useDirtyFiles.getState().dirty
    setDirty("/a/b.ts", true)
    expect(useDirtyFiles.getState().dirty).toBe(ref1)
  })

  it("farklı dosyalar bağımsız izlenir", () => {
    setDirty("/a.ts", true)
    setDirty("/b.ts", true)
    clearDirty("/a.ts")
    expect(isDirty("/a.ts")).toBe(false)
    expect(isDirty("/b.ts")).toBe(true)
  })
})
