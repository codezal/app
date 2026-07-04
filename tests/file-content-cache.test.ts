import { describe, it, expect, beforeEach } from "vitest"
import {
  getFileContent,
  setFileContent,
  invalidateFileContent,
  clearFileContentCache,
  fileContentCacheStats,
  normalizeFsPath,
} from "@/lib/file-content-cache"

beforeEach(() => clearFileContentCache())

describe("normalizeFsPath", () => {
  it("ters slash → düz slash", () => {
    expect(normalizeFsPath("C:\\a\\b.ts")).toBe("C:/a/b.ts")
  })
  it("sondaki slash atılır", () => {
    expect(normalizeFsPath("/a/b/")).toBe("/a/b")
  })
})

describe("file-content-cache temel", () => {
  it("miss → undefined", () => {
    expect(getFileContent("/x.ts")).toBeUndefined()
  })

  it("set + get", () => {
    setFileContent("/x.ts", "hello")
    expect(getFileContent("/x.ts")).toBe("hello")
    expect(fileContentCacheStats().entries).toBe(1)
  })

  it("anahtar normalleştirilir — backslash set, forward get aynı entry", () => {
    setFileContent("C:\\a\\b.ts", "data")
    expect(getFileContent("C:/a/b.ts")).toBe("data")
    expect(fileContentCacheStats().entries).toBe(1)
  })

  it("upsert byte hesabını günceller", () => {
    setFileContent("/x.ts", "ab") // 2*2 = 4 byte
    expect(fileContentCacheStats().bytes).toBe(4)
    setFileContent("/x.ts", "abcd") // 4*2 = 8 byte
    expect(fileContentCacheStats().bytes).toBe(8)
    expect(fileContentCacheStats().entries).toBe(1)
  })

  it("invalidate entry'yi düşer + byte azaltır", () => {
    setFileContent("/x.ts", "abc")
    invalidateFileContent("/x.ts")
    expect(getFileContent("/x.ts")).toBeUndefined()
    expect(fileContentCacheStats()).toEqual({ entries: 0, bytes: 0 })
  })

  it("clear hepsini sıfırlar", () => {
    setFileContent("/a", "1")
    setFileContent("/b", "2")
    clearFileContentCache()
    expect(fileContentCacheStats()).toEqual({ entries: 0, bytes: 0 })
  })
})

describe("file-content-cache eviction", () => {
  it("entry cap: 45 yazınca size 40'ta kalır", () => {
    for (let i = 0; i < 45; i++) setFileContent(`/f${i}.ts`, "x")
    expect(fileContentCacheStats().entries).toBe(40)
  })

  it("LRU: get ile dokunulan entry korunur, dokunulmayan en eski atılır", () => {
    for (let i = 0; i < 40; i++) setFileContent(`/k${i}.ts`, "x")
    getFileContent("/k0.ts") // k0 → en yeni
    setFileContent("/k40.ts", "x")
    expect(getFileContent("/k0.ts")).toBe("x")
    expect(getFileContent("/k1.ts")).toBeUndefined()
    expect(fileContentCacheStats().entries).toBe(40)
  })

  it("byte cap: toplam 20MB aşınca en eskiler atılır", () => {
    const chunk = "x".repeat(4_000_000) // 8MB/entry
    setFileContent("/a", chunk)
    setFileContent("/b", chunk)
    setFileContent("/c", chunk)
    expect(getFileContent("/a")).toBeUndefined()
    expect(getFileContent("/b")).toBe(chunk)
    expect(getFileContent("/c")).toBe(chunk)
    expect(fileContentCacheStats().entries).toBe(2)
  })

  it("size>1 guard: cap'ten büyük tek entry yine de tutulur", () => {
    const huge = "x".repeat(11_000_000) // 22MB > cap
    setFileContent("/huge", huge)
    expect(getFileContent("/huge")).toBe(huge)
    expect(fileContentCacheStats().entries).toBe(1)
  })
})
