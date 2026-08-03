import { describe, it, expect, vi } from "vitest"

vi.mock("@tauri-apps/plugin-fs", () => ({
  copyFile: vi.fn(),
  mkdir: vi.fn(),
  readDir: vi.fn(),
  remove: vi.fn(),
  lstat: vi.fn(),
  exists: vi.fn(),
}))

import { isSelfPaste } from "@/lib/file-clipboard"

describe("isSelfPaste (M73)", () => {
  it("aynı path → self-paste", () => {
    expect(isSelfPaste("/a/b", "/a/b")).toBe(true)
  })

  it("dst src'nin altında → self-paste", () => {
    expect(isSelfPaste("/a/b/sub", "/a/b")).toBe(true)
  })

  it("farklı path → self-paste değil", () => {
    expect(isSelfPaste("/a/c", "/a/b")).toBe(false)
  })

  it("src prefix gibi görünen ama farklı kardeş → self-paste değil", () => {
    // /a/b2, /a/b'nin altında DEĞİL — sadece isim prefix'i.
    expect(isSelfPaste("/a/b2", "/a/b")).toBe(false)
    expect(isSelfPaste("/a/beta", "/a/b")).toBe(false)
  })

  it("Windows case-insensitive: farklı case'li aynı path yakalanır", () => {
    // C:\Foo → c:\foo\sub gerçek bir self-paste (FS case-insensitive).
    expect(isSelfPaste("c:/foo/sub", "C:\\Foo", true)).toBe(true)
    expect(isSelfPaste("C:\\FOO", "c:/foo", true)).toBe(true)
  })

  it("Windows case-insensitive: kardeş yine ayırt edilir", () => {
    expect(isSelfPaste("c:/foo2", "C:\\Foo", true)).toBe(false)
  })

  it("case-sensitive modda (POSIX) farklı case self-paste sayılmaz", () => {
    expect(isSelfPaste("/a/B/sub", "/a/b", false)).toBe(false)
  })

  it("boş src → asla self-paste değil", () => {
    expect(isSelfPaste("/a", "", true)).toBe(false)
  })

  it("backslash'lar normalize edilir", () => {
    expect(isSelfPaste("C:\\a\\b\\c", "C:\\a\\b")).toBe(true)
  })
})
