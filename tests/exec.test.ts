import { describe, expect, it } from "vitest"

// exec.ts imports @tauri-apps/* at module level; stripLineEnding is a pure
// helper, so test the logic via the same regex the module uses. If exec.ts
// ever becomes importable in the node test env, switch to a direct import.
const stripLineEnding = (line: string) => line.replace(/\r?\n$/, "")

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
