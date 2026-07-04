import { describe, it, expect, vi, beforeEach } from "vitest"

const h = vi.hoisted(() => ({ files: {} as Record<string, string> }))

vi.mock("@tauri-apps/plugin-fs", () => ({
  exists: vi.fn(async (p: string) => Object.prototype.hasOwnProperty.call(h.files, p)),
  readTextFile: vi.fn(async (p: string) => {
    if (Object.prototype.hasOwnProperty.call(h.files, p)) return h.files[p]
    throw new Error("not found")
  }),
  readDir: vi.fn(async () => []),
  stat: vi.fn(async () => ({})),
}))
vi.mock("@tauri-apps/api/path", () => ({
  homeDir: vi.fn(async () => "/home/user"),
}))

import { readProjectMemory } from "@/lib/memory"

beforeEach(() => {
  h.files = {}
})

// User-authored project memory can live in .codezal/memory.md and must be read
// as a prompt instruction source. Learned memory itself is stored in SQLite.
describe("readProjectMemory — .codezal/memory.md", () => {
  it("yazılan proje notu (.codezal/memory.md) geri okunur", async () => {
    h.files["/ws/.codezal/memory.md"] = "- Deploy via GitHub Actions"
    const files = await readProjectMemory("/ws")
    const mem = files.find((f) => f.name === ".codezal/memory.md")
    expect(mem).toBeDefined()
    expect(mem?.scope).toBe("project")
    expect(mem?.content).toContain("Deploy via GitHub Actions")
  })

  it("memory.md yoksa candidate listede yer almaz (kök CLAUDE.md okunur)", async () => {
    h.files["/ws/CLAUDE.md"] = "Follow TDD."
    const names = (await readProjectMemory("/ws")).map((f) => f.name)
    expect(names).not.toContain(".codezal/memory.md")
    expect(names).toContain("CLAUDE.md")
  })
})
