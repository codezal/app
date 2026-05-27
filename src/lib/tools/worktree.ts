// Git worktree yardımcıları — paralel branch'lerde çalışmak için.
// create: git worktree add — yeni branch veya mevcut branch
// list:   git worktree list --porcelain
// remove: git worktree remove (--force opsiyonel)
import { Command } from "@tauri-apps/plugin-shell"
import { exists } from "@tauri-apps/plugin-fs"

function shellQuote(s: string): string {
  return "'" + s.replace(/'/g, `'\\''`) + "'"
}

async function runInRepo(repoPath: string, cmd: string): Promise<{ code: number; stdout: string; stderr: string }> {
  const wrapped = `cd ${shellQuote(repoPath)} && ${cmd}`
  const out = await Command.create("bash", ["-lc", wrapped]).execute()
  return { code: out.code ?? -1, stdout: out.stdout, stderr: out.stderr }
}

export type WorktreeEntry = {
  path: string
  head: string
  branch?: string
  bare: boolean
  detached: boolean
  locked?: string
}

// Repo kökünden worktree listesi parse et.
export async function listWorktrees(repoPath: string): Promise<WorktreeEntry[]> {
  const r = await runInRepo(repoPath, "git worktree list --porcelain")
  if (r.code !== 0) throw new Error(`git worktree list başarısız: ${r.stderr.trim()}`)
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
  // Worktree hedef path (absolute). Yoksa repoPath kardeşinde <repoName>-<branch>
  target?: string
  branch: string
  // baseRef varsa yeni branch oluşturulur (-b). Yoksa mevcut branch checkout edilir.
  baseRef?: string
}

export async function createWorktree(opts: CreateWorktreeOpts): Promise<WorktreeEntry> {
  const { repoPath, branch, baseRef } = opts
  if (!branch) throw new Error("branch parametresi gerekli")

  // Hedef path belirle
  let target = opts.target
  if (!target) {
    const repoNorm = repoPath.replace(/\/+$/, "")
    const lastSep = Math.max(repoNorm.lastIndexOf("/"), repoNorm.lastIndexOf("\\"))
    const parent = lastSep >= 0 ? repoNorm.slice(0, lastSep) : "."
    const repoName = lastSep >= 0 ? repoNorm.slice(lastSep + 1) : repoNorm
    target = `${parent}/${repoName}-wt-${branch.replace(/[^a-zA-Z0-9._-]/g, "_")}`
  }

  if (await exists(target)) {
    throw new Error(`Hedef worktree path zaten var: ${target}`)
  }

  // Komut kur — baseRef varsa yeni branch
  const cmd = baseRef
    ? `git worktree add -b ${shellQuote(branch)} ${shellQuote(target)} ${shellQuote(baseRef)}`
    : `git worktree add ${shellQuote(target)} ${shellQuote(branch)}`

  const r = await runInRepo(repoPath, cmd)
  if (r.code !== 0) {
    throw new Error(`git worktree add başarısız: ${r.stderr.trim() || r.stdout.trim()}`)
  }

  // Aktif branch onayla
  const br = await runInRepo(target, "git rev-parse --abbrev-ref HEAD")
  const head = await runInRepo(target, "git rev-parse HEAD")
  return {
    path: target,
    head: head.stdout.trim(),
    branch: br.stdout.trim(),
    bare: false,
    detached: false,
  }
}

export async function removeWorktree(repoPath: string, target: string, force = false): Promise<void> {
  const cmd = `git worktree remove ${force ? "--force " : ""}${shellQuote(target)}`
  const r = await runInRepo(repoPath, cmd)
  if (r.code !== 0) {
    throw new Error(`git worktree remove başarısız: ${r.stderr.trim() || r.stdout.trim()}`)
  }
}

// Verilen path bir worktree mi, hangi repo'ya ait? Yardımcı.
export async function findRepoRoot(path: string): Promise<string | null> {
  const r = await runInRepo(path, "git rev-parse --show-toplevel")
  if (r.code !== 0) return null
  return r.stdout.trim() || null
}

// Mevcut branch listesi (local)
export async function listBranches(repoPath: string): Promise<string[]> {
  const r = await runInRepo(repoPath, "git branch --format='%(refname:short)'")
  if (r.code !== 0) return []
  return r.stdout
    .split("\n")
    .map((s) => s.replace(/^['"]|['"]$/g, "").trim())
    .filter(Boolean)
}
