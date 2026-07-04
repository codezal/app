// GitHub REST API client — show PRs/issues inside the IDE + open PRs from agents.
// Direct REST over `tauriFetch` (no octokit — minimal deps). The token lives in
// the OS keychain under the reserved `apiKey.github` account (secret-store).
//
// Scope: mostly read-only. The ONE write path is `createPullRequest` (powers the
// `create_pr` tool / issue→PR background agent); it requires a token with the
// `repo` scope. Posting comments / reviews stays out of scope (later phase).
//
// Pure helpers (parseRemoteUrl, parseNextLink, mapCheckRun, mapStatus,
// rollupState, findPrForBranch) carry no Tauri dependency and are unit-tested.
import { tauriFetch } from "@/lib/providers/tauri-fetch"
import { loadAllSecrets, setApiKeySecret } from "@/lib/providers/secret-store"
import { gitRemoteUrl } from "@/lib/git"
import { errorMessage } from "@/lib/errors"

const API = "https://api.github.com"
// Reserved secret id (string account `apiKey.github`); no provider collision.
const SECRET_ID = "github"

// ----- token (keychain) -----------------------------------------------------

export async function getGithubToken(): Promise<string | null> {
  const s = await loadAllSecrets()
  const t = s.apiKeys[SECRET_ID]
  return t && t.trim() ? t : null
}

// Store (or, with null/empty, clear) the GitHub PAT.
export async function setGithubToken(token: string | null): Promise<void> {
  await setApiKeySecret(SECRET_ID, token)
}

// ----- owner/repo ------------------------------------------------------------

export type OwnerRepo = { owner: string; repo: string }

// Parse a git remote URL → {owner, repo}. Supports https, scp-like (git@…:o/r),
// and ssh:// forms, optional `.git`, trailing slash, userinfo, and a port.
// Non-github.com hosts (enterprise) return null for now.
export function parseRemoteUrl(url: string): OwnerRepo | null {
  const raw = url.trim()
  if (!raw) return null

  let host: string
  let path: string
  // scp-like: git@github.com:owner/repo.git  (no scheme, single colon split)
  const scp = raw.match(/^[^/@]+@([^/:]+):(.+)$/)
  if (scp) {
    host = scp[1]
    path = scp[2]
  } else {
    try {
      const u = new URL(raw)
      host = u.hostname
      path = u.pathname
    } catch {
      return null
    }
  }

  if (host.toLowerCase().replace(/^www\./, "") !== "github.com") return null

  const seg = path
    .replace(/^\/+/, "")
    .replace(/\.git$/i, "")
    .replace(/\/+$/, "")
    .split("/")
  if (seg.length < 2 || !seg[0] || !seg[1]) return null
  return { owner: seg[0], repo: seg[1] }
}

// workspace → {owner, repo} via `git remote get-url origin`. null if no remote
// or non-GitHub host.
export async function resolveRepo(workspace: string): Promise<OwnerRepo | null> {
  const url = await gitRemoteUrl(workspace)
  return url ? parseRemoteUrl(url) : null
}

// ----- REST core -------------------------------------------------------------

export type GithubErrorInfo =
  | { kind: "unauthorized" }
  | { kind: "rate_limit"; resetAt: number | null }
  | { kind: "not_found" }
  | { kind: "http"; status: number; message: string }
  | { kind: "network"; message: string }

export class GithubApiError extends Error {
  info: GithubErrorInfo
  constructor(info: GithubErrorInfo, message?: string) {
    super(message ?? info.kind)
    this.name = "GithubApiError"
    this.info = info
  }
}

function ghHeaders(token: string, extra?: HeadersInit): HeadersInit {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "Codezal",
    ...extra,
  }
}

