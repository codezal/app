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

export type GitStatusEntry = {
  index: string
  worktree: string
  path: string
  oldPath?: string
}

export type GitInfo = {
  branch: string | null
  ahead: number
  behind: number
  upstream: string | null
  clean: boolean
}

export type GitStatus = {
  info: GitInfo
  entries: GitStatusEntry[]
  isRepo: boolean
}

async function exec(workspace: string, args: string[]): Promise<string> {
  const r = await runProgram("git", [...GIT_FLAGS, ...args], { cwd: workspace })
  if (r.code !== 0 && !r.stdout) {
    throw new Error(r.stderr.trim() || `git exit ${r.code}`)
  }
  return r.stdout
}

async function mutate(workspace: string, args: string[]): Promise<string> {
  if (!workspace) throw new Error("workspace yok")
  const r = await runProgram("git", [...GIT_FLAGS, ...args], { cwd: workspace })
  if (r.code !== 0) {
    throw new Error(r.stderr.trim() || r.stdout.trim() || `git ${args[0]} exit ${r.code}`)
  }
  return r.stdout
}

export async function gitStatus(workspace: string): Promise<GitStatus> {
  if (!workspace) {
    return {
      info: { branch: null, ahead: 0, behind: 0, upstream: null, clean: true },
      entries: [],
      isRepo: false,
    }
  }
  let raw: string
  try {
    raw = await exec(workspace, ["status", "--porcelain=v2", "--branch", "--untracked-files=all"])
  } catch (e) {
    const msg = errorMessage(e)
    if (/not a git repository/i.test(msg)) {
      return {
        info: { branch: null, ahead: 0, behind: 0, upstream: null, clean: true },
        entries: [],
        isRepo: false,
      }
    }
    throw e
  }

  const info: GitInfo = {
    branch: null,
    ahead: 0,
    behind: 0,
    upstream: null,
    clean: true,
  }
  const entries: GitStatusEntry[] = []

  for (const line of raw.split("\n")) {
    if (!line) continue
    if (line.startsWith("# branch.head ")) {
      info.branch = line.slice("# branch.head ".length).trim()
    } else if (line.startsWith("# branch.upstream ")) {
      info.upstream = line.slice("# branch.upstream ".length).trim()
    } else if (line.startsWith("# branch.ab ")) {
      const m = line.match(/\+(\d+)\s+-(\d+)/)
      if (m) {
        info.ahead = parseInt(m[1], 10)
        info.behind = parseInt(m[2], 10)
      }
    } else if (line.startsWith("1 ") || line.startsWith("2 ")) {
      // Normal & rename entry
      // Format: "1 XY sub mH mI mW hH hI path"
      // veya:   "2 XY sub mH mI mW hH hI Rxx oldpath\tnewpath"
      const parts = line.split(" ")
      const xy = parts[1] ?? "  "
      const indexChar = xy[0] === "." ? " " : (xy[0] ?? " ")
      const worktreeChar = xy[1] === "." ? " " : (xy[1] ?? " ")
      if (line.startsWith("2 ")) {
        const tailIdx = line.indexOf("\t")
        if (tailIdx !== -1) {
          const newPath = line.slice(line.lastIndexOf(" ", tailIdx - 1) + 1, tailIdx)
          const oldPath = line.slice(tailIdx + 1)
          entries.push({
            index: indexChar,
            worktree: worktreeChar,
            path: newPath,
            oldPath,
          })
          continue
        }
      }
      const pathStart = nthSpaceIndex(line, 8) + 1
      const path = line.slice(pathStart)
      entries.push({ index: indexChar, worktree: worktreeChar, path })
    } else if (line.startsWith("? ")) {
      entries.push({ index: "?", worktree: "?", path: line.slice(2) })
    } else if (line.startsWith("! ")) {
      entries.push({ index: "!", worktree: "!", path: line.slice(2) })
    }
  }

  info.clean = entries.length === 0
  return { info, entries, isRepo: true }
}

function nthSpaceIndex(s: string, n: number): number {
  let i = -1
  for (let k = 0; k < n; k++) {
    i = s.indexOf(" ", i + 1)
    if (i === -1) return -1
  }
  return i
}

// Export edilir: pure + sync → unit-test edilebilir (gitCheckoutBranch/
export function assertSafeBranchName(name: string): void {
  if (!name) throw new Error("branch boş")
  if (name.length > 200) throw new Error("branch adı çok uzun")
  if (!/^[\p{L}\p{N}._/-]+$/u.test(name)) {
    throw new Error("branch adı geçersiz karakter içeriyor")
  }
  if (name.startsWith("/") || name.endsWith("/") || name.includes("//")) {
    throw new Error("branch adı geçersiz")
  }
  if (name.startsWith("-")) {
    throw new Error("branch adı '-' ile başlayamaz")
  }
  if (name.startsWith(".") || name.endsWith(".lock") || name.includes("..")) {
    throw new Error("branch adı geçersiz")
  }
  if (name === "HEAD" || name === "@") {
    throw new Error("branch adı rezerve")
  }
}

