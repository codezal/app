import { describe, it, expect } from "vitest"
import {
  parseReviewJson,
  hasCritical,
  diffFiles,
  type ReviewResult,
} from "@/lib/git-review"
import {
  pickTargetSession,
  sessionTouchedFiles,
  buildFixPrompt,
} from "@/lib/review-fix"
import type { Session } from "@/store/types"

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

describe("diffFiles", () => {
  it("extracts the b/ side of plain diff headers", () => {
    const diff = [
      "diff --git a/src/foo.ts b/src/foo.ts",
      "index 1111111..2222222 100644",
      "--- a/src/foo.ts",
      "+++ b/src/foo.ts",
      "diff --git a/src/bar.ts b/src/bar.ts",
    ].join("\n")
    expect(diffFiles(diff)).toEqual(["src/foo.ts", "src/bar.ts"])
  })

  it("uses the b/ side for renames and unquotes quoted paths", () => {
    const diff = [
      'diff --git "a/old name.ts" "b/new name.ts"',
      "similarity index 90%",
      "rename from old name.ts",
      "rename to new name.ts",
    ].join("\n")
    expect(diffFiles(diff)).toEqual(["new name.ts"])
  })

  it("dedupes and normalizes backslashes", () => {
    const diff = [
      "diff --git a/src\\x.ts b/src\\x.ts",
      "diff --git a/src/x.ts b/src/x.ts",
    ].join("\n")
    expect(diffFiles(diff)).toEqual(["src/x.ts"])
  })

  it("returns [] for empty or header-only diffs", () => {
    expect(diffFiles("")).toEqual([])
    expect(diffFiles("# git diff\n")).toEqual([])
  })
})

// Minimal Session stand-in — only the fields the pure helpers read.
function sess(
  id: string,
  workspacePath: string,
  updatedAt: number,
  calls: Array<{ toolName: string; input: unknown }>,
): Session {
  return {
    id,
    workspacePath,
    updatedAt,
    messages: [
      {
        id: "m",
        role: "assistant",
        content: "",
        parts: calls.map((c, i) => ({
          type: "tool-call",
          toolCallId: `c${i}`,
          toolName: c.toolName,
          input: c.input,
        })),
      },
    ],
  } as unknown as Session
}

describe("sessionTouchedFiles", () => {
  it("collects paths from write tools and ignores read/bash", () => {
    const s = sess("a", "/w", 1, [
      { toolName: "write_file", input: { path: "src/a.ts" } },
      { toolName: "edit_file", input: { path: "src\\b.ts" } },
      { toolName: "notebook_edit", input: { notebook_path: "nb.ipynb" } },
      { toolName: "read_file", input: { path: "src/secret.ts" } },
      { toolName: "bash", input: { command: "rm -rf /" } },
    ])
    expect([...sessionTouchedFiles(s)].sort()).toEqual(["nb.ipynb", "src/a.ts", "src/b.ts"])
  })
})

describe("pickTargetSession", () => {
  it("picks the session whose writes overlap the changed files", () => {
    const sessions: Record<string, Session> = {
      a: sess("a", "/w", 1, [{ toolName: "edit_file", input: { path: "src/a.ts" } }]),
      b: sess("b", "/w", 2, [{ toolName: "edit_file", input: { path: "src/b.ts" } }]),
    }
    expect(pickTargetSession(sessions, "/w", ["src/b.ts", "src/c.ts"])).toBe("b")
  })

  it("ignores sessions in a different workspace", () => {
    const sessions: Record<string, Session> = {
      a: sess("a", "/other", 9, [{ toolName: "edit_file", input: { path: "src/a.ts" } }]),
    }
    expect(pickTargetSession(sessions, "/w", ["src/a.ts"])).toBeNull()
  })

  it("returns null when no session overlaps (so a fresh one is opened)", () => {
    const sessions: Record<string, Session> = {
      a: sess("a", "/w", 1, [{ toolName: "edit_file", input: { path: "src/a.ts" } }]),
    }
    expect(pickTargetSession(sessions, "/w", ["src/unrelated.ts"])).toBeNull()
  })

  it("breaks ties by most recently updated", () => {
    const sessions: Record<string, Session> = {
      old: sess("old", "/w", 1, [{ toolName: "edit_file", input: { path: "src/a.ts" } }]),
      new: sess("new", "/w", 5, [{ toolName: "edit_file", input: { path: "src/a.ts" } }]),
    }
    expect(pickTargetSession(sessions, "/w", ["src/a.ts"])).toBe("new")
  })

  it("returns null for an empty changed-file list", () => {
    const sessions: Record<string, Session> = {
      a: sess("a", "/w", 1, [{ toolName: "edit_file", input: { path: "src/a.ts" } }]),
    }
    expect(pickTargetSession(sessions, "/w", [])).toBeNull()
  })
})

describe("buildFixPrompt", () => {
  it("lists every finding with location and forbids committing", () => {
    const prompt = buildFixPrompt({
      findings: [
        { severity: "warning", category: "bug", file: "src/x.ts", line: 10, message: "off by one" },
        { severity: "info", category: "style", message: "prefer const" },
      ],
      summary: "Two nits.",
    })
    expect(prompt).toContain("Overall: Two nits.")
    expect(prompt).toContain("[warning/bug] (src/x.ts:10) off by one")
    expect(prompt).toContain("[info/style] prefer const")
    expect(prompt).toMatch(/Do NOT run git commit/)
  })
})