// One request to an absolute URL. Maps GitHub failure modes to typed errors.
async function request(url: string, token: string, init?: RequestInit): Promise<Response> {
  let res: Response
  try {
    res = await tauriFetch(url, { ...init, headers: ghHeaders(token, init?.headers) })
  } catch (e) {
    throw new GithubApiError({ kind: "network", message: errorMessage(e) })
  }
  if (!res.ok) {
    if (res.status === 401) throw new GithubApiError({ kind: "unauthorized" })
    if (res.status === 403 && res.headers.get("x-ratelimit-remaining") === "0") {
      const reset = res.headers.get("x-ratelimit-reset")
      throw new GithubApiError({ kind: "rate_limit", resetAt: reset ? Number(reset) * 1000 : null })
    }
    if (res.status === 404) throw new GithubApiError({ kind: "not_found" })
    let msg = `HTTP ${res.status}`
    try {
      const j = (await res.json()) as { message?: string }
      if (j?.message) msg = j.message
    } catch {
      // non-JSON body — keep generic message
    }
    throw new GithubApiError({ kind: "http", status: res.status, message: msg }, msg)
  }
  return res
}

async function ghJson<T>(path: string, token: string): Promise<T> {
  const res = await request(`${API}${path}`, token)
  return (await res.json()) as T
}

// GET a relative path with a custom Accept, returning the raw text body. Used to
// fetch a PR's unified diff (Accept: application/vnd.github.v3.diff). The Accept
// here overrides ghHeaders' default (extra headers are merged last).
async function ghText(path: string, token: string, accept: string): Promise<string> {
  const res = await request(`${API}${path}`, token, { headers: { Accept: accept } })
  return await res.text()
}

