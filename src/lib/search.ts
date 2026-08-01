import { IGNORE_DIRS } from "./ignore"
import { resolveRg } from "./rg-download"
import { runProgram } from "@/lib/exec"
import { isAbsolutePath } from "./tools/paths"
import { isWindows } from "./platform"

export type SearchHit = {
  path: string // absolute
  rel: string
  line: number
  text: string
}

const MAX_HITS = 300

export type SearchOpts = {
  caseSensitive?: boolean
  regex?: boolean
  glob?: string
}

function dirOf(absPath: string): string | undefined {
  const i = Math.max(absPath.lastIndexOf("/"), absPath.lastIndexOf("\\"))
  return i > 0 ? absPath.slice(0, i) : undefined
}

// Workspace-relative form of an absolute path, normalised to forward slashes.
// Case-insensitive prefix strip on Windows (FS is case-insensitive there, and
// rg may echo a different casing than the workspace string we were handed).
function toRel(abs: string, root: string): string {
  const a = abs.replace(/\\/g, "/")
  const r = root.replace(/[\\/]+$/, "").replace(/\\/g, "/")
  if (isWindows()) {
    const al = a.toLowerCase()
    const rl = r.toLowerCase()
    if (al === rl) return ""
    if (al.startsWith(rl + "/")) return a.slice(r.length + 1)
    return a
  }
  if (a === r) return ""
  if (a.startsWith(r + "/")) return a.slice(r.length + 1)
  return a
}

export async function searchWorkspace(
  workspace: string,
  query: string,
  opts: SearchOpts = {},
): Promise<SearchHit[]> {
  if (!workspace || !query.trim()) return []

  const rgPath = await resolveRg()
  let out: { stdout: string }
  if (rgPath) {
    const flags: string[] = [
      "--no-config",
      "-n",
      "--no-heading",
      "-S",
      "--hidden",
      "--glob=!**/.git/**",
      "--sortr",
      "modified",
    ]
    if (opts.caseSensitive) flags.push("-s")
    if (!opts.regex) flags.push("-F") // fixed string
    if (opts.glob) flags.push("-g", opts.glob)
    // Search "." with cwd=workspace (not the absolute workspace path). ripgrep
    // matches globs containing "/" relative to the CWD, so passing an absolute
    // search root makes prefixed patterns like "src/**/*.ts" match nothing.
    // Mirrors globWorkspace below.
    flags.push("--", query, ".")
    const dir = dirOf(rgPath)
    out = await runProgram("rg", flags, {
      cwd: workspace,
      pathPrepend: dir ? [dir] : undefined,
    })
  } else {
    const flags: string[] = ["-RIn"]
    if (!opts.caseSensitive) flags.push("-i")
    if (!opts.regex) flags.push("-F")
    for (const d of IGNORE_DIRS) flags.push(`--exclude-dir=${d}`)
    flags.push("--", query, workspace)
    out = await runProgram("grep", flags)
  }

  const raw = out.stdout || ""
  const hits: SearchHit[] = []
  const root = workspace.replace(/[\\/]+$/, "")

  // rg/grep emit CRLF on Windows — split on both so the text carries no stray \r.
  for (const line of raw.split(/\r?\n/)) {
    if (!line) continue
    // Format: path:line:text — path may be a Windows drive path (D:\...) with a
    // colon of its own, so anchor on the :line: pair, not the first colon.
    const m = line.match(/^(.+?):(\d+):(.*)$/)
    if (!m) continue
    // rg searches "." so paths are prefixed with "./" (".\" on Windows) — strip
    // it so relative globs resolve to clean workspace-relative paths.
    const hitPath = m[1].replace(/^\.[\\/]/, "")
    const abs = isAbsolutePath(hitPath) ? hitPath : root + "/" + hitPath
    const rel = toRel(abs, root)
    const rawText = m[3]
    const text = rawText.length > 2000 ? rawText.slice(0, 2000) + "..." : rawText
    hits.push({
      path: abs,
      rel,
      line: parseInt(m[2], 10),
      text,
    })
    if (hits.length >= MAX_HITS) break
  }
  return hits
}

export async function globWorkspace(
  workspace: string,
  pattern: string,
): Promise<string[]> {
  if (!workspace || !pattern.trim()) return []

  const rgPath = await resolveRg()
  let out: { stdout: string }
  if (rgPath) {
    const dir = dirOf(rgPath)
    out = await runProgram(
      "rg",
      ["--no-config", "--files", "--glob=!**/.git/**", "--sortr", "modified", "-g", pattern, "."],
      {
      cwd: workspace,
      pathPrepend: dir ? [dir] : undefined,
    })
  } else {
    const base = pattern.includes("/") ? pattern.split("/").pop()! : pattern
    const flags: string[] = [workspace]
    flags.push("(")
    const ign = [...IGNORE_DIRS]
    ign.forEach((d, i) => {
      if (i > 0) flags.push("-o")
      flags.push("-name", d)
    })
    flags.push(")", "-prune", "-o", "-type", "f", "-name", base, "-print")
    out = await runProgram("find", flags)
  }

  const raw = out.stdout || ""
  const root = workspace.replace(/[\\/]+$/, "")
  const rels: string[] = []

  for (const line of raw.split(/\r?\n/)) {
    // rg searches "." so it prefixes paths with "./" (".\" on Windows) — strip it.
    const p = line.trim().replace(/^\.[\\/]/, "")
    if (!p) continue
    const abs = isAbsolutePath(p) ? p : root + "/" + p
    rels.push(toRel(abs, root))
    if (rels.length >= MAX_HITS) break
  }
  return rels
}
