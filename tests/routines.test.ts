import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@tauri-apps/plugin-fs", () => ({
  exists: vi.fn(),
  readDir: vi.fn(),
  readTextFile: vi.fn(),
}))
vi.mock("@tauri-apps/api/path", () => ({
  homeDir: vi.fn().mockResolvedValue("/home/user"),
}))

import { exists, readDir, readTextFile } from "@tauri-apps/plugin-fs"
import { homeDir } from "@tauri-apps/api/path"
import { readWorkspaceRoutines, readUserRoutines } from "@/lib/routines"

const mockExists = vi.mocked(exists)
const mockReadDir = vi.mocked(readDir)
const mockRead = vi.mocked(readTextFile)
const mockHomeDir = vi.mocked(homeDir)

beforeEach(() => {
  vi.resetAllMocks()
  mockHomeDir.mockResolvedValue("/home/user")
  mockExists.mockResolvedValue(true)
  mockReadDir.mockResolvedValue([])
})

// ─── readWorkspaceRoutines ────────────────────────────────────────────────────

describe("readWorkspaceRoutines", () => {
  it("workspace undefined → boş dizi", async () => {
    expect(await readWorkspaceRoutines(undefined)).toEqual([])
  })

  it("routines klasörü yoksa → boş dizi", async () => {
    mockExists.mockResolvedValue(false)
    expect(await readWorkspaceRoutines("/ws")).toEqual([])
  })

  it(".md olmayan dosyalar atlanır", async () => {
    mockReadDir.mockResolvedValue([
      { name: "notes.txt", isFile: true, isDirectory: false, isSymlink: false },
    ] as Awaited<ReturnType<typeof readDir>>)
    expect(await readWorkspaceRoutines("/ws")).toEqual([])
  })

  it("geçerli .md dosyası parse edilir", async () => {
    mockReadDir.mockResolvedValue([
      { name: "daily.md", isFile: true, isDirectory: false, isSymlink: false },
    ] as Awaited<ReturnType<typeof readDir>>)
    mockRead.mockResolvedValue("---\nname: daily\ndescription: Daily standup\n---\nRun standup.")

    const r = await readWorkspaceRoutines("/ws")
    expect(r).toHaveLength(1)
    expect(r[0].name).toBe("daily")
    expect(r[0].description).toBe("Daily standup")
    expect(r[0].prompt).toBe("Run standup.")
    expect(r[0].scope).toBe("project")
  })

  it("frontmatter yoksa fallbackName = dosya adı (uzantısız)", async () => {
    mockReadDir.mockResolvedValue([
      { name: "my-task.md", isFile: true, isDirectory: false, isSymlink: false },
    ] as Awaited<ReturnType<typeof readDir>>)
    mockRead.mockResolvedValue("Just do the task.")

    const r = await readWorkspaceRoutines("/ws")
    expect(r[0].name).toBe("my-task")
    expect(r[0].prompt).toBe("Just do the task.")
  })

  it("schedule alanı parse edilir", async () => {
    mockReadDir.mockResolvedValue([
      { name: "cron.md", isFile: true, isDirectory: false, isSymlink: false },
    ] as Awaited<ReturnType<typeof readDir>>)
    mockRead.mockResolvedValue("---\nname: cron\nschedule: 0 9 * * 1-5\n---\nMorning task.")

    const r = await readWorkspaceRoutines("/ws")
    expect(r[0].schedule).toBe("0 9 * * 1-5")
  })

  it("provider + model alanları parse edilir", async () => {
    mockReadDir.mockResolvedValue([
      { name: "r.md", isFile: true, isDirectory: false, isSymlink: false },
    ] as Awaited<ReturnType<typeof readDir>>)
    mockRead.mockResolvedValue("---\nname: r\nprovider: anthropic\nmodel: claude-haiku-4-5\n---\nBody.")

    const r = await readWorkspaceRoutines("/ws")
    expect(r[0].provider).toBe("anthropic")
    expect(r[0].model).toBe("claude-haiku-4-5")
  })

  it("okuma hatası olan dosya atlanır", async () => {
    mockReadDir.mockResolvedValue([
      { name: "a.md", isFile: true, isDirectory: false, isSymlink: false },
      { name: "b.md", isFile: true, isDirectory: false, isSymlink: false },
    ] as Awaited<ReturnType<typeof readDir>>)
    mockRead
      .mockRejectedValueOnce(new Error("permission denied"))
      .mockResolvedValueOnce("---\nname: b\n---\nBody.")

    const r = await readWorkspaceRoutines("/ws")
    expect(r).toHaveLength(1)
    expect(r[0].name).toBe("b")
  })
})

// ─── readUserRoutines ─────────────────────────────────────────────────────────

describe("readUserRoutines", () => {
  it("homeDir başarısızsa → boş dizi", async () => {
    mockHomeDir.mockRejectedValue(new Error("no home"))
    expect(await readUserRoutines()).toEqual([])
  })

  it("routines dizini yoksa → boş dizi", async () => {
    mockExists.mockResolvedValue(false)
    expect(await readUserRoutines()).toEqual([])
  })

  it("scope global olarak atanır", async () => {
    mockReadDir.mockResolvedValue([
      { name: "weekly.md", isFile: true, isDirectory: false, isSymlink: false },
    ] as Awaited<ReturnType<typeof readDir>>)
    mockRead.mockResolvedValue("---\nname: weekly\n---\nWeekly review.")

    const r = await readUserRoutines()
    expect(r[0].scope).toBe("global")
  })
})
