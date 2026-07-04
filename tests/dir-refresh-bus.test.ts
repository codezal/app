import { describe, it, expect, beforeEach, vi } from "vitest"
import {
  subscribeDirRefresh,
  dirHasSubscribers,
  emitDirRefresh,
  clearDirRefreshBus,
} from "@/lib/dir-refresh-bus"

beforeEach(() => clearDirRefreshBus())

describe("dir-refresh-bus", () => {
  it("abone yokken emit no-op + dirHasSubscribers false", () => {
    expect(dirHasSubscribers("/a")).toBe(false)
    expect(() => emitDirRefresh("/a")).not.toThrow()
  })

  it("subscribe → emit cb'yi tetikler", () => {
    const cb = vi.fn()
    subscribeDirRefresh("/a", cb)
    expect(dirHasSubscribers("/a")).toBe(true)
    emitDirRefresh("/a")
    expect(cb).toHaveBeenCalledTimes(1)
  })

  it("aynı dizine çoklu abone hepsi tetiklenir", () => {
    const a = vi.fn()
    const b = vi.fn()
    subscribeDirRefresh("/d", a)
    subscribeDirRefresh("/d", b)
    emitDirRefresh("/d")
    expect(a).toHaveBeenCalledTimes(1)
    expect(b).toHaveBeenCalledTimes(1)
  })

  it("unsubscribe sonrası tetiklenmez + dirHasSubscribers false", () => {
    const cb = vi.fn()
    const off = subscribeDirRefresh("/a", cb)
    off()
    expect(dirHasSubscribers("/a")).toBe(false)
    emitDirRefresh("/a")
    expect(cb).not.toHaveBeenCalled()
  })

  it("anahtar normalleştirilir — backslash subscribe, forward emit eşleşir", () => {
    const cb = vi.fn()
    subscribeDirRefresh("C:\\a\\b", cb)
    expect(dirHasSubscribers("C:/a/b")).toBe(true)
    emitDirRefresh("C:/a/b")
    expect(cb).toHaveBeenCalledTimes(1)
  })

  it("farklı dizin emit'i etkilemez", () => {
    const cb = vi.fn()
    subscribeDirRefresh("/a", cb)
    emitDirRefresh("/b")
    expect(cb).not.toHaveBeenCalled()
  })
})
