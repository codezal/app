import { describe, it, expect, vi } from "vitest"
import { invalidateFromFileEvent, type InvalidateOps } from "@/lib/file-invalidate"
import { normalizeFsPath } from "@/lib/file-content-cache"
import type { FileEvent } from "@/lib/file-watcher"

function makeOps(over: Partial<InvalidateOps> = {}): InvalidateOps {
  return {
    normalize: normalizeFsPath,
    invalidate: vi.fn(),
    isOpen: () => false,
    reload: vi.fn(),
    ...over,
  }
}

const ev = (kind: FileEvent["kind"], path: string): FileEvent => ({ kind, path })

describe("invalidateFromFileEvent — içerik", () => {
  it("modify + açık dosya → invalidate + reload", () => {
    const reload = vi.fn()
    const invalidate = vi.fn()
    const ops = makeOps({ invalidate, reload, isOpen: (p) => p === "/a/b.ts" })
    invalidateFromFileEvent(ev("modify", "/a/b.ts"), ops)
    expect(invalidate).toHaveBeenCalledWith("/a/b.ts")
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it("modify + açık değil → invalidate ama reload yok", () => {
    const reload = vi.fn()
    const invalidate = vi.fn()
    const ops = makeOps({ invalidate, reload, isOpen: () => false })
    invalidateFromFileEvent(ev("modify", "/a/b.ts"), ops)
    expect(invalidate).toHaveBeenCalledWith("/a/b.ts")
    expect(reload).not.toHaveBeenCalled()
  })

  it("remove + açık → invalidate + reload", () => {
    const reload = vi.fn()
    const invalidate = vi.fn()
    const ops = makeOps({ invalidate, reload, isOpen: (p) => p === "/a/b.ts" })
    invalidateFromFileEvent(ev("remove", "/a/b.ts"), ops)
    expect(invalidate).toHaveBeenCalledWith("/a/b.ts")
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it("create → invalidate ÇAĞRILMAZ (içerik değişimi değil)", () => {
    const invalidate = vi.fn()
    const ops = makeOps({ invalidate })
    invalidateFromFileEvent(ev("create", "/a/b.ts"), ops)
    expect(invalidate).not.toHaveBeenCalled()
  })

  it(".git içi event → hiçbir şey çağrılmaz", () => {
    const reload = vi.fn()
    const invalidate = vi.fn()
    const ops = makeOps({ invalidate, reload, isOpen: () => true })
    invalidateFromFileEvent(ev("modify", "/repo/.git/index"), ops)
    expect(invalidate).not.toHaveBeenCalled()
    expect(reload).not.toHaveBeenCalled()
  })

  it("normalize uygulanır — backslash path açık dosyayla eşleşir", () => {
    const reload = vi.fn()
    const ops = makeOps({ reload, isOpen: (p) => p === "C:/a/b.ts" })
    invalidateFromFileEvent(ev("modify", "C:\\a\\b.ts"), ops)
    expect(reload).toHaveBeenCalledTimes(1)
  })
})

describe("invalidateFromFileEvent — dizin kancaları", () => {
  it("create + parent yüklü → refreshDir(parent)", () => {
    const refreshDir = vi.fn()
    const ops = makeOps({ isDirLoaded: (p) => p === "/a", refreshDir })
    invalidateFromFileEvent(ev("create", "/a/new.ts"), ops)
    expect(refreshDir).toHaveBeenCalledWith("/a")
  })

  it("create + parent yüklü değil → refreshDir yok", () => {
    const refreshDir = vi.fn()
    const ops = makeOps({ isDirLoaded: () => false, refreshDir })
    invalidateFromFileEvent(ev("create", "/a/new.ts"), ops)
    expect(refreshDir).not.toHaveBeenCalled()
  })

  it("dizin kancaları verilmezse create throw etmez", () => {
    const ops = makeOps() // isDirLoaded/refreshDir undefined
    expect(() => invalidateFromFileEvent(ev("create", "/a/new.ts"), ops)).not.toThrow()
  })
})
