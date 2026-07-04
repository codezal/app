import { homeDir } from "@tauri-apps/api/path"
import { exists } from "@tauri-apps/plugin-fs"
import { withLock } from "../lock"
import { runProgram } from "@/lib/exec"

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
  // .git eki at
  last = last.replace(/\.git\/?$/, "")
  // Son segment
  const idx = Math.max(last.lastIndexOf("/"), last.lastIndexOf(":"))
  const name = idx >= 0 ? last.slice(idx + 1) : last
  if (!name) throw new Error(`URL'den repo adı çıkarılamadı: ${url}`)
  if (name === "." || name === ".." || !/^[a-zA-Z0-9._-]+$/.test(name)) {
    throw new Error(`Geçersiz repo adı: ${name}`)
  }
  return name
}

function validateBranch(branch: string): void {
  if (!/^[A-Za-z0-9/_.-]+$/.test(branch) || branch.startsWith("-") || branch.includes("..")) {
    throw new Error(
      `Geçersiz branch adı: ${branch} — yalnızca harf/rakam/_/./- içerebilir, '-' ile başlayamaz, '..' içeremez`,
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
  if (!url) throw new Error("URL gerekli")
  if (!/^(https?:\/\/|git@|ssh:\/\/)/i.test(url)) {
    throw new Error("Desteklenmeyen URL şeması — https://, git@ veya ssh:// gerekir")
  }

  const repoName = parseRepoName(url)
  if (branch) validateBranch(branch)

  let target = opts.target
  if (!target) {
    const home = await homeDir()
    const normHome = home.replace(/[/\\]+$/, "")
    target = `${normHome}/Documents/${repoName}`
  }

  const dest = target
  return withLock(`repo-clone:${dest}`, async () => {
    if (await exists(dest)) {
      throw new Error(`Hedef klasör zaten var: ${dest} — farklı 'target' parametresi ver veya elle sil`)
    }

    const flags: string[] = []
    if (branch) flags.push("--branch", branch)
    if (depth && depth > 0) flags.push("--depth", String(depth))
    const result = await runProgram("git", ["clone", ...flags, url, dest], { timeoutMs: 300_000 })

    if (result.code !== 0) {
      throw new Error(
        `git clone başarısız (exit ${result.code}):\n${result.stderr.trim() || result.stdout.trim()}`,
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
