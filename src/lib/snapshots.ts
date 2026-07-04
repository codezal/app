//
import { appDataDir } from "@tauri-apps/api/path"
import { mkdir, readTextFile, remove, stat, writeTextFile } from "@tauri-apps/plugin-fs"
import { runProgram, resolveProgram } from "@/lib/exec"
import { errorMessage } from "@/lib/errors"

const MAX_SNAPSHOT_FILE = 2 * 1024 * 1024

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

const ready = new Set<string>()
const excluded = new Map<string, Set<string>>()
const locks = new Map<string, Promise<unknown>>()
let gitOk: boolean | null = null

async function gitdirFor(sessionId: string): Promise<string> {
  const base = (await appDataDir()).replace(/[/\\]$/, "")
  return `${base}/snapshots-git/${sessionId}`
}

type GitOut = { code: number; stdout: string; stderr: string }

async function sh(gitdir: string, worktree: string, args: string[]): Promise<GitOut> {
  try {
    return await runProgram(
      "git",
      ["--git-dir", gitdir, "--work-tree", worktree, ...GIT_FLAGS, ...args],
      { cwd: worktree },
    )
  } catch (e) {
    return { code: 1, stdout: "", stderr: errorMessage(e) }
  }
}

async function enabled(): Promise<boolean> {
  if (gitOk !== null) return gitOk
  gitOk = (await resolveProgram("git")) !== null
  return gitOk
}

async function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = locks.get(key) ?? Promise.resolve()
  const next = prev.then(fn, fn)
  locks.set(
    key,
    next.then(
      () => undefined,
      () => undefined,
    ),
  )
  return next
}

async function ensureRepo(gitdir: string, worktree: string): Promise<void> {
  if (ready.has(gitdir)) return
  await mkdir(gitdir, { recursive: true }).catch(() => {})
  await sh(gitdir, worktree, ["init", "-q"])
  await runProgram("git", ["--git-dir", gitdir, "config", "core.autocrlf", "false"])
  await runProgram("git", ["--git-dir", gitdir, "config", "core.longpaths", "true"])
  await runProgram("git", ["--git-dir", gitdir, "config", "core.symlinks", "true"])
  await runProgram("git", ["--git-dir", gitdir, "config", "core.fsmonitor", "false"])
  const patterns = ["node_modules/", "dist/", "build/", "target/", ".next/", ".venv/", "__pycache__/", ".git/"]
  await mkdir(`${gitdir}/info`, { recursive: true }).catch(() => {})
  await writeTextFile(`${gitdir}/info/exclude`, patterns.join("\n") + "\n").catch(() => {})
  ready.add(gitdir)
}

async function appendExclude(gitdir: string, files: string[]): Promise<void> {
  const set = excluded.get(gitdir) ?? new Set<string>()
  const fresh = files.filter((f) => !set.has(f))
  if (!fresh.length) return
  for (const f of fresh) set.add(f)
  excluded.set(gitdir, set)
  const target = `${gitdir}/info/exclude`
  const prev = await readTextFile(target).catch(() => "")
  const lines = fresh.map((f) => `/${f.replace(/\\/g, "/")}`).join("\n")
  await writeTextFile(target, prev.replace(/\n?$/, "\n") + lines + "\n").catch(() => {})
}

async function stageWorkspace(gitdir: string, worktree: string): Promise<GitOut> {
  const ls = await sh(gitdir, worktree, ["ls-files", "-o", "-m", "--exclude-standard", "-z"])
  if (ls.code === 0) {
    const files = ls.stdout.split("\0").filter(Boolean)
    const root = worktree.replace(/[/\\]$/, "")
    const big: string[] = []
    for (const f of files) {
      try {
        const info = await stat(`${root}/${f}`)
        if (info.isFile && info.size > MAX_SNAPSHOT_FILE) big.push(f)
      } catch {
        // Intentionally ignored.
      }
    }
    if (big.length) {
      await appendExclude(gitdir, big)
      await sh(gitdir, worktree, ["rm", "--cached", "-f", "--ignore-unmatch", "--", ...big])
    }
  }
  return sh(gitdir, worktree, ["add", "--all"])
}

