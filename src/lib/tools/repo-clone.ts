// clone_repo — agent konuşmadan git deposu klonlar.
// Bash + git clone, hedef workspace klasörü, sonra session.workspacePath'i bağla.
import { Command } from "@tauri-apps/plugin-shell"
import { homeDir } from "@tauri-apps/api/path"
import { exists } from "@tauri-apps/plugin-fs"

export type CloneResult = {
  path: string
  repoName: string
  branch?: string
  stdout: string
}

// URL'den repo adı çıkar. Desteklenen formatlar:
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
  // Path-safe karakter filtresi
  if (!/^[a-zA-Z0-9._-]+$/.test(name)) {
    throw new Error(`Geçersiz repo adı: ${name}`)
  }
  return name
}

function shellQuote(s: string): string {
  return "'" + s.replace(/'/g, `'\\''`) + "'"
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

  // Hedef path: kullanıcı verdiyse onu kullan, aksi takdirde ~/Documents/<repoName>
  let target = opts.target
  if (!target) {
    const home = await homeDir()
    // homeDir trailing slash bazı platformda var, normalize et
    const normHome = home.replace(/\/+$/, "")
    target = `${normHome}/Documents/${repoName}`
  }

  // Hedef varsa iptal — yanlışlıkla üstüne yazma
  if (await exists(target)) {
    throw new Error(`Hedef klasör zaten var: ${target} — farklı 'target' parametresi ver veya elle sil`)
  }

  // git clone komutu kur
  const flags: string[] = []
  if (branch) flags.push(`--branch ${shellQuote(branch)}`)
  if (depth && depth > 0) flags.push(`--depth ${depth}`)
  const cmd = `git clone ${flags.join(" ")} ${shellQuote(url)} ${shellQuote(target)}`

  // 5 dakika timeout — büyük repolar için
  const wrapped = `timeout 300 ${cmd}`
  const result = await Command.create("bash", ["-lc", wrapped]).execute()

  if (result.code !== 0) {
    throw new Error(
      `git clone başarısız (exit ${result.code}):\n${result.stderr.trim() || result.stdout.trim()}`,
    )
  }

  // Aktif branch'i öğren
  let activeBranch: string | undefined
  try {
    const br = await Command.create("bash", [
      "-lc",
      `cd ${shellQuote(target)} && git rev-parse --abbrev-ref HEAD`,
    ]).execute()
    if (br.code === 0) activeBranch = br.stdout.trim()
  } catch {
    // okunamazsa sessiz geç
  }

  return {
    path: target,
    repoName,
    branch: activeBranch,
    stdout: (result.stdout + "\n" + result.stderr).trim(),
  }
}
