import { describe, it, expect, vi } from "vitest"

vi.mock("@tauri-apps/api/core", () => ({ convertFileSrc: vi.fn() }))
vi.mock("@/lib/providers", () => ({ _registerPluginProvider: vi.fn() }))
vi.mock("@/lib/agents/plugin", () => ({ _registerPluginAgent: vi.fn() }))
vi.mock("@/lib/skills/plugin", () => ({ _registerPluginSkill: vi.fn() }))
vi.mock("@/lib/commands/plugin", () => ({ _registerPluginCommand: vi.fn() }))
vi.mock("@/lib/mcp", () => ({ _registerPluginMcp: vi.fn() }))
vi.mock("@/lib/hooks", () => ({ _registerPluginHook: vi.fn() }))
vi.mock("@/lib/plugins/audit", () => ({ appendAudit: vi.fn() }))

import { validateEntryPath } from "@/lib/plugins/sandbox"

describe("validateEntryPath", () => {
  it("dizin-içi relative path kabul edilir", () => {
    expect(validateEntryPath("entry.js")).toBeNull()
    expect(validateEntryPath("dist/index.js")).toBeNull()
    expect(validateEntryPath("src/providers/openai.mjs")).toBeNull()
    expect(validateEntryPath("a.b/c.js")).toBeNull()
  })

  it("boş entry reddedilir", () => {
    expect(validateEntryPath("")).toMatch(/boş/)
    // @ts-expect-error -- exercise the runtime guard.
    expect(validateEntryPath(undefined)).toMatch(/boş/)
  })

  it("`..` traversal reddedilir", () => {
    expect(validateEntryPath("../evil.js")).toMatch(/traversal/)
    expect(validateEntryPath("../../../../home/user/.ssh/payload.js")).toMatch(/traversal/)
    expect(validateEntryPath("dist/../../escape.js")).toMatch(/traversal/)
    expect(validateEntryPath("..\\..\\escape.js")).toMatch(/traversal/)
  })

  it("absolute path reddedilir", () => {
    expect(validateEntryPath("/etc/passwd.js")).toMatch(/absolute/)
    expect(validateEntryPath("\\windows\\system32\\x.js")).toMatch(/absolute/)
    expect(validateEntryPath("C:\\Users\\x\\evil.js")).toMatch(/absolute/)
  })

  it("url scheme reddedilir", () => {
    expect(validateEntryPath("file:///etc/evil.js")).toMatch(/url scheme/)
    expect(validateEntryPath("http://evil.com/x.js")).toMatch(/url scheme/)
    expect(validateEntryPath("https://evil.com/x.js")).toMatch(/url scheme/)
  })

  it("içinde `..` substring olan ama segment olmayan isim geçerli", () => {
    expect(validateEntryPath("foo..bar.js")).toBeNull()
    expect(validateEntryPath("dist/..hidden.js")).toBeNull()
  })
})
