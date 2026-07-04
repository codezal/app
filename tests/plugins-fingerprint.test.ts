import { describe, it, expect, vi, beforeEach } from "vitest"

type Entry = { name: string; isDirectory: boolean; isFile: boolean; isSymlink: boolean }
let dirs: Record<string, Entry[]> = {}
let files: Record<string, Uint8Array> = {}

vi.mock("@tauri-apps/plugin-fs", () => ({
  exists: vi.fn(async (p: string) => p in dirs || p in files),
  readDir: vi.fn(async (p: string) => {
    if (!(p in dirs)) throw new Error(`ENOENT readDir ${p}`)
    return dirs[p]
  }),
  readFile: vi.fn(async (p: string) => {
    if (!(p in files)) throw new Error(`ENOENT readFile ${p}`)
    return files[p]
  }),
}))

import { computeDirFingerprint } from "@/lib/plugins/fingerprint"

const file = (name: string): Entry => ({ name, isDirectory: false, isFile: true, isSymlink: false })
const dir = (name: string): Entry => ({ name, isDirectory: true, isFile: false, isSymlink: false })
const link = (name: string): Entry => ({ name, isDirectory: false, isFile: false, isSymlink: true })
const bytes = (s: string) => new TextEncoder().encode(s)

function seed() {
  dirs = {
    "/p": [file("a.txt"), dir("sub")],
    "/p/sub": [file("b.txt")],
  }
  files = {
    "/p/a.txt": bytes("A"),
    "/p/sub/b.txt": bytes("B"),
  }
}

beforeEach(seed)

describe("computeDirFingerprint", () => {
  it("deterministik — aynı ağaç aynı fingerprint", async () => {
    const f1 = await computeDirFingerprint("/p")
    const f2 = await computeDirFingerprint("/p")
    expect(f1).toBe(f2)
    expect(f1).toMatch(/^[0-9a-f]{64}$/) // SHA-256 hex
  })

  it("readDir sırası önemsiz (sort) — aynı fingerprint", async () => {
    const f1 = await computeDirFingerprint("/p")
    dirs["/p"] = [dir("sub"), file("a.txt")]
    const f2 = await computeDirFingerprint("/p")
    expect(f2).toBe(f1)
  })

  it("içerik değişimi → farklı fingerprint", async () => {
    const f1 = await computeDirFingerprint("/p")
    files["/p/a.txt"] = bytes("A-tampered")
    const f2 = await computeDirFingerprint("/p")
    expect(f2).not.toBe(f1)
  })

  it("aynı boyutta içerik takası bile yakalanır (mtime değil içerik baz)", async () => {
    const f1 = await computeDirFingerprint("/p")
    files["/p/a.txt"] = bytes("X")
    const f2 = await computeDirFingerprint("/p")
    expect(f2).not.toBe(f1)
  })

  it("dosya eklenince → farklı", async () => {
    const f1 = await computeDirFingerprint("/p")
    dirs["/p"] = [...dirs["/p"], file("c.txt")]
    files["/p/c.txt"] = bytes("C")
    const f2 = await computeDirFingerprint("/p")
    expect(f2).not.toBe(f1)
  })

  it("dosya silinince → farklı", async () => {
    const f1 = await computeDirFingerprint("/p")
    dirs["/p/sub"] = []
    delete files["/p/sub/b.txt"]
    const f2 = await computeDirFingerprint("/p")
    expect(f2).not.toBe(f1)
  })

  it("dosya symlink'e çevrilince → farklı (symlink izlenmez)", async () => {
    const f1 = await computeDirFingerprint("/p")
    dirs["/p"] = [link("a.txt"), dir("sub")]
    const f2 = await computeDirFingerprint("/p")
    expect(f2).not.toBe(f1)
  })

  it("dizin yoksa → boş string", async () => {
    expect(await computeDirFingerprint("/yok")).toBe("")
  })

  it("trailing slash normalize edilir", async () => {
    const f1 = await computeDirFingerprint("/p")
    const f2 = await computeDirFingerprint("/p/")
    expect(f2).toBe(f1)
  })
})
