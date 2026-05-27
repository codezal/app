// Git wrapper — workspace cwd üzerinde `git` çağır, çıktıyı parse et.
// Tauri shell plugin bash whitelist'i üzerinden çalışır.
import { Command } from "@tauri-apps/plugin-shell"

export type GitStatusEntry = {
  // İki harfli porcelain XY kodu (örn "M ", " M", "??")
  index: string
  worktree: string
  path: string
  // Eski isim (rename için)
  oldPath?: string
}

export type GitInfo = {
  branch: string | null
  ahead: number
  behind: number
  upstream: string | null
  // Çalışma kopyası temiz mi
  clean: boolean
}

export type GitStatus = {
  info: GitInfo
  entries: GitStatusEntry[]
  isRepo: boolean
}

async function exec(workspace: string, gitArgs: string): Promise<string> {
  const wrapped = `cd ${shellQuote(workspace)} && git ${gitArgs}`
  const out = await Command.create("bash", ["-lc", wrapped]).execute()
  if (out.code !== 0 && !out.stdout) {
    throw new Error(out.stderr.trim() || `git exit ${out.code}`)
  }
  return out.stdout
}

function shellQuote(s: string): string {
  return "'" + s.replace(/'/g, `'\\''`) + "'"
}

// `git status --porcelain=v2 --branch` çıktısını parse et.
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
    raw = await exec(workspace, "status --porcelain=v2 --branch")
  } catch (e) {
    // Repo değil veya git yok
    const msg = e instanceof Error ? e.message : String(e)
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
      // Örn: "# branch.ab +2 -0"
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
      const indexChar = xy[0] ?? " "
      const worktreeChar = xy[1] ?? " "
      // 2'li tipte son alan tab ile bölünür: "new\told"
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
      // Path = 9. alandan sonrası (boşluklu yol olabilir)
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

// Git ref adı için güvenli karakter seti — shellQuote yeterli olsa da
// defense-in-depth: shell metakarakter / kontrol karakteri / git'in reddettiği
// formları erkenden engelle.
function assertSafeBranchName(name: string): void {
  if (!name) throw new Error("branch boş")
  if (name.length > 200) throw new Error("branch adı çok uzun")
  // İzinli: harf, rakam, - _ . /  (slash slash veya başında/sonunda yasak)
  if (!/^[A-Za-z0-9._/-]+$/.test(name)) {
    throw new Error("branch adı geçersiz karakter içeriyor")
  }
  if (name.startsWith("/") || name.endsWith("/") || name.includes("//")) {
    throw new Error("branch adı geçersiz")
  }
  if (name.startsWith(".") || name.endsWith(".lock") || name.includes("..")) {
    throw new Error("branch adı geçersiz")
  }
  if (name === "HEAD" || name === "@") {
    throw new Error("branch adı rezerve")
  }
}

// Local branch listesi (refname:short). Mevcut branch en başta.
export async function gitListBranches(workspace: string): Promise<string[]> {
  if (!workspace) return []
  try {
    // Parens'i tek tırnağa al — bash'te `(` subshell tetikler, çıplak format syntax error verir.
    const raw = await exec(workspace, "for-each-ref --format='%(refname:short)' refs/heads/")
    return raw
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean)
  } catch {
    return []
  }
}

// Mevcut branch adı (detached HEAD ise null).
export async function gitCurrentBranch(workspace: string): Promise<string | null> {
  if (!workspace) return null
  try {
    const raw = await exec(workspace, "rev-parse --abbrev-ref HEAD")
    const name = raw.trim()
    if (!name || name === "HEAD") return null
    return name
  } catch {
    return null
  }
}

// Branch'e geç. Hata varsa stderr mesajıyla throw eder (örn: uncommitted changes).
export async function gitCheckoutBranch(
  workspace: string,
  branch: string,
): Promise<void> {
  if (!workspace) throw new Error("workspace yok")
  assertSafeBranchName(branch)
  const wrapped = `cd ${shellQuote(workspace)} && git checkout ${shellQuote(branch)}`
  const out = await Command.create("bash", ["-lc", wrapped]).execute()
  if (out.code !== 0) {
    throw new Error(out.stderr.trim() || `git checkout exit ${out.code}`)
  }
}

// Yeni branch oluştur ve geç. start ref verilmezse HEAD'den.
export async function gitCreateBranch(
  workspace: string,
  branch: string,
  startRef?: string,
): Promise<void> {
  if (!workspace) throw new Error("workspace yok")
  assertSafeBranchName(branch)
  if (startRef) assertSafeBranchName(startRef)
  const args = startRef
    ? `checkout -b ${shellQuote(branch)} ${shellQuote(startRef)}`
    : `checkout -b ${shellQuote(branch)}`
  const wrapped = `cd ${shellQuote(workspace)} && git ${args}`
  const out = await Command.create("bash", ["-lc", wrapped]).execute()
  if (out.code !== 0) {
    throw new Error(out.stderr.trim() || `git checkout -b exit ${out.code}`)
  }
}

// Bir dosyanın working tree diff'i (staged değilse). staged=true ile staged göster.
export async function gitDiffFile(
  workspace: string,
  path: string,
  staged = false,
): Promise<string> {
  const args = staged
    ? `diff --staged --no-color -- ${shellQuote(path)}`
    : `diff --no-color -- ${shellQuote(path)}`
  try {
    const out = await exec(workspace, args)
    return out
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return `# git diff hata: ${msg}`
  }
}

// XY porcelain kodlarını insan dostu etikete çevir.
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
