import { describe, it, expect, vi } from "vitest"

// github.ts → git.ts → exec.ts (plugin-shell) ve tauri-fetch (plugin-http) import
vi.mock("@tauri-apps/plugin-shell", () => ({ Command: { create: vi.fn() } }))
vi.mock("@tauri-apps/plugin-http", () => ({ fetch: vi.fn() }))
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn().mockResolvedValue("") }))

import {
  parseRemoteUrl,
  parseNextLink,
  mapCheckRun,
  mapStatus,
  rollupState,
  findPrForBranch,
  isPullRequest,
  mapIssueSummary,
  diffCommentableLines,
  type PullRequestSummary,
} from "@/lib/github"

describe("parseRemoteUrl", () => {
  it("https + .git", () => {
    expect(parseRemoteUrl("https://github.com/codezal/app.git")).toEqual({ owner: "codezal", repo: "app" })
  })
  it("https without .git", () => {
    expect(parseRemoteUrl("https://github.com/codezal/app")).toEqual({ owner: "codezal", repo: "app" })
  })
  it("scp-like git@", () => {
    expect(parseRemoteUrl("git@github.com:codezal/app.git")).toEqual({ owner: "codezal", repo: "app" })
  })
  it("ssh:// form", () => {
    expect(parseRemoteUrl("ssh://git@github.com/codezal/app.git")).toEqual({ owner: "codezal", repo: "app" })
  })
  it("https with userinfo + trailing slash", () => {
    expect(parseRemoteUrl("https://user@github.com/codezal/app/")).toEqual({ owner: "codezal", repo: "app" })
  })
  it("www host normalized", () => {
    expect(parseRemoteUrl("https://www.github.com/codezal/app")).toEqual({ owner: "codezal", repo: "app" })
  })
  it("non-github host → null", () => {
    expect(parseRemoteUrl("https://gitlab.com/codezal/app.git")).toBeNull()
    expect(parseRemoteUrl("git@bitbucket.org:codezal/app.git")).toBeNull()
  })
  it("garbage / incomplete → null", () => {
    expect(parseRemoteUrl("")).toBeNull()
    expect(parseRemoteUrl("not a url")).toBeNull()
    expect(parseRemoteUrl("https://github.com/onlyowner")).toBeNull()
  })
})

describe("parseNextLink", () => {
  it("extracts rel=next", () => {
    const link =
      '<https://api.github.com/x?page=2>; rel="next", <https://api.github.com/x?page=5>; rel="last"'
    expect(parseNextLink(link)).toBe("https://api.github.com/x?page=2")
  })
  it("no next → null", () => {
    expect(parseNextLink('<https://api.github.com/x?page=5>; rel="last"')).toBeNull()
    expect(parseNextLink(null)).toBeNull()
  })
})

describe("mapCheckRun", () => {
  it("completed conclusions", () => {
    expect(mapCheckRun("completed", "success")).toBe("success")
    expect(mapCheckRun("completed", "failure")).toBe("failure")
    expect(mapCheckRun("completed", "timed_out")).toBe("failure")
    expect(mapCheckRun("completed", "cancelled")).toBe("failure")
    expect(mapCheckRun("completed", "neutral")).toBe("neutral")
    expect(mapCheckRun("completed", "skipped")).toBe("neutral")
    expect(mapCheckRun("completed", null)).toBe("neutral")
  })
  it("non-completed → pending", () => {
    expect(mapCheckRun("in_progress", null)).toBe("pending")
    expect(mapCheckRun("queued", null)).toBe("pending")
  })
})

describe("mapStatus", () => {
  it("maps commit-status states", () => {
    expect(mapStatus("success")).toBe("success")
    expect(mapStatus("failure")).toBe("failure")
    expect(mapStatus("error")).toBe("failure")
    expect(mapStatus("pending")).toBe("pending")
    expect(mapStatus("weird")).toBe("neutral")
  })
})

