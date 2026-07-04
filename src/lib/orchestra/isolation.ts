import { findAgent } from "../agents"
import {
  createWorktree,
  removeWorktree,
  findRepoRoot,
  listWorktrees,
  runGit,
  canonicalPath,
} from "../tools/worktree"
import type { WorkerConfig, WorkerDispatchResult } from "./types"
import { errorMessage } from "@/lib/errors"

const WRITE_TOOLS = ["write_file", "edit_file", "bash", "apply_patch"]

const WORKER_BRANCH_PREFIX = "codezal/wk-"

function parsePorcelainZ(out: string): string[] {
  const paths: string[] = []
  const tokens = out.split("\0")
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i]
    if (!tok) continue
    const x = tok[0]
    paths.push(tok.slice(3))
    if (x === "R" || x === "C") i++
  }
  return paths
}

async function ignoredOutputs(wt: string): Promise<string[]> {
  try {
    const r = await runGit(wt, ["ls-files", "--others", "--ignored", "--exclude-standard", "-z"])
    if (r.code !== 0) return []
    return r.stdout.split("\0").filter(Boolean)
  } catch {
    return []
  }
}

function ignoredNote(wt: string, files: string[]): string {
  const head = files.slice(0, 5).join(", ")
  const more = files.length > 5 ? `, +${files.length - 5} more` : ""
  return `${files.length} gitignored output file(s) preserved at ${wt} (not committed — recover manually): ${head}${more}`
}

export type WorkerIsolation = {
  workWorkspace: string | undefined
  configWorkspace: string | undefined
  isolated: boolean
  repoPath?: string
  branch?: string
  worktreePath?: string
  preserve?: boolean
  note?: string
}

export async function isWriteCapable(
  w: WorkerConfig,
  configWorkspace: string | undefined,
): Promise<boolean> {
  // CLI/ACP worker'lar dinamik tool setine sahip — hepsi (approval ile) yazabilir, izole et.
  if (
    w.kind === "claude-cli" ||
    w.kind === "codex-cli" ||
    w.kind === "opencode-cli" ||
    w.kind === "kimi-cli" ||
    w.kind === "gemini-cli" ||
    w.kind === "acp"
  )
    return true

  if (w.presetAgent) {
    try {
      const ag = await findAgent(configWorkspace, w.presetAgent)
      const p = ag?.policy
      if (p) {
        if (p.planMode) return false
        if (
          p.tools &&
          p.tools.length > 0 &&
          !WRITE_TOOLS.some((t) => p.tools!.includes(t))
        ) {
          return false
        }
        if (p.denyTools && WRITE_TOOLS.every((t) => p.denyTools!.includes(t))) {
          return false
        }
      }
    } catch {
      // Intentionally ignored.
    }
  }
  return true
}

export async function setupWorkerIsolation(
  w: WorkerConfig,
  configWorkspace: string | undefined,
  workerId: string,
  taskNum: number,
): Promise<WorkerIsolation> {
  const noop: WorkerIsolation = {
    workWorkspace: configWorkspace,
    configWorkspace,
    isolated: false,
  }
  if (!configWorkspace) return noop
  if (!(await isWriteCapable(w, configWorkspace))) return noop

  const repoPath = await findRepoRoot(configWorkspace)
  if (!repoPath) {
    return { ...noop, note: "isolation skipped: not a git repo" }
  }

  const branch = `codezal/wk-${w.idx}-${taskNum}-${workerId.slice(0, 8)}`
  try {
    const head = await runGit(repoPath, ["rev-parse", "HEAD"])
    const baseRef = head.code === 0 ? head.stdout.trim() : undefined
    if (!baseRef) {
      return { ...noop, note: "isolation skipped: no HEAD commit" }
    }
    const wt = await createWorktree({ repoPath, branch, baseRef })
    return {
      workWorkspace: wt.path,
      configWorkspace,
      isolated: true,
      repoPath,
      branch,
      worktreePath: wt.path,
    }
  } catch (e) {
    const msg = errorMessage(e)
    return { ...noop, note: `isolation skipped: worktree create failed: ${msg}` }
  }
}