export async function gitListBranches(workspace: string): Promise<string[]> {
  if (!workspace) return []
  try {
    const raw = await exec(workspace, ["for-each-ref", "--format=%(refname:short)", "refs/heads/"])
    return raw
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean)
  } catch {
    return []
  }
}

export async function gitCurrentBranch(workspace: string): Promise<string | null> {
  if (!workspace) return null
  try {
    const raw = await exec(workspace, ["rev-parse", "--abbrev-ref", "HEAD"])
    const name = raw.trim()
    if (!name || name === "HEAD") return null
    return name
  } catch {
    return null
  }
}

export async function gitCheckoutBranch(
  workspace: string,
  branch: string,
): Promise<void> {
  if (!workspace) throw new Error("workspace yok")
  assertSafeBranchName(branch)
  const r = await runProgram("git", ["checkout", branch], { cwd: workspace })
  if (r.code !== 0) {
    throw new Error(r.stderr.trim() || `git checkout exit ${r.code}`)
  }
}

export async function gitCreateBranch(
  workspace: string,
  branch: string,
  startRef?: string,
): Promise<void> {
  if (!workspace) throw new Error("workspace yok")
  assertSafeBranchName(branch)
  if (startRef) assertSafeBranchName(startRef)
  const args = startRef ? ["checkout", "-b", branch, startRef] : ["checkout", "-b", branch]
  const r = await runProgram("git", args, { cwd: workspace })
  if (r.code !== 0) {
    throw new Error(r.stderr.trim() || `git checkout -b exit ${r.code}`)
  }
}

const MAX_DIFF_CHARS = 500_000

function capDiff(text: string): string {
  if (text.length <= MAX_DIFF_CHARS) return text
  const slice = text.slice(0, MAX_DIFF_CHARS)
  const lastNl = slice.lastIndexOf("\n")
  const head = lastNl > 0 ? slice.slice(0, lastNl) : slice
  return `${head}\n# … diff kırpıldı (${Math.round(MAX_DIFF_CHARS / 1000)}K karakter sınırı aşıldı)`
}

export async function gitDiffFile(
  workspace: string,
  path: string,
  staged = false,
): Promise<string> {
  const args = staged
    ? ["diff", "--staged", "--no-color", "--", path]
    : ["diff", "--no-color", "--", path]
  try {
    const out = await exec(workspace, args)
    return capDiff(out)
  } catch (e) {
    const msg = errorMessage(e)
    return `# git diff hata: ${msg}`
  }
}

export function statusLabel(e: GitStatusEntry): {
  code: string
  label: string
  kind: "add" | "mod" | "del" | "ren" | "untracked" | "ignored" | "conflict"
} {
  const x = e.index
  const y = e.worktree
  if (x === "?" && y === "?") return { code: "??", label: "yeni", kind: "untracked" }
  if (x === "!" && y === "!") return { code: "!!", label: "yoksay", kind: "ignored" }
  if (x === "U" || y === "U" || (x === "A" && y === "A") || (x === "D" && y === "D")) {
    return { code: x + y, label: "çakışma", kind: "conflict" }
  }
  if (e.oldPath) return { code: "R ", label: "yeniden adlandır", kind: "ren" }
  if (x === "A" || y === "A") return { code: "A ", label: "eklendi", kind: "add" }
  if (x === "D" || y === "D") return { code: "D ", label: "silindi", kind: "del" }
  if (x === "M" || y === "M") return { code: "M ", label: "değişti", kind: "mod" }
  return { code: x + y, label: "değişti", kind: "mod" }
}

export type GitFileStat = {
  file: string
  additions: number
  deletions: number
}

export async function gitHasHead(workspace: string): Promise<boolean> {
  if (!workspace) return false
  try {
    const r = await runProgram("git", [...GIT_FLAGS, "rev-parse", "--verify", "HEAD"], {
      cwd: workspace,
    })
    return r.code === 0
  } catch {
    return false
  }
}

export async function gitMergeBase(
  workspace: string,
  base: string,
  head = "HEAD",
): Promise<string | null> {
  if (!workspace) return null
  try {
    const raw = await exec(workspace, ["merge-base", base, head])
    return raw.trim() || null
  } catch {
    return null
  }
}

export async function gitShow(
  workspace: string,
  ref: string,
  file: string,
): Promise<string> {
  if (!workspace) return ""
  try {
    return await exec(workspace, ["show", `${ref}:${file}`])
  } catch {
    return ""
  }
}

