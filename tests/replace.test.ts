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