export async function finalizeIsolation(
  iso: WorkerIsolation | null,
  result: WorkerDispatchResult,
  task: string,
): Promise<WorkerDispatchResult> {
  if (!iso || !iso.isolated || !iso.repoPath || !iso.worktreePath) {
    return iso?.note ? { ...result, isolationNote: iso.note } : result
  }

  const wt = iso.worktreePath
  const out: WorkerDispatchResult = { ...result, isolated: true, branch: iso.branch }
  try {
    const status = await runGit(wt, ["status", "--porcelain", "-z"])
    if (status.code !== 0) {
      out.committed = false
      out.isolationNote =
        `uncommitted changes preserved at ${wt} ` +
        `(git status failed: ${status.stderr.trim().slice(0, 120)})`
      iso.preserve = true
      return out
    }
    const changed = parsePorcelainZ(status.stdout)
    if (changed.length === 0) {
      out.committed = false
      out.changedFiles = []
      const ignored = await ignoredOutputs(wt)
      if (ignored.length) {
        iso.preserve = true
        out.isolationNote = ignoredNote(wt, ignored)
      }
      return out
    }
    out.changedFiles = changed

    const add = await runGit(wt, ["add", "--", ...changed])
    if (add.code !== 0) {
      out.committed = false
      out.isolationNote =
        `uncommitted changes preserved at ${wt} ` +
        `(git add failed: ${add.stderr.trim().slice(0, 120)})`
      iso.preserve = true
      return out
    }
    const msg = `worker: ${task.slice(0, 60)}`
    const commit = await runGit(wt, ["commit", "--no-verify", "-m", msg])
    if (commit.code !== 0) {
      out.committed = false
      out.isolationNote =
        `uncommitted changes preserved at ${wt} ` +
        `(commit failed: ${commit.stderr.trim().slice(0, 120)})`
      iso.preserve = true
      return out
    }

    out.committed = true
    const sha = await runGit(wt, ["rev-parse", "HEAD"])
    out.commitSha = sha.stdout.trim().slice(0, 12)
    const diff = await runGit(wt, ["diff", "--stat", "HEAD~1", "HEAD"])
    out.diffSummary = diff.stdout.trim().slice(0, 2000)
    const ignored = await ignoredOutputs(wt)
    if (ignored.length) {
      iso.preserve = true
      out.isolationNote = ignoredNote(wt, ignored)
    }
  } catch (e) {
    out.isolationNote = `finalize error: ${errorMessage(e)}`
  }
  return out
}

// iso.preserve set ise (commit fail) silMEZ.
export async function teardownWorkerIsolation(
  iso: WorkerIsolation | null,
): Promise<void> {
  if (!iso || !iso.isolated || !iso.repoPath || !iso.worktreePath) return
  if (iso.preserve) return
  try {
    await removeWorktree(iso.repoPath, iso.worktreePath, true)
  } catch {
    // Intentionally ignored.
  }
}

export type CleanupResult = {
  removed: number
  preserved: number
  branchesRemoved: number
}

