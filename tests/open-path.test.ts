import { describe, expect, it } from "vitest"
import { humanSize, isBinaryPath } from "@/lib/open"
import { isAbsolutePath, resolveAny } from "@/lib/tools/paths"

describe("isBinaryPath", () => {
  it("recognises common binary / preview extensions", () => {
    expect(isBinaryPath("/x/Codezal_0.5.3_aarch64.dmg")).toBe(true)
    expect(isBinaryPath("C:\\out\\setup.exe")).toBe(true)
    expect(isBinaryPath("/r/report.PDF")).toBe(true)
    expect(isBinaryPath("/a/b/photo.png")).toBe(true)
  })
  it("rejects code / text files", () => {
    expect(isBinaryPath("src/lib/open.ts")).toBe(false)
    expect(isBinaryPath("README.md")).toBe(false)
    expect(isBinaryPath("Makefile")).toBe(false)
  })
  it("does not crash on extension-less or dotfiles", () => {
    expect(isBinaryPath("/etc/hosts")).toBe(false)
    expect(isBinaryPath(".gitignore")).toBe(false)
  })
  it("does not confuse a dotted directory with an extension", () => {
    expect(isBinaryPath("/a.b/README")).toBe(false)
  })
})

describe("humanSize", () => {
  it("formats B / KB / MB without ugly trailing .0", () => {
    expect(humanSize(0)).toBe("0 B")
    expect(humanSize(512)).toBe("512 B")
    expect(humanSize(1024)).toBe("1 KB")
    expect(humanSize(1536)).toBe("1.5 KB")
    expect(humanSize(91 * 1024 * 1024)).toBe("91 MB")
  })
  it("returns empty string for invalid input", () => {
    expect(humanSize(-1)).toBe("")
  })
})

describe("resolveAny", () => {
  it("normalises absolute paths as-is, including outside the workspace", () => {
    expect(resolveAny("/ws", "/elsewhere/out.dmg")).toBe("/elsewhere/out.dmg")
  })
  it("joins relative paths to the workspace", () => {
    expect(resolveAny("/ws", "target/a.dmg")).toBe("/ws/target/a.dmg")
    expect(resolveAny("/ws/", "./target/a.dmg")).toBe("/ws/target/a.dmg")
  })
  it("does not enforce the workspace boundary (.. escapes)", () => {
    expect(resolveAny("/ws", "../other/x")).toBe("/other/x")
  })
  it("throws on a relative path with no workspace", () => {
    expect(() => resolveAny("", "rel")).toThrow()
  })
})

describe("isAbsolutePath", () => {
  it("recognises posix and windows absolute paths", () => {
    expect(isAbsolutePath("/a/b")).toBe(true)
    expect(isAbsolutePath("C:\\a")).toBe(true)
    expect(isAbsolutePath("rel/path")).toBe(false)
  })
})
