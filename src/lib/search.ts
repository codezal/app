import { IGNORE_DIRS } from "./ignore"
import { resolveRg } from "./rg-download"
import { runProgram } from "@/lib/exec"

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
    flags.push("--", query, workspace)
    const dir = dirOf(rgPath)
    out = await runProgram("rg", flags, { pathPrepend: dir ? [dir] : undefined })
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

  for (const line of raw.split("\n")) {
    if (!line) continue
    // Format: path:line:text
    const m = line.match(/^(.+?):(\d+):(.*)$/)
    if (!m) continue
    const abs = m[1].startsWith("/") ? m[1] : root + "/" + m[1]
    const rel = abs.startsWith(root) ? abs.slice(root.length).replace(/^[\\/]+/, "") : abs
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

  for (const line of raw.split("\n")) {
    // rg searches "." so it prefixes paths with "./" — strip it before resolving.
    const p = line.trim().replace(/^\.\//, "")
    if (!p) continue
    const abs = p.startsWith("/") ? p : root + "/" + p
    const rel = abs.startsWith(root)
      ? abs.slice(root.length).replace(/^[\\/]+/, "")
      : abs
    rels.push(rel)
    if (rels.length >= MAX_HITS) break
  }
  return rels
}
