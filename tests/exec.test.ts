import { describe, expect, it, vi } from "vitest"

// exec.ts imports @tauri-apps/* at module level; mock those so the module is
// importable in the node test env, then test the REAL exported helper (M94).
// Testing an inline copy would never catch a regression in exec.ts itself.
vi.mock("@tauri-apps/plugin-shell", () => ({
  Command: { create: vi.fn() },
}))
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}))

import { stripLineEnding } from "@/lib/exec"

describe("stripLineEnding (plugin-shell line events keep trailing newline)", () => {
  it("strips a trailing LF", () => {
    expect(stripLineEnding("hello\n")).toBe("hello")
  })

  it("strips a trailing CRLF", () => {
    expect(stripLineEnding("hello\r\n")).toBe("hello")
  })

  it("leaves a line without trailing newline untouched", () => {
    expect(stripLineEnding("hello")).toBe("hello")
  })

  it("strips only one trailing line ending", () => {
    expect(stripLineEnding("hello\n\n")).toBe("hello\n")
  })

  it("keeps interior newlines", () => {
    expect(stripLineEnding("a\nb\n")).toBe("a\nb")
  })

  it("re-joining stripped lines reproduces the original output", () => {
    // Simulates executeKillable: events arrive with trailing "\n", the ring
    // stores stripped lines, and the result is joined with "\n".
    const events = ["line one\n", "line two\n", "partial tail"]
    const joined = events.map(stripLineEnding).join("\n")
    expect(joined).toBe("line one\nline two\npartial tail")
  })
})
