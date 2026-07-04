import { describe, it, expect, vi, beforeEach } from "vitest"

const h = vi.hoisted(() => ({ files: {} as Record<string, string> }))

vi.mock("@tauri-apps/plugin-fs", () => ({
  exists: vi.fn(async (p: string) => Object.prototype.hasOwnProperty.call(h.files, p)),
  readTextFile: vi.fn(async (p: string) => h.files[p] ?? ""),
  writeTextFile: vi.fn(async (p: string, c: string) => {
    h.files[p] = c
  }),
  mkdir: vi.fn(async () => {}),
}))
vi.mock("@tauri-apps/api/path", () => ({ homeDir: vi.fn(async () => "/home/u") }))
vi.mock("@/lib/memory", () => ({ invalidateMemoryCache: vi.fn() }))
vi.mock("@/lib/memory-store", () => ({
  captureMemory: vi.fn(async () => {}),
  forgetMemory: vi.fn(async () => {}),
}))

import { appendMemory, memoryTargetPath, removeMemoryNote } from "@/lib/memory-write"
import { captureMemory, forgetMemory } from "@/lib/memory-store"

beforeEach(() => {
  h.files = {}
  vi.clearAllMocks()
})

describe("memoryTargetPath", () => {
  it("project → <ws>/.codezal/memory.md", async () => {
    expect(await memoryTargetPath("project", "/ws")).toBe("/ws/.codezal/memory.md")
  })
  it("global → ~/.codezal/MEMORY.md", async () => {
    expect(await memoryTargetPath("global", "/ws")).toBe("/home/u/.codezal/MEMORY.md")
  })
  it("project workspace yoksa → null", async () => {
    expect(await memoryTargetPath("project")).toBeNull()
  })
})

describe("appendMemory", () => {
  it("project learned memory'i DB capture'a yazar", async () => {
    const p = await appendMemory("project", "tabları kullan", "/ws")
    expect(p).toBe("project memory database")
    expect(captureMemory).toHaveBeenCalledWith({
      scope: "project",
      text: "tabları kullan",
      workspace: "/ws",
      category: undefined,
      source: "manual",
    })
    expect(h.files["/ws/.codezal/memory.md"]).toBeUndefined()
  })

  it("category ve source'u sanitize ederek capture'a taşır", async () => {
    await appendMemory("project", "deploy GH Actions ile", "/ws", "# Deploy\nx", "auto_learn")
    expect(captureMemory).toHaveBeenCalledWith({
      scope: "project",
      text: "deploy GH Actions ile",
      workspace: "/ws",
      category: "Deploy x",
      source: "auto_learn",
    })
  })

  it("boş metin reddedilir", async () => {
    await expect(appendMemory("project", "   ", "/ws")).rejects.toThrow()
  })

  it("global learned memory'i DB capture'a yazar", async () => {
    const p = await appendMemory("global", "her yerde geçerli", "/ws")
    expect(p).toBe("global memory database")
    expect(captureMemory).toHaveBeenCalledWith({
      scope: "global",
      text: "her yerde geçerli",
      workspace: "/ws",
      category: undefined,
      source: "manual",
    })
  })
})

describe("removeMemoryNote", () => {
  it("DB entry'yi arşivler ve legacy markdown bullet'ı temizler", async () => {
    h.files["/ws/.codezal/memory.md"] = "## Notes\n\n- old note  <!-- 2026-01-01 -->\n- keep  <!-- 2026-01-01 -->\n"
    await removeMemoryNote("project", "old note", "/ws")
    expect(forgetMemory).toHaveBeenCalledWith({ scope: "project", text: "old note", workspace: "/ws" })
    expect(h.files["/ws/.codezal/memory.md"]).not.toContain("old note")
    expect(h.files["/ws/.codezal/memory.md"]).toContain("keep")
  })
})