export async function gitDiffStats(
  workspace: string,
  ref: string,
): Promise<GitFileStat[]> {
  if (!workspace) return []
  try {
    const raw = await exec(workspace, ["diff", "--no-ext-diff", "--no-renames", "--numstat", ref, "--", "."])
    return raw
      .split("\n")
      .filter(Boolean)
      .flatMap((line) => {
        const parts = line.split("\t")
        if (parts.length < 3) return []
        const file = parts[2]
        if (!file) return []
        const adds = parts[0] === "-" ? 0 : parseInt(parts[0] || "0", 10)
        const dels = parts[1] === "-" ? 0 : parseInt(parts[1] || "0", 10)
        return [{
          file,
          additions: Number.isFinite(adds) ? adds : 0,
          deletions: Number.isFinite(dels) ? dels : 0,
        }]
      })
  } catch {
    return []
  }
}

export async function gitDefaultBranch(workspace: string): Promise<string | null> {
  if (!workspace) return null
  try {
    const raw = await exec(workspace, ["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"])
    const name = raw.trim().replace(/^origin\//, "")
    if (name) return name
  } catch {
    // Intentionally ignored.
  }
  for (const cand of ["main", "master"]) {
    try {
      const out = await exec(workspace, ["rev-parse", "--verify", "--quiet", `refs/heads/${cand}`])
      if (out.trim()) return cand
    } catch {
      // Intentionally ignored.
    }
  }
  return null
}

export async function gitRemoteUrl(workspace: string, remote = "origin"): Promise<string | null> {
  if (!workspace) return null
  try {
    const out = await exec(workspace, ["remote", "get-url", remote])
    return out.trim() || null
  } catch {
    return null
  }
}

export type GitBranchChange = {
  file: string
  status: "added" | "modified" | "deleted"
  additions: number
  deletions: number
}

export type GitBranchDiff = {
  defaultBranch: string | null
  base: string | null
  current: string | null
  onDefault: boolean
  files: GitBranchChange[]
}

export async function gitBranchDiff(workspace: string): Promise<GitBranchDiff> {
  const empty: GitBranchDiff = {
    defaultBranch: null,
    base: null,
    current: null,
    onDefault: false,
    files: [],
  }
  if (!workspace) return empty

  const [def, current, hasHead] = await Promise.all([
    gitDefaultBranch(workspace),
    gitCurrentBranch(workspace),
    gitHasHead(workspace),
  ])
  if (!def || !hasHead) return { ...empty, defaultBranch: def, current }
  if (current && current === def) {
    return { defaultBranch: def, base: null, current, onDefault: true, files: [] }
  }

  const base = await gitMergeBase(workspace, def, "HEAD")
  if (!base) return { ...empty, defaultBranch: def, current }

  const nameStatus = await exec(
    workspace,
    ["diff", "--no-color", "--no-renames", "--name-status", base, "--", "."],
  ).catch(() => "")
  const statMap = new Map(
    (await gitDiffStats(workspace, base)).map((s) => [s.file, s]),
  )

  const files: GitBranchChange[] = []
  for (const line of nameStatus.split("\n")) {
    if (!line.trim()) continue
    const tab = line.indexOf("\t")
    if (tab === -1) continue
    const code = line[0] ?? ""
    const file = line.slice(tab + 1).trim()
    if (!file) continue
    const status = code === "A" ? "added" : code === "D" ? "deleted" : "modified"
    const stat = statMap.get(file)
    files.push({
      file,
      status,
      additions: stat?.additions ?? 0,
      deletions: stat?.deletions ?? 0,
    })
  }
  files.sort((a, b) => a.file.localeCompare(b.file))
  return { defaultBranch: def, base, current, onDefault: false, files }
}

export async function gitDiffFileRef(
  workspace: string,
  ref: string,
  path: string,
): Promise<string> {
  try {
    const out = await exec(workspace, ["diff", "--no-color", ref, "--", path])
    return capDiff(out)
  } catch (e) {
    const msg = errorMessage(e)
    return `# git diff hata: ${msg}`
  }
}

export async function gitDiffUntracked(workspace: string, path: string): Promise<string> {
  if (path.endsWith("/")) return ""
  try {
    const out = await exec(workspace, ["diff", "--no-index", "--no-color", "--", "/dev/null", path])
    return capDiff(out)
  } catch (e) {
    return `# git diff hata: ${errorMessage(e)}`
  }
}

export async function gitShowCommit(workspace: string, hash: string): Promise<string> {
  try {
    const out = await exec(workspace, ["show", "--no-color", hash])
    return capDiff(out)
  } catch (e) {
    return `# git show hata: ${errorMessage(e)}`
  }
}


export async function gitStage(workspace: string, paths: string[]): Promise<void> {
  if (paths.length === 0) return
  await mutate(workspace, ["add", "--", ...paths])
}

export async function gitUnstage(workspace: string, paths: string[]): Promise<void> {
  if (paths.length === 0) return
  const hasHead = await gitHasHead(workspace)
  const args = hasHead
    ? ["reset", "-q", "HEAD", "--", ...paths]
    : ["rm", "-q", "--cached", "--", ...paths]
  await mutate(workspace, args)
}

export async function gitDiscard(
  workspace: string,
  path: string,
  opts: { untracked?: boolean } = {},
): Promise<void> {
  if (opts.untracked) {
    await mutate(workspace, ["clean", "-fdq", "--", path])
    return
  }
  const hasHead = await gitHasHead(workspace)
  const args = hasHead
    ? ["checkout", "-q", "HEAD", "--", path]
    : ["rm", "-q", "--cached", "--", path]
  await mutate(workspace, args)
}

export async function gitStageAll(workspace: string): Promise<void> {
  await mutate(workspace, ["add", "-A"])
}

export async function gitUnstageAll(workspace: string): Promise<void> {
  const hasHead = await gitHasHead(workspace)
  const args = hasHead ? ["reset", "-q", "HEAD"] : ["rm", "-rq", "--cached", "."]
  await mutate(workspace, args)
}

export async function gitDiscardAll(workspace: string): Promise<void> {
  const hasHead = await gitHasHead(workspace)
  if (!hasHead) {
    await gitUnstageAll(workspace)
    return
  }
  await mutate(workspace, ["checkout", "-q", "HEAD", "--", "."])
}

export async function gitCommit(
  workspace: string,
  message: string,
  opts: { amend?: boolean } = {},
): Promise<string> {
  const msg = message.trim()
  const args = ["commit"]
  if (opts.amend && !msg) {
    args.push("--amend", "--no-edit")
  } else {
    if (!msg) throw new Error("commit mesajı boş")
    args.push("-m", msg)
    if (opts.amend) args.push("--amend")
  }
  return mutate(workspace, args)
}

export async function gitFetch(workspace: string): Promise<string> {
  return mutate(workspace, ["fetch"])
}

export async function gitPull(workspace: string): Promise<string> {
  return mutate(workspace, ["pull"])
}

export async function gitPush(workspace: string): Promise<string> {
  return mutate(workspace, ["push"])
}

export async function gitPublish(workspace: string): Promise<string> {
  return mutate(workspace, ["push", "-u", "origin", "HEAD"])
}

export type GitCommitEntry = {
  hash: string
  subject: string
  author: string
  relDate: string
}

export async function gitLog(workspace: string, limit = 30): Promise<GitCommitEntry[]> {
  if (!workspace) return []
  try {
    const raw = await exec(workspace, [
      "log",
      `--pretty=%H%x1f%s%x1f%an%x1f%ar`,
      "-n",
      String(limit),
    ])
    return raw
      .split("\n")
      .filter(Boolean)
      .flatMap((line) => {
        const [hash, subject, author, relDate] = line.split("\x1f")
        if (!hash) return []
        return [{ hash, subject: subject ?? "", author: author ?? "", relDate: relDate ?? "" }]
      })
  } catch {
    return []
  }
}

export type GitStashEntry = {
  index: number
  label: string
}

export async function gitStashSave(workspace: string, message?: string): Promise<string> {
  const args = ["stash", "push"]
  if (message && message.trim()) args.push("-m", message.trim())
  return mutate(workspace, args)
}

// Stash listesi.
export async function gitStashList(workspace: string): Promise<GitStashEntry[]> {
  if (!workspace) return []
  try {
    const raw = await exec(workspace, ["stash", "list", "--pretty=%gd%x1f%s"])
    return raw
      .split("\n")
      .filter(Boolean)
      .flatMap((line, i) => {
        const [ref, subject] = line.split("\x1f")
        const m = ref?.match(/stash@\{(\d+)\}/)
        const index = m ? parseInt(m[1], 10) : i
        return [{ index, label: subject ?? ref ?? `stash@{${index}}` }]
      })
  } catch {
    return []
  }
}

export async function gitStashPop(workspace: string, index: number): Promise<string> {
  if (!Number.isInteger(index) || index < 0) throw new Error("geçersiz stash index")
  return mutate(workspace, ["stash", "pop", `stash@{${index}}`])
}

export async function gitDiffStaged(workspace: string): Promise<string> {
  if (!workspace) return ""
  try {
    const out = await exec(workspace, ["diff", "--staged", "--no-color"])
    return capDiff(out)
  } catch {
    return ""
  }
}

export async function gitDiffAll(workspace: string): Promise<string> {
  if (!workspace) return ""
  if (!(await gitHasHead(workspace))) return ""
  try {
    const out = await exec(workspace, ["diff", "HEAD", "--no-color"])
    return capDiff(out)
  } catch {
    return ""
  }
}
