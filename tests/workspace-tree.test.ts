import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@tauri-apps/plugin-fs", () => ({
  readDir: vi.fn(),
}))

import { readDir } from "@tauri-apps/plugin-fs"
import { readWorkspaceDir } from "@/lib/workspace-tree"

const mockReadDir = vi.mocked(readDir)

function entry(name: string, isDirectory: boolean) {
  return { name, isDirectory, isFile: !isDirectory, isSymlink: false }
}

beforeEach(() => vi.resetAllMocks())

describe("readWorkspaceDir", () => {
  it("dizinler dosyalardan önce gelir", async () => {
    mockReadDir.mockResolvedValue([
      entry("file.ts", false),
      entry("subdir", true),
    ] as Awaited<ReturnType<typeof readDir>>)
    const r = await readWorkspaceDir("/ws")
    expect(r[0].isDir).toBe(true)
    expect(r[0].name).toBe("subdir")
    expect(r[1].isDir).toBe(false)
  })

  it("alfabetik sıralama (ayrı ayrı dizin ve dosya)", async () => {
    mockReadDir.mockResolvedValue([
      entry("z.ts", false),
      entry("a.ts", false),
      entry("m.ts", false),
    ] as Awaited<ReturnType<typeof readDir>>)
    const r = await readWorkspaceDir("/ws")
    expect(r.map((e) => e.name)).toEqual(["a.ts", "m.ts", "z.ts"])
  })

  it("node_modules gizlenir", async () => {
    mockReadDir.mockResolvedValue([
      entry("node_modules", true),
      entry("src", true),
    ] as Awaited<ReturnType<typeof readDir>>)
    const r = await readWorkspaceDir("/ws")
    expect(r.map((e) => e.name)).not.toContain("node_modules")
    expect(r.map((e) => e.name)).toContain("src")
  })

  it(".git gizlenir", async () => {
    mockReadDir.mockResolvedValue([
      entry(".git", true),
      entry("src", true),
    ] as Awaited<ReturnType<typeof readDir>>)
    const r = await readWorkspaceDir("/ws")
    expect(r.map((e) => e.name)).not.toContain(".git")
  })

  it("config dot-file'ları görünür (VS Code gibi: .env/.gitignore/.env.example)", async () => {
    mockReadDir.mockResolvedValue([
      entry(".env", false),
      entry(".env.example", false),
      entry(".gitignore", false),
    ] as Awaited<ReturnType<typeof readDir>>)
    const r = await readWorkspaceDir("/ws")
    const names = r.map((e) => e.name)
    expect(names).toContain(".env")
    expect(names).toContain(".gitignore")
    expect(names).toContain(".env.example")
  })

  it("absolute path doğru oluşturulur", async () => {
    mockReadDir.mockResolvedValue([
      entry("foo.ts", false),
    ] as Awaited<ReturnType<typeof readDir>>)
    const r = await readWorkspaceDir("/workspace/src")
    expect(r[0].path).toBe("/workspace/src/foo.ts")
  })

  it("dist, build, target, .next gizlenir", async () => {
    mockReadDir.mockResolvedValue([
      entry("dist", true),
      entry("build", true),
      entry("target", true),
      entry(".next", true),
      entry("src", true),
    ] as Awaited<ReturnType<typeof readDir>>)
    const r = await readWorkspaceDir("/ws")
    const names = r.map((e) => e.name)
    expect(names).not.toContain("dist")
    expect(names).not.toContain("build")
    expect(names).not.toContain("target")
    expect(names).not.toContain(".next")
    expect(names).toContain("src")
  })

  it("boş dizin → boş dizi", async () => {
    mockReadDir.mockResolvedValue([])
    expect(await readWorkspaceDir("/ws")).toEqual([])
  })
})
