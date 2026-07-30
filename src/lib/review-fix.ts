// Pure helpers for the pre-commit review "Fix with AI" action: routing the fix
// request back to the session that produced the change, and building the prompt.
//
// No React / store / Tauri imports on purpose — this module is side-effect free
// so it stays node-testable (the driving hook, use-commit-review.tsx, pulls in
// the store and cannot be imported from the node test env).
import type { ReviewResult } from "@/lib/git-review"
import type { Part, Session } from "@/store/types"

// Tools that write a single file — the path field we read to know which files a
// session touched (so an "AI fix" can be routed back to the producing session).
const FILE_WRITE_TOOLS = new Set(["write_file", "edit_file", "apply_patch", "notebook_edit"])

function toolCallPath(toolName: string, input: unknown): string | null {
  if (!FILE_WRITE_TOOLS.has(toolName)) return null
  if (!input || typeof input !== "object") return null
  const o = input as Record<string, unknown>
  const raw =
    typeof o.path === "string"
      ? o.path
      : typeof o.notebook_path === "string"
        ? o.notebook_path
        : typeof o.file_path === "string"
          ? o.file_path
          : null
  return raw ? raw.replace(/\\/g, "/") : null
}

// Repo-relative files a session wrote via tool calls (forward-slash normalized).
export function sessionTouchedFiles(session: Pick<Session, "messages">): Set<string> {
  const out = new Set<string>()
  for (const m of session.messages ?? []) {
    for (const p of m.parts ?? []) {
      if ((p as Part).type !== "tool-call") continue
      const call = p as Extract<Part, { type: "tool-call" }>
      const path = toolCallPath(call.toolName, call.input)
      if (path) out.add(path)
    }
  }
  return out
}

// Pick the session that produced `changedFiles` within `workspace`: the one
// whose tool-call writes overlap the changed files the most (ties broken by the
// most recently updated). Returns null when no session overlaps — callers must
// then open a brand-new session so an unrelated chat is never mutated.
export function pickTargetSession(
  sessions: Record<string, Session>,
  workspace: string,
  changedFiles: string[],
): string | null {
  const changed = new Set(changedFiles.map((f) => f.replace(/\\/g, "/")))
  if (changed.size === 0) return null
  let bestId: string | null = null
  let bestScore = 0
  let bestUpdated = -1
  for (const s of Object.values(sessions)) {
    if ((s.workspacePath ?? "") !== workspace) continue
    const touched = sessionTouchedFiles(s)
    let score = 0
    for (const f of touched) if (changed.has(f)) score++
    const updated = s.updatedAt ?? 0
    if (score > 0 && (score > bestScore || (score === bestScore && updated > bestUpdated))) {
      bestScore = score
      bestUpdated = updated
      bestId = s.id
    }
  }
  return bestId
}

// English model instruction (code on disk stays English) listing the findings.
export function buildFixPrompt(result: ReviewResult): string {
  const lines = result.findings.map((f) => {
    const loc = f.file ? ` (${f.file}${f.line ? `:${f.line}` : ""})` : ""
    return `- [${f.severity}/${f.category}]${loc} ${f.message}`
  })
  const summary = result.summary ? `Overall: ${result.summary}\n` : ""
  return (
    "The pre-commit review flagged the following findings in the current changes. " +
    "Fix them directly in the working tree by editing the relevant files. " +
    "Do NOT run git commit, git add, or git stage — only make the code changes, " +
    "then briefly summarize what you changed.\n\n" +
    summary +
    "Findings:\n" +
    lines.join("\n")
  )
}
