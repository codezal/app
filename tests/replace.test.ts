import { describe, it, expect } from "vitest"
import { replace } from "@/lib/tools/replace"


describe("replace — exact match", () => {
  it("replaces an exact match", () => {
    expect(replace("const x = 1", "x = 1", "x = 2")).toBe("const x = 2")
  })

  it("old === new → error", () => {
    expect(() => replace("abc", "a", "a")).toThrow(/identical/)
  })

  it("not found → error", () => {
    expect(() => replace("abc", "xyz", "q")).toThrow(/not found/)
  })

  it("multiple matches without replace_all → error", () => {
    expect(() => replace("x x", "x", "Y")).toThrow(/multiple places/)
  })
})

// ─── fallback replacers ───────────────────────────────────────────────────────

describe("replace — fallback matching", () => {
  it("line-trim: tolerates indentation mismatch", () => {
    const content = "if (x) {\n    doThing()\n}"
    const find = "if (x) {\ndoThing()\n}"
    expect(replace(content, find, "DONE")).toBe("DONE")
  })

  it("whitespace-normalize: tolerates excess internal whitespace", () => {
    expect(replace("const   a   =   1", "const a = 1", "X")).toBe("X")
  })
})


describe("replace — over-broad block protection", () => {
  it("block-anchor: does not match a disproportionately large block (maxLineDelta)", () => {
    const content = [
      "function foo() {",
      "  a()",
      "  b()",
      "  c()",
      "  d()",
      "  e()",
      "  f()",
      "}",
    ].join("\n")
    const find = "function foo() {\n  ONLY_THIS\n}"
    expect(() => replace(content, find, "X")).toThrow(/not found/)
  })
})

// ─── replace_all ──────────────────────────────────────────────────────────────

describe("replace — replace_all", () => {
  it("replaces every occurrence (rename)", () => {
    expect(replace("a x a x a", "x", "Y", true)).toBe("a Y a Y a")
  })

  it("works even with a single occurrence", () => {
    expect(replace("foo", "foo", "bar", true)).toBe("bar")
  })
})

// ─── CRLF (Windows line endings) ─────────────────────────────────────────────

describe("replace — CRLF files", () => {
  it("exact match works when the file is CRLF but old_string is LF", () => {
    const content = "line1\r\nconst x = 1\r\nline3\r\n"
    expect(replace(content, "const x = 1", "const x = 2")).toBe(
      "line1\r\nconst x = 2\r\nline3\r\n",
    )
  })

  it("multi-line LF old_string matches a CRLF file", () => {
    const content = "a\r\nb\r\nc\r\n"
    expect(replace(content, "a\nb", "X")).toBe("X\r\nc\r\n")
  })

  it("preserves CRLF style across the whole result", () => {
    const content = "x\r\ny\r\n"
    const out = replace(content, "y", "z")
    expect(out).toBe("x\r\nz\r\n")
    expect(out).not.toMatch(/[^\r]\n/) // no bare LF introduced
  })

  it("keeps LF style for LF files (no regression)", () => {
    expect(replace("a\nb\n", "b", "c")).toBe("a\nc\n")
  })

  it("replace_all works on CRLF content", () => {
    expect(replace("a\r\nx\r\na\r\nx\r\n", "x", "Y", true)).toBe("a\r\nY\r\na\r\nY\r\n")
  })
})