export async function checkpoint(sessionId: string, worktree: string): Promise<string | undefined> {
  if (!worktree) return undefined
  if (!(await enabled())) return undefined
  const gitdir = await gitdirFor(sessionId)
  return withLock(gitdir, async () => {
    await ensureRepo(gitdir, worktree)
    const add = await stageWorkspace(gitdir, worktree)
    if (add.code !== 0) {
      console.warn("[snapshot] add başarısız:", add.stderr)
      return undefined
    }
    const tree = await sh(gitdir, worktree, ["write-tree"])
    const hash = tree.stdout.trim()
    if (tree.code !== 0 || !hash) {
      console.warn("[snapshot] write-tree başarısız:", tree.stderr)
      return undefined
    }
    return hash
  })
}

export async function revertToBase(
  sessionId: string,
  worktree: string,
  base: string,
): Promise<{ restored: number; deleted: number }> {
  if (!worktree || !base) return { restored: 0, deleted: 0 }
  if (!(await enabled())) return { restored: 0, deleted: 0 }
  const gitdir = await gitdirFor(sessionId)
  return withLock(gitdir, async () => {
    await ensureRepo(gitdir, worktree)
    await stageWorkspace(gitdir, worktree)
    const diff = await sh(gitdir, worktree, ["diff", "--cached", "--name-only", "-z", base, "--"])
    if (diff.code !== 0) {
      console.warn("[snapshot] revert diff başarısız:", diff.stderr)
      return { restored: 0, deleted: 0 }
    }
    const files = diff.stdout.split("\0").filter(Boolean)
    let restored = 0
    let deleted = 0
    for (const file of files) {
      const co = await sh(gitdir, worktree, ["checkout", base, "--", file])
      if (co.code === 0) {
        restored++
        continue
      }
      const tree = await sh(gitdir, worktree, ["ls-tree", base, "--", file])
      if (tree.code === 0 && tree.stdout.trim()) {
        console.warn("[snapshot] checkout başarısız, dosya korunuyor:", file)
        continue
      }
      // base'de yoktu (sonradan eklendi) — sil.
      await remove(`${worktree.replace(/[/\\]$/, "")}/${file}`).catch(() => {})
      deleted++
    }
    return { restored, deleted }
  })
}

export async function revertFileToBase(
  sessionId: string,
  worktree: string,
  base: string,
  path: string,
): Promise<boolean> {
  if (!worktree || !base || !path) return false
  if (!(await enabled())) return false
  const gitdir = await gitdirFor(sessionId)
  return withLock(gitdir, async () => {
    await ensureRepo(gitdir, worktree)
    const co = await sh(gitdir, worktree, ["checkout", base, "--", path])
    if (co.code === 0) return true
    const tree = await sh(gitdir, worktree, ["ls-tree", base, "--", path])
    if (tree.code === 0 && tree.stdout.trim()) {
      console.warn("[snapshot] tek-dosya checkout başarısız, korunuyor:", path)
      return false
    }
    // base'de yoktu → turda eklendi → sil.
    await remove(`${worktree.replace(/[/\\]$/, "")}/${path}`).catch(() => {})
    return true
  })
}

export async function fileAtBase(
  sessionId: string,
  worktree: string,
  base: string,
  path: string,
): Promise<string | null> {
  if (!worktree || !base || !path) return null
  if (!(await enabled())) return null
  const gitdir = await gitdirFor(sessionId)
  return withLock(gitdir, async () => {
    await ensureRepo(gitdir, worktree)
    const r = await sh(gitdir, worktree, ["show", `${base}:${path}`])
    return r.code === 0 ? r.stdout : null
  })
}

export async function clearSession(sessionId: string): Promise<void> {
  const gitdir = await gitdirFor(sessionId)
  ready.delete(gitdir)
  excluded.delete(gitdir)
  await remove(gitdir, { recursive: true }).catch(() => {})
}
