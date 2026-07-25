import { describe, it, expect } from "vitest"
import { parseReviewJson, hasCritical, type ReviewResult } from "@/lib/git-review"

describe("parseReviewJson", () => {
  it("parses a well-formed verdict", () => {
    const raw = JSON.stringify({
      findings: [
        {
          severity: "critical",
          category: "security",
          file: "src/auth.ts",
          line: 42,
          message: "Token is logged in plaintext.",
        },
        { severity: "info", category: "style", message: "Prefer const here." },
      ],
      summary: "One blocking security issue.",
    })
    const r = parseReviewJson(raw)
    expect(r.summary).toBe("One blocking security issue.")
    expect(r.findings).toHaveLength(2)
    expect(r.findings[0]).toEqual({
      severity: "critical",
      category: "security",
      file: "src/auth.ts",
      line: 42,
      message: "Token is logged in plaintext.",
    })
    // Optional file/line are omitted when absent.
    expect(r.findings[1]).toEqual({
      severity: "info",
      category: "style",
      message: "Prefer const here.",
    })
  })

  it("strips markdown code fences", () => {
    const raw = "```json\n" + JSON.stringify({ findings: [], summary: "clean" }) + "\n```"
    expect(parseReviewJson(raw)).toEqual({ findings: [], summary: "clean" })
  })

  it("slices JSON out of surrounding prose", () => {
    const raw =
      'Here is my review:\n{"findings":[{"severity":"warning","category":"bug","message":"off by one"}],"summary":"minor"}\nThanks!'
    const r = parseReviewJson(raw)
    expect(r.findings).toHaveLength(1)
    expect(r.findings[0].message).toBe("off by one")
  })

  it("normalizes severity and category synonyms", () => {
    const raw = JSON.stringify({
      findings: [
        { severity: "BLOCKER", category: "vuln", message: "a" },
        { severity: "nit", category: "perf", message: "b" },
        { severity: "weird", category: "unknown", message: "c" },
      ],
      summary: "",
    })
    const r = parseReviewJson(raw)
    expect(r.findings[0].severity).toBe("critical")
    expect(r.findings[0].category).toBe("security")
    expect(r.findings[1].severity).toBe("info")
    expect(r.findings[1].category).toBe("performance")
    // Unknown values fall back to sensible defaults rather than being dropped.
    expect(r.findings[2].severity).toBe("warning")
    expect(r.findings[2].category).toBe("bug")
  })

  it("drops findings without a message and ignores bad line numbers", () => {
    const raw = JSON.stringify({
      findings: [
        { severity: "warning", category: "bug" },
        { severity: "warning", category: "bug", message: "  " },
        { severity: "warning", category: "bug", message: "ok", line: -3 },
        { severity: "warning", category: "bug", message: "ok2", line: 7 },
      ],
      summary: "",
    })
    const r = parseReviewJson(raw)
    expect(r.findings).toHaveLength(2)
    expect(r.findings[0].line).toBeUndefined()
    expect(r.findings[1].line).toBe(7)
  })

  it("degrades malformed input to a clean result, never throwing", () => {
    const empty: ReviewResult = { findings: [], summary: "" }
    expect(parseReviewJson("")).toEqual(empty)
    expect(parseReviewJson("not json at all")).toEqual(empty)
    expect(parseReviewJson("{ broken")).toEqual(empty)
    expect(parseReviewJson("[1,2,3]")).toEqual(empty)
    expect(parseReviewJson('{"findings":"nope","summary":123}')).toEqual(empty)
  })
})

describe("hasCritical", () => {
  it("is true only when a critical finding exists", () => {
    expect(hasCritical({ findings: [], summary: "" })).toBe(false)
    expect(
      hasCritical({
        findings: [{ severity: "warning", category: "bug", message: "x" }],
        summary: "",
      }),
    ).toBe(false)
    expect(
      hasCritical({
        findings: [{ severity: "critical", category: "security", message: "x" }],
        summary: "",
      }),
    ).toBe(true)
  })
})