//
export async function cleanupStaleIsolation(
  configWorkspace: string | undefined,
  activeWorktreePaths: Set<string> = new Set(),
): Promise<CleanupResult> {
  const result: CleanupResult = { removed: 0, preserved: 0, branchesRemoved: 0 }
  if (!configWorkspace) return result

  const repoPath = await findRepoRoot(configWorkspace)
  if (!repoPath) return result

  let entries
  try {
    entries = await listWorktrees(repoPath)
  } catch {
    return result
  }

  const mergedSet = new Set<string>()
  try {
    const merged = await runGit(repoPath, [
      "branch",
      "--merged",
      "HEAD",
      "--format=%(refname:short)",
    ])
    if (merged.code === 0) {
      for (const line of merged.stdout.split("\n")) {
        const b = line.trim()
        if (b) mergedSet.add(b)
      }
    }
  } catch {
    // Intentionally ignored.
  }

  const activeCanon = new Set([...activeWorktreePaths].map(canonicalPath))

  for (const e of entries) {
    if (!e.branch?.startsWith(WORKER_BRANCH_PREFIX)) continue
    if (activeCanon.has(canonicalPath(e.path))) continue

    try {
      const status = await runGit(e.path, ["status", "--porcelain"])
      if (status.code === 0 && status.stdout.trim()) {
        result.preserved++
        continue
      }
    } catch {
      result.preserved++
      continue
    }

    try {
      const ign = await runGit(e.path, ["ls-files", "--others", "--ignored", "--exclude-standard", "-z"])
      if (ign.code === 0 && ign.stdout.replace(/\0/g, "").trim()) {
        result.preserved++
        continue
      }
    } catch {
      // Intentionally ignored.
    }

    // Temiz worktree → sil. Hata yutulur (idempotent).
    try {
      await removeWorktree(repoPath, e.path, true)
      result.removed++
    } catch {
      continue
    }

    if (mergedSet.has(e.branch)) {
      try {
        const del = await runGit(repoPath, ["branch", "-d", e.branch])
        if (del.code === 0) result.branchesRemoved++
      } catch {
        // Intentionally ignored.
      }
    }
  }

  return result
}

export type MergeOutcome = {
  branch: string
  status: "merged" | "conflict" | "skipped" | "error"
  conflictFiles?: string[]
  mergeSha?: string
  note?: string
}

//
export async function mergeWorkerBranches(
  repoPath: string,
  branches: string[],
): Promise<MergeOutcome[]> {
  if (branches.length === 0) return []

  const dirty = await runGit(repoPath, ["status", "--porcelain"])
  if (dirty.code !== 0) {
    return branches.map((branch) => ({
      branch,
      status: "skipped" as const,
      note: `git status failed: ${dirty.stderr.trim().slice(0, 120)}`,
    }))
  }
  if (dirty.stdout.trim()) {
    return branches.map((branch) => ({
      branch,
      status: "skipped" as const,
      note: "parent working tree has uncommitted changes — commit or stash first, then merge",
    }))
  }

  const out: MergeOutcome[] = []
  for (const branch of branches) {
    if (!branch.startsWith(WORKER_BRANCH_PREFIX)) {
      out.push({
        branch,
        status: "skipped",
        note: `not a worker branch (expected ${WORKER_BRANCH_PREFIX}* prefix)`,
      })
      continue
    }

    const verify = await runGit(repoPath, [
      "rev-parse",
      "--verify",
      "--quiet",
      `refs/heads/${branch}`,
    ])
    if (verify.code !== 0) {
      out.push({ branch, status: "error", note: "branch not found" })
      continue
    }

    const before = await runGit(repoPath, ["rev-parse", "HEAD"])
    const m = await runGit(repoPath, [
      "merge",
      "--no-ff",
      "-m",
      `merge worker branch ${branch}`,
      branch,
    ])
    if (m.code === 0) {
      const after = await runGit(repoPath, ["rev-parse", "HEAD"])
      const afterSha = after.stdout.trim()
      if (afterSha === before.stdout.trim()) {
        out.push({ branch, status: "skipped", note: "already up to date (no new commits)" })
      } else {
        out.push({ branch, status: "merged", mergeSha: afterSha.slice(0, 12) })
      }
      continue
    }

    const uf = await runGit(repoPath, ["diff", "--name-only", "--diff-filter=U", "-z"])
    const conflictFiles = uf.code === 0 ? uf.stdout.split("\0").filter(Boolean) : []
    await runGit(repoPath, ["merge", "--abort"])
    if (conflictFiles.length > 0) {
      out.push({ branch, status: "conflict", conflictFiles })
    } else {
      out.push({ branch, status: "error", note: m.stderr.trim().slice(0, 160) || "merge failed" })
    }
  }
  return out
}
