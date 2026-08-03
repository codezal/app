// Pre-commit / pre-push code review.
//
// Mirrors git-ai-commit.ts: build a language model, feed it a git diff, and ask
// for a structured verdict. Here the model returns a strict-JSON list of
// findings (bug / security / performance / complexity / style, each with a
// severity) instead of a commit message. The commit surfaces gate on the result
// — see useCommitReview in components/PreCommitReview.tsx.
//
// The JSON parsing/normalization core (parseReviewJson / hasCritical) is pure
// and node-testable; the model call (reviewDiff) is the only effectful part.
import { generateText, tool, isStepCount } from "ai"
import { z } from "zod"
import { buildLanguageModel, type ProviderId } from "@/lib/providers"
import { isCodingAgentGated } from "@/lib/providers/provider-quirks"
import type { Settings } from "@/store/types"
import { gitDiffAll, gitDiffAhead, gitDiffStaged, gitDiffWorktree } from "@/lib/git"

export type ReviewSeverity = "critical" | "warning" | "info"
export type ReviewCategory = "bug" | "security" | "performance" | "complexity" | "style"

export type ReviewFinding = {
  severity: ReviewSeverity
  category: ReviewCategory
  file?: string
  line?: number
  message: string
}

export type ReviewResult = {
  findings: ReviewFinding[]
  summary: string
  // True when there was nothing to review (empty diff) — callers treat this as
  // a clean pass without bothering the model.
  skipped?: boolean
  // Repo-relative paths touched by the reviewed diff (parsed from the diff
  // headers, not the model). Used to route an "AI fix" back to the session that
  // produced the change. Always present (empty array when nothing to review).
  files?: string[]
}

const SYSTEM =
  "You are a meticulous code reviewer. You review a git diff that is about to be " +
  "committed or pushed. Look for: (1) bugs and logic errors, (2) security issues, " +
  "(3) performance regressions, (4) unnecessary complexity, (5) style inconsistencies. " +
  "Only report genuine findings you can point to in the diff — do not invent issues, " +
  "do not repeat the diff back, and do not comment on unchanged code. " +
  "Respond with ONLY a JSON object, no prose and no code fences, of the form: " +
  '{"findings":[{"severity":"critical|warning|info","category":"bug|security|performance|complexity|style",' +
  '"file":"path/to/file","line":12,"message":"one concise sentence"}],"summary":"one sentence overall verdict"}. ' +
  'Use "critical" only for bugs or security issues that should block the change. ' +
  'If the diff looks fine, return {"findings":[],"summary":"..."}.'

// Strip markdown code fences and surrounding quotes, the way git-ai-commit does.
function clean(raw: string): string {
  let t = raw.trim()
  t = t.replace(/^```[a-zA-Z]*\s*/, "").replace(/\s*```$/, "").trim()
  return t
}

function normalizeSeverity(value: unknown): ReviewSeverity {
  const v = String(value ?? "").trim().toLowerCase()
  if (["critical", "error", "high", "blocker", "severe"].includes(v)) return "critical"
  if (["info", "note", "low", "nit", "minor", "suggestion"].includes(v)) return "info"
  return "warning"
}

function normalizeCategory(value: unknown): ReviewCategory {
  const v = String(value ?? "").trim().toLowerCase()
  if (["security", "vulnerability", "vuln", "secret", "injection"].includes(v)) return "security"
  if (["performance", "perf", "speed", "memory"].includes(v)) return "performance"
  if (["complexity", "maintainability", "readability", "complex", "design"].includes(v))
    return "complexity"
  if (["style", "formatting", "format", "lint", "naming", "typo"].includes(v)) return "style"
  return "bug"
}

// Parse + normalize the model's JSON verdict. Never throws: any malformed input
// degrades to an empty (clean) result so a flaky model response can never block
// the user's commit. Exported for unit testing.
export function parseReviewJson(raw: string): ReviewResult {
  const text = clean(raw)
  if (!text) return { findings: [], summary: "" }
  // The model may wrap the JSON in stray prose — slice the outermost braces.
  const start = text.indexOf("{")
  const end = text.lastIndexOf("}")
  if (start === -1 || end === -1 || end <= start) return { findings: [], summary: "" }
  let parsed: unknown
  try {
    parsed = JSON.parse(text.slice(start, end + 1))
  } catch {
    return { findings: [], summary: "" }
  }
  if (typeof parsed !== "object" || parsed === null) return { findings: [], summary: "" }
  const obj = parsed as { findings?: unknown; summary?: unknown }
  const rawFindings = Array.isArray(obj.findings) ? obj.findings : []
  const findings: ReviewFinding[] = []
  for (const item of rawFindings) {
    if (typeof item !== "object" || item === null) continue
    const f = item as Record<string, unknown>
    const message = typeof f.message === "string" ? f.message.trim() : ""
    if (!message) continue
    const finding: ReviewFinding = {
      severity: normalizeSeverity(f.severity),
      category: normalizeCategory(f.category),
      message,
    }
    if (typeof f.file === "string" && f.file.trim()) finding.file = f.file.trim()
    const line = Number(f.line)
    if (Number.isInteger(line) && line > 0) finding.line = line
    findings.push(finding)
  }
  const summary = typeof obj.summary === "string" ? obj.summary.trim() : ""
  return { findings, summary }
}

