// list:   git worktree list --porcelain
// remove: git worktree remove (--force optional)
import { exists, remove } from "@tauri-apps/plugin-fs"
import { runProgram } from "@/lib/exec"
import { errorMessage } from "@/lib/errors"

const GIT_FLAGS = [
  "--no-optional-locks",
  "-c",
  "core.fsmonitor=false",
  "-c",
  "core.longpaths=true",
  "-c",
  "core.symlinks=true",
  "-c",
  "core.quotepath=false",
]

export function canonicalPath(p: string): string {
  const fwd = p.replace(/\\/g, "/")
  const abs = fwd.startsWith("/")
  const out: string[] = []
  for (const seg of fwd.split("/")) {
    if (seg === "" || seg === ".") continue
    if (seg === "..") {
      if (out.length && out[out.length - 1] !== "..") out.pop()
      else out.push("..")
      continue
    }
    out.push(seg)
  }
  let norm = (abs ? "/" : "") + out.join("/")
  if (/^[A-Za-z]:/.test(norm)) norm = norm.toLowerCase()
  return norm
}

export async function runGit(
  cwd: string,
  args: string[],
): Promise<{ code: number; stdout: string; stderr: string }> {
  try {
    return await runProgram("git", [...GIT_FLAGS, ...args], { cwd })
  } catch (e) {
    return { code: -1, stdout: "", stderr: errorMessage(e) }
  }
}

export type WorktreeEntry = {
  path: string
  head: string
  branch?: string
  bare: boolean
  detached: boolean
  locked?: string
}

export async function listWorktrees(repoPath: string): Promise<WorktreeEntry[]> {
  const r = await runGit(repoPath, ["worktree", "list", "--porcelain"])
  if (r.code !== 0) throw new Error(`git worktree list failed: ${r.stderr.trim()}`)
  return parseWorktreePorcelain(r.stdout)
}

function parseWorktreePorcelain(out: string): WorktreeEntry[] {
  const blocks = out.split(/\n\n+/).map((b) => b.trim()).filter(Boolean)
  const entries: WorktreeEntry[] = []
  for (const block of blocks) {
    const lines = block.split("\n")
    const e: WorktreeEntry = { path: "", head: "", bare: false, detached: false }
    for (const line of lines) {
      if (line.startsWith("worktree ")) e.path = line.slice("worktree ".length).trim()
      else if (line.startsWith("HEAD ")) e.head = line.slice("HEAD ".length).trim()
      else if (line.startsWith("branch ")) {
        e.branch = line.slice("branch ".length).trim().replace(/^refs\/heads\//, "")
      } else if (line === "bare") e.bare = true
      else if (line === "detached") e.detached = true
      else if (line.startsWith("locked")) {
        e.locked = line.length > "locked".length ? line.slice("locked ".length).trim() : "locked"
      }
    }
    if (e.path) entries.push(e)
  }
  return entries
}

export type CreateWorktreeOpts = {
  repoPath: string
  target?: string
  branch: string
  baseRef?: string
}

export async function createWorktree(opts: CreateWorktreeOpts): Promise<WorktreeEntry> {
  const { repoPath, branch, baseRef } = opts
  if (!branch) throw new Error("branch parameter is required")

  let target = opts.target
  if (!target) {
    const repoNorm = repoPath.replace(/\/+$/, "")
    const lastSep = Math.max(repoNorm.lastIndexOf("/"), repoNorm.lastIndexOf("\\"))
    const parent = lastSep >= 0 ? repoNorm.slice(0, lastSep) : "."
    const repoName = lastSep >= 0 ? repoNorm.slice(lastSep + 1) : repoNorm
    target = `${parent}/${repoName}-wt-${branch.replace(/[^a-zA-Z0-9._-]/g, "_")}`
  }

  if (await exists(target)) {
    throw new Error(`Target worktree path already exists: ${target}`)
  }

  const args = baseRef
    ? ["worktree", "add", "-b", branch, target, baseRef]
    : ["worktree", "add", target, branch]

  const r = await runGit(repoPath, args)
  if (r.code !== 0) {
    throw new Error(`git worktree add failed: ${r.stderr.trim() || r.stdout.trim()}`)
  }

  const br = await runGit(target, ["rev-parse", "--abbrev-ref", "HEAD"])
  const head = await runGit(target, ["rev-parse", "HEAD"])
  return {
    path: target,
    head: head.stdout.trim(),
    branch: br.stdout.trim(),
    bare: false,
    detached: false,
  }
}

export async function removeWorktree(repoPath: string, target: string, force = false): Promise<void> {
  await runGit(target, ["fsmonitor--daemon", "stop"]).catch(() => {})

  const args = force ? ["worktree", "remove", "--force", target] : ["worktree", "remove", target]
  const r = await runGit(repoPath, args)
  if (r.code === 0) return

  const removeErr = r.stderr.trim() || r.stdout.trim()
  const list = await listWorktrees(repoPath).catch(() => [] as WorktreeEntry[])
  const t = canonicalPath(target)
  // Main worktree = first entry of `git worktree list`; repoPath is a belt-and-suspenders check.
  const mainPath = list[0] ? canonicalPath(list[0].path) : canonicalPath(repoPath)
  if (t === mainPath || t === canonicalPath(repoPath)) {
    throw new Error(
      `Cannot delete the main worktree (${target}) — it is this repo's primary working tree; FS-level deletion refused.`,
    )
  }
  if (!list.some((e) => canonicalPath(e.path) === t)) {
    throw new Error(
      `git worktree remove failed and '${target}' is not a registered worktree in this repo — not deleted: ${removeErr}`,
    )
  }
  // git refused to remove WITHOUT --force — almost always uncommitted changes /
  // dirty state. Never fall through to a recursive FS delete on a worktree the
  // user did not force: that destroys uncommitted work. Require explicit force.
  if (!force) {
    throw new Error(
      `git worktree remove failed (uncommitted changes?) — pass force to delete anyway: ${removeErr}`,
    )
  }
  if (await exists(target)) {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await remove(target, { recursive: true })
        break
      } catch {
        if (attempt < 2) await new Promise((res) => setTimeout(res, 100))
      }
    }
  }

  await runGit(repoPath, ["worktree", "prune"]).catch(() => {})

  if (await exists(target)) {
    throw new Error(`git worktree remove failed: ${removeErr}`)
  }
}

export async function findRepoRoot(path: string): Promise<string | null> {
  const r = await runGit(path, ["rev-parse", "--show-toplevel"])
  if (r.code !== 0) return null
  return r.stdout.trim() || null
}

// Current branch list (local)
export async function listBranches(repoPath: string): Promise<string[]> {
  const r = await runGit(repoPath, ["branch", "--format=%(refname:short)"])
  if (r.code !== 0) return []
  return r.stdout
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean)
}