describe("rollupState", () => {
  it("failure beats pending beats success", () => {
    expect(rollupState(["success", "pending", "failure"])).toBe("failure")
    expect(rollupState(["success", "pending"])).toBe("pending")
    expect(rollupState(["success", "success"])).toBe("success")
  })
  it("empty → neutral", () => {
    expect(rollupState([])).toBe("neutral")
    expect(rollupState(["neutral"])).toBe("neutral")
  })
})

describe("findPrForBranch", () => {
  const mk = (n: number, headRef: string): PullRequestSummary => ({
    number: n,
    title: `pr ${n}`,
    state: "open",
    draft: false,
    author: "x",
    headRef,
    headSha: "sha",
    baseRef: "main",
    htmlUrl: "",
    commentCount: 0,
    updatedAt: "",
    createdAt: "",
  })
  it("matches head branch", () => {
    const prs = [mk(1, "feature-a"), mk(2, "feature-b")]
    expect(findPrForBranch(prs, "feature-b")?.number).toBe(2)
  })
  it("no branch / no match → null", () => {
    expect(findPrForBranch([mk(1, "x")], null)).toBeNull()
    expect(findPrForBranch([mk(1, "x")], "y")).toBeNull()
  })
})

describe("isPullRequest", () => {
  it("flags issues carrying a pull_request field (the /issues endpoint returns PRs too)", () => {
    expect(isPullRequest({ pull_request: { url: "x" } })).toBe(true)
    expect(isPullRequest({})).toBe(false)
    expect(isPullRequest({ pull_request: undefined })).toBe(false)
  })
})

describe("mapIssueSummary", () => {
  it("normalizes labels (string + object forms) and defaults", () => {
    const s = mapIssueSummary({
      number: 7,
      title: "Fix login",
      state: "open",
      user: { login: "alice" },
      labels: [{ name: "bug" }, "p1", { name: "" }],
      comments: 3,
      html_url: "https://github.com/o/r/issues/7",
      updated_at: "2026-01-02T00:00:00Z",
    })
    expect(s).toEqual({
      number: 7,
      title: "Fix login",
      state: "open",
      author: "alice",
      labels: ["bug", "p1"],
      commentCount: 3,
      htmlUrl: "https://github.com/o/r/issues/7",
      updatedAt: "2026-01-02T00:00:00Z",
    })
  })
  it("missing fields → safe defaults; closed state preserved", () => {
    const s = mapIssueSummary({ number: 1, state: "closed" })
    expect(s.title).toBe("")
    expect(s.author).toBe("?")
    expect(s.labels).toEqual([])
    expect(s.state).toBe("closed")
  })
})

describe("diffCommentableLines", () => {
  const diff = [
    "diff --git a/src/a.ts b/src/a.ts",
    "index 111..222 100644",
    "--- a/src/a.ts",
    "+++ b/src/a.ts",
    "@@ -1,3 +1,4 @@",
    " const x = 1", // context → new line 1
    "-const y = 2", // removed → no new line
    "+const y = 3", // added → new line 2
    "+const z = 4", // added → new line 3
    " return x", //    context → new line 4
    "diff --git a/old.ts b/old.ts",
    "--- a/old.ts",
    "+++ /dev/null", // deletion → not commentable
    "@@ -1,2 +0,0 @@",
    "-gone",
  ].join("\n")

  it("maps added + context lines on the new side; skips removed and deletions", () => {
    const m = diffCommentableLines(diff)
    expect([...(m.get("src/a.ts") ?? [])].sort((a, b) => a - b)).toEqual([1, 2, 3, 4])
    // /dev/null target → path null → not recorded
    expect(m.has("old.ts")).toBe(false)
  })

  it("advances the new-line counter from the hunk header, not from file start", () => {
    const d = ["--- a/f", "+++ b/f", "@@ -40,2 +50,3 @@", " keep", "+added", " keep2"].join("\n")
    const set = diffCommentableLines(d).get("f")
    expect([...(set ?? [])].sort((a, b) => a - b)).toEqual([50, 51, 52])
  })
})