export function hasCritical(result: ReviewResult): boolean {
  return result.findings.some((f) => f.severity === "critical")
}

// Reverse git's C-style quoting of a path (used when a path contains spaces or
// unusual chars): strip the surrounding quotes and unescape \n \t \r \\ \".
function unquoteGitPath(s: string): string {
  if (s.length >= 2 && s.startsWith('"') && s.endsWith('"')) {
    return s.slice(1, -1).replace(/\\(.)/g, (_m, c: string) => {
      if (c === "n") return "\n"
      if (c === "t") return "\t"
      if (c === "r") return "\r"
      return c
    })
  }
  return s
}

// Repo-relative paths a diff touches, parsed purely from the `diff --git`
// headers (the b/ side = the resulting path, correct for renames too). Never
// throws; malformed lines are skipped. Forward-slash normalized so the result
// can be matched against tool-call paths. Exported for unit testing.
export function diffFiles(diff: string): string[] {
  const files: string[] = []
  const seen = new Set<string>()
  const re = /^diff --git (.+)$/gm
  let m: RegExpExecArray | null
  while ((m = re.exec(diff)) !== null) {
    const rest = m[1]
    let bPath: string | null = null
    if (rest.startsWith('"')) {
      // Quoted form: "a/..." "b/..."
      const firstEnd = rest.indexOf('"', 1)
      const secondStart = firstEnd === -1 ? -1 : rest.indexOf('"', firstEnd + 1)
      const secondEnd = secondStart === -1 ? -1 : rest.indexOf('"', secondStart + 1)
      if (secondEnd !== -1) bPath = unquoteGitPath(rest.slice(secondStart, secondEnd + 1))
    } else {
      const idx = rest.indexOf(" b/")
      if (idx !== -1) bPath = rest.slice(idx + 3)
    }
    if (bPath) {
      const norm = bPath.replace(/^b\//, "").replace(/\\/g, "/")
      if (norm && !seen.has(norm)) {
        seen.add(norm)
        files.push(norm)
      }
    }
  }
  return files
}

// Review the staged diff (mode "commit"), the commits about to be pushed
// (mode "push"), or the full working tree incl. new untracked files (mode
// "worktree", used by the post-turn review). Returns a clean, skipped result
// when there is nothing to review or no model can be built — the gate treats
// both as "proceed".
export async function reviewDiff(opts: {
  providerId: ProviderId
  modelId: string
  settings: Settings
  workspace: string
  // "worktree" reviews the full working-tree diff against HEAD (staged +
  // unstaged) — used by the post-turn review, which is not tied to a git op.
  mode: "commit" | "push" | "worktree"
}): Promise<ReviewResult> {
  const diff =
    opts.mode === "push"
      ? await gitDiffAhead(opts.workspace)
      : opts.mode === "worktree"
        ? await gitDiffWorktree(opts.workspace)
        : (await gitDiffStaged(opts.workspace)) || (await gitDiffAll(opts.workspace))
  const files = diffFiles(diff)
  if (!diff.trim() || diff.startsWith("# git diff")) {
    return { findings: [], summary: "", skipped: true, files }
  }

  const model = await buildLanguageModel({
    providerId: opts.providerId,
    modelId: opts.modelId,
    settings: opts.settings,
  })

  // Gated providers (Kimi For Coding, Z.AI Coding, …) 403 on a bare completion;
  // give them an unused tool and force no tool choice, as git-ai-commit does.
  const gated = isCodingAgentGated(opts.providerId)
  const tools = gated
    ? { noop: tool({ description: "unused", inputSchema: z.object({}), execute: async () => "" }) }
    : undefined

  const result = await generateText({
    model,
    instructions: SYSTEM,
    prompt: `Diff to review:\n\n${diff}`,
    tools,
    toolChoice: gated ? "none" : undefined,
    stopWhen: isStepCount(1),
  })

  return { ...parseReviewJson(result.text ?? ""), files }
}
