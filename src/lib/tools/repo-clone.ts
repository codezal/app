import { homeDir } from "@tauri-apps/api/path"
import { exists } from "@tauri-apps/plugin-fs"
import { withLock } from "../lock"
import { runProgram } from "@/lib/exec"
import { isWindows } from "@/lib/platform"

// Normalise a path for a "is it under $HOME?" prefix check: forward slashes,
// no trailing slash, case-folded on Windows (NTFS is case-insensitive).
function normalizeForHomeCheck(p: string): string {
  let n = p.replace(/\\/g, "/").replace(/\/+$/, "")
  if (isWindows()) n = n.toLowerCase()
  return n
}

export type CloneResult = {
  path: string
  repoName: string
  branch?: string
  stdout: string
}

//   https://github.com/owner/repo
//   https://github.com/owner/repo.git
//   git@github.com:owner/repo.git
//   https://gitlab.com/group/sub/repo
function parseRepoName(url: string): string {
  let last = url.trim()
  // Strip .git suffix.
  last = last.replace(/\.git\/?$/, "")
  // Last path segment.
  const idx = Math.max(last.lastIndexOf("/"), last.lastIndexOf(":"))
  const name = idx >= 0 ? last.slice(idx + 1) : last
  if (!name) throw new Error(`Could not infer repo name from URL: ${url}`)
  if (name === "." || name === ".." || !/^[a-zA-Z0-9._-]+$/.test(name)) {
    throw new Error(`Invalid repo name: ${name}`)
  }
  return name
}

function validateBranch(branch: string): void {
  if (!/^[A-Za-z0-9/_.-]+$/.test(branch) || branch.startsWith("-") || branch.includes("..")) {
    throw new Error(
      `Invalid branch name: ${branch}; only letters/digits/_/./- are allowed, it cannot start with '-', and it cannot contain '..'`,
    )
  }
}

export async function cloneRepo(opts: {
  url: string
  target?: string
  branch?: string
  depth?: number
}): Promise<CloneResult> {
  const { url, branch, depth } = opts
  if (!url) throw new Error("URL is required")
  if (!/^(https?:\/\/|git@|ssh:\/\/)/i.test(url)) {
    throw new Error("Unsupported URL scheme: https://, git@, or ssh:// required")
  }

  const repoName = parseRepoName(url)
  if (branch) validateBranch(branch)

  // The read tools (and the Rust FS layer behind them) can only access paths
  // under $HOME. Cloning outside $HOME (e.g. /tmp) would succeed but leave the
  // repo unreadable by every tool — including subagents — so reject it up front
  // and steer callers to the default ~/Documents/<repo>.
  const home = (await homeDir()).replace(/[/\\]+$/, "")
  const normHome = normalizeForHomeCheck(home)

  let target = opts.target
  if (!target) {
    target = `${home}/Documents/${repoName}`
  } else {
    const normTarget = normalizeForHomeCheck(target)
    if (normTarget !== normHome && !normTarget.startsWith(normHome + "/")) {
      throw new Error(
        `Clone target must be under your home directory (default ~/Documents/${repoName}); ` +
          `paths outside $HOME cannot be read by the tools. Got: ${target}`,
      )
    }
  }

  const dest = target
  return withLock(`repo-clone:${dest}`, async () => {
    if (await exists(dest)) {
      throw new Error(`Target folder already exists: ${dest}; provide a different 'target' or delete it manually`)
    }

    const flags: string[] = []
    if (branch) flags.push("--branch", branch)
    if (depth && depth > 0) flags.push("--depth", String(depth))
    const result = await runProgram("git", ["clone", ...flags, url, dest], { timeoutMs: 300_000 })

    if (result.code !== 0) {
      throw new Error(
        `git clone failed (exit ${result.code}):\n${result.stderr.trim() || result.stdout.trim()}`,
      )
    }

    let activeBranch: string | undefined
    try {
      const br = await runProgram("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd: dest })
      if (br.code === 0) activeBranch = br.stdout.trim()
    } catch {
      // Intentionally ignored.
    }

    return {
      path: dest,
      repoName,
      branch: activeBranch,
      stdout: (result.stdout + "\n" + result.stderr).trim(),
    }
  })
}