// POST a JSON body to a relative API path. Used by the single write endpoint
// (createPullRequest). Failure modes map through `request` → typed GithubApiError.
async function ghPost<T>(path: string, token: string, body: unknown): Promise<T> {
  const res = await request(`${API}${path}`, token, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
  return (await res.json()) as T
}

// `rel="next"` URL from a Link header, or null.
export function parseNextLink(link: string | null): string | null {
  if (!link) return null
  for (const part of link.split(",")) {
    const m = part.match(/<([^>]+)>\s*;\s*rel="next"/)
    if (m) return m[1]
  }
  return null
}

// Follow `rel="next"` until exhausted (capped). Concatenates array pages.
// maxPages bounds runaway pagination — 10 × 100 = 1000 items is plenty for a
// panel; beyond that the user can refine on GitHub.
async function ghPaged<T>(path: string, token: string, maxPages = 10): Promise<T[]> {
  let url: string | null = `${API}${path}${path.includes("?") ? "&" : "?"}per_page=100`
  const out: T[] = []
  let pages = 0
  while (url && pages < maxPages) {
    const res = await request(url, token)
    const page = (await res.json()) as T[]
    out.push(...page)
    url = parseNextLink(res.headers.get("link"))
    pages++
  }
  return out
}

// ----- view models -----------------------------------------------------------

export type PrState = "open" | "closed" | "merged"

export type PullRequestSummary = {
  number: number
  title: string
  state: PrState
  draft: boolean
  author: string
  headRef: string
  headSha: string
  baseRef: string
  htmlUrl: string
  commentCount: number
  updatedAt: string
  createdAt: string
}

export type CheckState = "success" | "failure" | "pending" | "neutral"

export type CheckItem = {
  name: string
  state: CheckState
  detailsUrl: string | null
  description?: string
}

export type CombinedChecks = { rollup: CheckState; items: CheckItem[] }

export type ReviewerState = "approved" | "changes_requested" | "commented" | "pending" | "requested"
export type ReviewerItem = { login: string; state: ReviewerState }

export type PrFile = {
  filename: string
  status: string
  additions: number
  deletions: number
  blobUrl: string | null
}

export type PrDetail = {
  summary: PullRequestSummary
  body: string
  additions: number
  deletions: number
  changedFiles: number
  commits: number
  reviewers: ReviewerItem[]
}

export type PrComment = {
  kind: "issue" | "review" | "review-summary"
  author: string
  body: string
  createdAt: string
  htmlUrl: string | null
  path?: string
  line?: number | null
}

export type IssueSummary = {
  number: number
  title: string
  state: "open" | "closed"
  author: string
  labels: string[]
  commentCount: number
  htmlUrl: string
  updatedAt: string
}

export type IssueDetail = IssueSummary & { body: string }

// ----- pure mappers (unit-tested) --------------------------------------------

// check-run (Checks API) status+conclusion → unified state.
export function mapCheckRun(status: string, conclusion: string | null): CheckState {
  if (status !== "completed") return "pending"
  switch (conclusion) {
    case "success":
      return "success"
    case "failure":
    case "timed_out":
    case "cancelled":
    case "action_required":
    case "startup_failure":
      return "failure"
    case "neutral":
    case "skipped":
    case "stale":
      return "neutral"
    default:
      return "neutral"
  }
}

// commit-status (legacy Statuses API) state → unified state.
export function mapStatus(state: string): CheckState {
  switch (state) {
    case "success":
      return "success"
    case "failure":
    case "error":
      return "failure"
    case "pending":
      return "pending"
    default:
      return "neutral"
  }
}

// Rollup priority: failure > pending > success; empty → neutral.
export function rollupState(items: CheckState[]): CheckState {
  if (items.length === 0) return "neutral"
  if (items.some((s) => s === "failure")) return "failure"
  if (items.some((s) => s === "pending")) return "pending"
  if (items.some((s) => s === "success")) return "success"
  return "neutral"
}

export function findPrForBranch(
  prs: PullRequestSummary[],
  branch: string | null,
): PullRequestSummary | null {
  if (!branch) return null
  return prs.find((p) => p.headRef === branch) ?? null
}

// The /issues endpoint also returns pull requests (every PR is an issue in
// GitHub's data model). A `pull_request` field marks those — filter them out so
// the issue list shows only real issues.
type RawIssue = {
  number: number
  title?: string
  state?: string
  user?: { login?: string } | null
  labels?: Array<{ name?: string } | string> | null
  comments?: number
  html_url?: string
  body?: string | null
  updated_at?: string
  pull_request?: unknown
}

export function isPullRequest(raw: { pull_request?: unknown }): boolean {
  return raw.pull_request != null
}

export function mapIssueSummary(raw: RawIssue): IssueSummary {
  const labels = (raw.labels ?? [])
    .map((l) => (typeof l === "string" ? l : (l?.name ?? "")))
    .filter(Boolean)
  return {
    number: raw.number,
    title: raw.title ?? "",
    state: raw.state === "closed" ? "closed" : "open",
    author: raw.user?.login ?? "?",
    labels,
    commentCount: raw.comments ?? 0,
    htmlUrl: raw.html_url ?? "",
    updatedAt: raw.updated_at ?? "",
  }
}

function mapIssue(raw: RawIssue): IssueDetail {
  return { ...mapIssueSummary(raw), body: raw.body ?? "" }
}

// ----- raw GitHub shapes (only the fields we read) ---------------------------

type RawPull = {
  number: number
  title: string
  state: string
  draft?: boolean
  merged_at?: string | null
  user?: { login?: string } | null
  head?: { ref?: string; sha?: string } | null
  base?: { ref?: string } | null
  html_url?: string
  body?: string | null
  comments?: number
  review_comments?: number
  additions?: number
  deletions?: number
  changed_files?: number
  commits?: number
  requested_reviewers?: Array<{ login?: string }> | null
  updated_at?: string
  created_at?: string
}

function mapPull(raw: RawPull): PullRequestSummary {
  const state: PrState = raw.merged_at ? "merged" : raw.state === "closed" ? "closed" : "open"
  return {
    number: raw.number,
    title: raw.title ?? "",
    state,
    draft: Boolean(raw.draft),
    author: raw.user?.login ?? "?",
    headRef: raw.head?.ref ?? "",
    headSha: raw.head?.sha ?? "",
    baseRef: raw.base?.ref ?? "",
    htmlUrl: raw.html_url ?? "",
    commentCount: (raw.comments ?? 0) + (raw.review_comments ?? 0),
    updatedAt: raw.updated_at ?? "",
    createdAt: raw.created_at ?? "",
  }
}

// ----- endpoints -------------------------------------------------------------

export async function listPullRequests(
  token: string,
  repo: OwnerRepo,
  state: "open" | "closed" | "all" = "open",
): Promise<PullRequestSummary[]> {
  const raw = await ghPaged<RawPull>(
    `/repos/${repo.owner}/${repo.repo}/pulls?state=${state}&sort=updated&direction=desc`,
    token,
  )
  return raw.map(mapPull)
}

export async function getPrDetail(
  token: string,
  repo: OwnerRepo,
  num: number,
): Promise<PrDetail> {
  const base = `/repos/${repo.owner}/${repo.repo}/pulls/${num}`
  const [raw, reviews] = await Promise.all([
    ghJson<RawPull>(base, token),
    // Paginate — reviewers can exceed one page on heavily-reviewed PRs.
    ghPaged<RawReview>(`${base}/reviews`, token),
  ])
  return {
    summary: mapPull(raw),
    body: raw.body ?? "",
    additions: raw.additions ?? 0,
    deletions: raw.deletions ?? 0,
    changedFiles: raw.changed_files ?? 0,
    commits: raw.commits ?? 0,
    reviewers: mergeReviewers(raw.requested_reviewers ?? [], reviews),
  }
}

type RawReview = {
  user?: { login?: string } | null
  state?: string
  body?: string | null
  submitted_at?: string | null
  html_url?: string
}

// Requested (not-yet-reviewed) + latest submitted state per reviewer.
function mergeReviewers(
  requested: Array<{ login?: string }>,
  reviews: RawReview[],
): ReviewerItem[] {
  const byLogin = new Map<string, ReviewerState>()
  for (const r of reviews) {
    const login = r.user?.login
    if (!login) continue
    const st = (r.state ?? "").toUpperCase()
    if (st === "APPROVED") byLogin.set(login, "approved")
    else if (st === "CHANGES_REQUESTED") byLogin.set(login, "changes_requested")
    else if (st === "COMMENTED") {
      // don't downgrade a prior approve/changes verdict to a plain comment
      if (!byLogin.has(login)) byLogin.set(login, "commented")
    }
  }
  for (const rr of requested) {
    if (rr.login && !byLogin.has(rr.login)) byLogin.set(rr.login, "requested")
  }
  return [...byLogin.entries()].map(([login, state]) => ({ login, state }))
}

type RawStatus = {
  state?: string
  statuses?: Array<{ context?: string; state?: string; target_url?: string | null; description?: string | null }>
}
type RawCheckRuns = {
  check_runs?: Array<{ name?: string; status?: string; conclusion?: string | null; details_url?: string | null }>
}

// Merge the two independent GitHub systems (Checks API + legacy Statuses) into
// one list + a single rollup. A repo may populate either or both.
export async function getCombinedChecks(
  token: string,
  repo: OwnerRepo,
  sha: string,
): Promise<CombinedChecks> {
  const baseC = `/repos/${repo.owner}/${repo.repo}/commits/${sha}`
  const [status, runs] = await Promise.all([
    ghJson<RawStatus>(`${baseC}/status`, token),
    ghJson<RawCheckRuns>(`${baseC}/check-runs`, token),
  ])
  const items: CheckItem[] = [
    ...(runs.check_runs ?? []).map((c) => ({
      name: c.name ?? "check",
      state: mapCheckRun(c.status ?? "", c.conclusion ?? null),
      detailsUrl: c.details_url ?? null,
    })),
    ...(status.statuses ?? []).map((s) => ({
      name: s.context ?? "status",
      state: mapStatus(s.state ?? ""),
      detailsUrl: s.target_url ?? null,
      description: s.description ?? undefined,
    })),
  ]
  return { rollup: rollupState(items.map((i) => i.state)), items }
}

type RawFile = {
  filename?: string
  status?: string
  additions?: number
  deletions?: number
  blob_url?: string | null
}

export async function listPrFiles(token: string, repo: OwnerRepo, num: number): Promise<PrFile[]> {
  const raw = await ghPaged<RawFile>(`/repos/${repo.owner}/${repo.repo}/pulls/${num}/files`, token)
  return raw.map((f) => ({
    filename: f.filename ?? "",
    status: f.status ?? "",
    additions: f.additions ?? 0,
    deletions: f.deletions ?? 0,
    blobUrl: f.blob_url ?? null,
  }))
}

type RawIssueComment = {
  user?: { login?: string } | null
  body?: string | null
  created_at?: string
  html_url?: string
}
type RawReviewComment = RawIssueComment & {
  path?: string
  line?: number | null
  original_line?: number | null
}

// Full conversation: issue comments + inline review comments + review summaries
// (reviews with a non-empty body), merged and sorted oldest→newest.
export async function listPrConversation(
  token: string,
  repo: OwnerRepo,
  num: number,
): Promise<PrComment[]> {
  const r = `/repos/${repo.owner}/${repo.repo}`
  const [issue, review, reviews] = await Promise.all([
    ghPaged<RawIssueComment>(`${r}/issues/${num}/comments`, token),
    ghPaged<RawReviewComment>(`${r}/pulls/${num}/comments`, token),
    ghPaged<RawReview>(`${r}/pulls/${num}/reviews`, token),
  ])
  const out: PrComment[] = [
    ...issue.map((c) => ({
      kind: "issue" as const,
      author: c.user?.login ?? "?",
      body: c.body ?? "",
      createdAt: c.created_at ?? "",
      htmlUrl: c.html_url ?? null,
    })),
    ...review.map((c) => ({
      kind: "review" as const,
      author: c.user?.login ?? "?",
      body: c.body ?? "",
      createdAt: c.created_at ?? "",
      htmlUrl: c.html_url ?? null,
      path: c.path,
      line: c.line ?? c.original_line ?? null,
    })),
    ...reviews
      .filter((rv) => (rv.body ?? "").trim().length > 0)
      .map((rv) => ({
        kind: "review-summary" as const,
        author: rv.user?.login ?? "?",
        body: rv.body ?? "",
        createdAt: rv.submitted_at ?? "",
        htmlUrl: rv.html_url ?? null,
      })),
  ]
  return out.sort((a, b) => a.createdAt.localeCompare(b.createdAt))
}

// ----- issues ----------------------------------------------------------------

// Open (default) / closed / all issues, newest-updated first. PRs are filtered
// out (the /issues endpoint returns them too). Powers the issue→PR launcher.
export async function listIssues(
  token: string,
  repo: OwnerRepo,
  state: "open" | "closed" | "all" = "open",
): Promise<IssueSummary[]> {
  const raw = await ghPaged<RawIssue>(
    `/repos/${repo.owner}/${repo.repo}/issues?state=${state}&sort=updated&direction=desc`,
    token,
  )
  return raw.filter((r) => !isPullRequest(r)).map(mapIssueSummary)
}

export async function getIssue(token: string, repo: OwnerRepo, num: number): Promise<IssueDetail> {
  const raw = await ghJson<RawIssue>(`/repos/${repo.owner}/${repo.repo}/issues/${num}`, token)
  return mapIssue(raw)
}

// ----- write: open a pull request --------------------------------------------

export type CreatePrInput = {
  title: string
  // Branch the changes live on (the worktree/feature branch).
  head: string
  // Branch to merge into (e.g. the repo default branch).
  base: string
  body?: string
  draft?: boolean
}

export type CreatedPr = { number: number; htmlUrl: string }

// Open a PR (POST /pulls). Requires a `repo`-scoped token. Returns the new PR's
// number + URL. GitHub rejects (422) if head==base, the branch isn't pushed, or
// a PR already exists for head → surfaced as a typed http error.
export async function createPullRequest(
  token: string,
  repo: OwnerRepo,
  input: CreatePrInput,
): Promise<CreatedPr> {
  const raw = await ghPost<{ number: number; html_url?: string }>(
    `/repos/${repo.owner}/${repo.repo}/pulls`,
    token,
    {
      title: input.title,
      head: input.head,
      base: input.base,
      body: input.body ?? "",
      draft: input.draft ?? false,
    },
  )
  return { number: raw.number, htmlUrl: raw.html_url ?? "" }
}

// ----- PR review (read diff + post comment) ----------------------------------

// A PR's unified diff (the whole patch as text). Powers the auto-review daemon —
// the reviewer reads this instead of checking out the branch.
export async function getPrDiff(token: string, repo: OwnerRepo, num: number): Promise<string> {
  return ghText(
    `/repos/${repo.owner}/${repo.repo}/pulls/${num}`,
    token,
    "application/vnd.github.v3.diff",
  )
}

// Post a top-level (issue) comment on a PR. Write — needs the `repo` scope. Used
// by the auto-review daemon to publish its findings back to the PR.
export async function postIssueComment(
  token: string,
  repo: OwnerRepo,
  num: number,
  body: string,
): Promise<void> {
  await ghPost(`/repos/${repo.owner}/${repo.repo}/issues/${num}/comments`, token, { body })
}

export type PrReviewComment = { path: string; line: number; body: string }

// Parse a unified diff → per file, the set of NEW-side (RIGHT) line numbers that
// can carry an inline review comment: added (`+`) and context (` `) lines inside a
// hunk. GitHub rejects (422) inline comments on lines outside the diff, so the
// review daemon filters its findings against this before posting. Pure → tested.
export function diffCommentableLines(diff: string): Map<string, Set<number>> {
  const out = new Map<string, Set<number>>()
  let path: string | null = null
  let newLine = 0
  let inHunk = false
  for (const raw of diff.split("\n")) {
    if (raw.startsWith("+++ ")) {
      // "+++ b/path" (or "+++ /dev/null" for a deletion). Strip the b/ prefix.
      const p = raw.slice(4).replace(/^b\//, "").trim()
      path = p === "/dev/null" ? null : p
      if (path && !out.has(path)) out.set(path, new Set())
      inHunk = false
      continue
    }
    if (raw.startsWith("@@")) {
      const m = raw.match(/@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/)
      if (m) {
        newLine = parseInt(m[1], 10)
        inHunk = true
      }
      continue
    }
    if (!inHunk || !path) continue
    if (raw.startsWith("-")) continue // removed → LEFT side, new-line doesn't advance
    if (raw.startsWith("\\")) continue // "\ No newline at end of file"
    if (raw.startsWith("+") || raw.startsWith(" ")) {
      out.get(path)!.add(newLine)
      newLine++
    }
  }
  return out
}

// Open a review with inline file:line comments (POST /pulls/{n}/reviews). Write —
// needs the `repo` scope. event "COMMENT" posts feedback without approving /
// requesting changes. Each comment targets the RIGHT (new) side.
export async function createPullRequestReview(
  token: string,
  repo: OwnerRepo,
  num: number,
  input: {
    body?: string
    comments: PrReviewComment[]
    event?: "COMMENT" | "APPROVE" | "REQUEST_CHANGES"
  },
): Promise<{ htmlUrl: string }> {
  const raw = await ghPost<{ html_url?: string }>(
    `/repos/${repo.owner}/${repo.repo}/pulls/${num}/reviews`,
    token,
    {
      body: input.body ?? "",
      event: input.event ?? "COMMENT",
      comments: input.comments.map((c) => ({
        path: c.path,
        line: c.line,
        side: "RIGHT",
        body: c.body,
      })),
    },
  )
  return { htmlUrl: raw.html_url ?? "" }
}
