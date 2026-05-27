// Workspace text search — ripgrep varsa kullan, yoksa grep -RIn fallback.
import { Command } from "@tauri-apps/plugin-shell"

export type SearchHit = {
  path: string // absolute
  rel: string // workspace'a göre relative
  line: number
  text: string
}

const MAX_HITS = 300

export type SearchOpts = {
  caseSensitive?: boolean
  regex?: boolean
  glob?: string // örn "*.ts"
}

export async function searchWorkspace(
  workspace: string,
  query: string,
  opts: SearchOpts = {},
): Promise<SearchHit[]> {
  if (!workspace || !query.trim()) return []

  // ripgrep'i dene
  const hasRg = await which("rg")
  const cmd = hasRg
    ? buildRgCommand(workspace, query, opts)
    : buildGrepCommand(workspace, query, opts)
  const out = await Command.create("bash", ["-lc", cmd]).execute()
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
    hits.push({
      path: abs,
      rel,
      line: parseInt(m[2], 10),
      text: m[3].slice(0, 200),
    })
    if (hits.length >= MAX_HITS) break
  }
  return hits
}

async function which(bin: string): Promise<boolean> {
  try {
    const out = await Command.create("bash", ["-lc", `command -v ${bin}`]).execute()
    return out.code === 0 && !!out.stdout.trim()
  } catch {
    return false
  }
}

function shellQuote(s: string): string {
  return "'" + s.replace(/'/g, `'\\''`) + "'"
}

function buildRgCommand(workspace: string, query: string, opts: SearchOpts): string {
  const flags: string[] = ["-n", "--no-heading", "-S", "--max-count=20"]
  if (opts.caseSensitive) flags.push("-s")
  if (!opts.regex) flags.push("-F") // fixed string
  if (opts.glob) flags.push("-g", shellQuote(opts.glob))
  flags.push("--", shellQuote(query), shellQuote(workspace))
  return `rg ${flags.join(" ")} || true`
}

function buildGrepCommand(workspace: string, query: string, opts: SearchOpts): string {
  // grep -RIn workspace ile; binary atla; ortak gürültü dizinlerini hariç tut
  const flags: string[] = ["-RIn"]
  if (!opts.caseSensitive) flags.push("-i")
  if (!opts.regex) flags.push("-F")
  flags.push(
    "--exclude-dir=node_modules",
    "--exclude-dir=.git",
    "--exclude-dir=dist",
    "--exclude-dir=build",
    "--exclude-dir=target",
    "--exclude-dir=.next",
    "--exclude-dir=__pycache__",
  )
  flags.push("--", shellQuote(query), shellQuote(workspace))
  return `grep ${flags.join(" ")} || true`
}
