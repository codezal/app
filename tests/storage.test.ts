import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@tauri-apps/plugin-fs", () => ({
  BaseDirectory: { AppData: 0 },
  exists: vi.fn(),
  readTextFile: vi.fn(),
  rename: vi.fn(),
  writeTextFile: vi.fn(),
}))

import { exists, readTextFile, rename, writeTextFile } from "@tauri-apps/plugin-fs"
import { readJson, writeJson, loadSession } from "@/lib/storage"

const mockExists = vi.mocked(exists)
const mockRead = vi.mocked(readTextFile)
const mockRename = vi.mocked(rename)
const mockWrite = vi.mocked(writeTextFile)

beforeEach(() => {
  vi.resetAllMocks()
  mockExists.mockResolvedValue(true)
  mockWrite.mockResolvedValue(undefined)
  mockRename.mockResolvedValue(undefined)
})

// ─── readJson ─────────────────────────────────────────────────────────────────

describe("readJson", () => {
  it("dosya yoksa fallback döner", async () => {
    mockExists.mockResolvedValue(false)
    const r = await readJson("x.json", { default: true })
    expect(r).toEqual({ default: true })
  })

  it("geçerli JSON parse edilir", async () => {
    mockRead.mockResolvedValue('{"key":"val"}')
    const r = await readJson("x.json", {})
    expect(r).toEqual({ key: "val" })
  })

  it("bozuk JSON → fallback", async () => {
    mockRead.mockResolvedValue("{bad json")
    const r = await readJson("x.json", "fallback")
    expect(r).toBe("fallback")
  })

  it("okuma hatası → fallback", async () => {
    mockRead.mockRejectedValue(new Error("IO error"))
    const r = await readJson("x.json", 42)
    expect(r).toBe(42)
  })
})

// ─── writeJson (atomik tmp+rename) ─────────────────────────────────────────────

describe("writeJson", () => {
  it("data JSON.stringify ile geçici dosyaya yazılır, sonra rename", async () => {
    await writeJson("settings.json", { theme: "dark" })
    const written = mockWrite.mock.calls[0]?.[1] as string
    expect(JSON.parse(written)).toEqual({ theme: "dark" })
    expect(mockRename).toHaveBeenCalledTimes(1)
  })

  it("pretty-print: indent 2", async () => {
    await writeJson("x.json", { a: 1 })
    const written = mockWrite.mock.calls[0]?.[1] as string
    expect(written).toContain("\n")
  })
})


describe("loadSession", () => {
  it("mevcut oturum yüklenir", async () => {
    mockRead.mockResolvedValue('{"title":"loaded"}')
    const r = await loadSession("sess-1", { title: "default" })
    expect(r).toEqual({ title: "loaded" })
  })

  it("yoksa fallback döner", async () => {
    mockExists.mockResolvedValue(false)
    const r = await loadSession("missing", { title: "fb" })
    expect(r).toEqual({ title: "fb" })
  })

  it("sessions/<id>.json path'inden okur", async () => {
    mockRead.mockResolvedValue("{}")
    await loadSession("abc", {})
    const path = mockExists.mock.calls[0]?.[0] as string
    expect(path).toContain("sessions/abc.json")
  })
})
