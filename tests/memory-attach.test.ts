import { describe, it, expect, vi, beforeEach } from "vitest"

const h = vi.hoisted(() => ({ files: {} as Record<string, string> }))

vi.mock("@tauri-apps/plugin-fs", () => ({
  exists: vi.fn(async (p: string) => Object.prototype.hasOwnProperty.call(h.files, p)),
  readTextFile: vi.fn(async (p: string) => {
    if (Object.prototype.hasOwnProperty.call(h.files, p)) return h.files[p]
    throw new Error("not found")
  }),
}))

import { attachNestedMemory, resetAttach } from "@/lib/memory-attach"

beforeEach(() => {
  h.files = {}
  resetAttach("s1")
})

describe("attachNestedMemory", () => {
  it("alt-dizin AGENTS.md'yi ekler, ROOT'u eklemez", async () => {
    h.files["/ws/AGENTS.md"] = "ROOT RULES"
    h.files["/ws/packages/foo/AGENTS.md"] = "FOO RULES"
    const r = await attachNestedMemory("/ws", "/ws/packages/foo/deep/x.ts", "s1")
    expect(r).toContain("FOO RULES")
    expect(r).toContain("packages/foo/AGENTS.md")
    expect(r).not.toContain("ROOT RULES") // root system prompt'ta zaten var
    expect(r).toContain("<system-reminder>")
  })

  it("aynı session'da ikinci okuma tekrar enjekte etmez (dedup)", async () => {
    h.files["/ws/packages/foo/AGENTS.md"] = "FOO RULES"
    const first = await attachNestedMemory("/ws", "/ws/packages/foo/x.ts", "s1")
    expect(first).toContain("FOO RULES")
    const second = await attachNestedMemory("/ws", "/ws/packages/foo/y.ts", "s1")
    expect(second).toBe("")
    resetAttach("s1")
    const third = await attachNestedMemory("/ws", "/ws/packages/foo/z.ts", "s1")
    expect(third).toContain("FOO RULES")
  })

  it("root'un doğrudan altındaki dosya (start === root) → boş", async () => {
    h.files["/ws/AGENTS.md"] = "ROOT RULES"
    const r = await attachNestedMemory("/ws", "/ws/x.ts", "s1")
    expect(r).toBe("")
  })

  it("workspace yoksa → boş", async () => {
    const r = await attachNestedMemory(undefined, "/ws/a/x.ts", "s1")
    expect(r).toBe("")
  })

  it("birden çok seviye — yol üstündeki tüm alt-dizin dosyaları eklenir", async () => {
    h.files["/ws/a/AGENTS.md"] = "A RULES"
    h.files["/ws/a/b/CODEZAL.md"] = "B RULES"
    const r = await attachNestedMemory("/ws", "/ws/a/b/x.ts", "s1")
    expect(r).toContain("A RULES")
    expect(r).toContain("B RULES")
  })
})
