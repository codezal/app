// Code Map indexer — walks the workspace, extracts symbols and call edges,
// writes a single JSON index to <workspace>/.codezal/code-map.json.
//
// Filtering and walking reuse the same allow/ignore rules as the semantic
// index (forward-compat: the two could share a util if more callers appear).

import {
  exists,
  mkdir,
  readDir,
  readTextFile,
  writeTextFile,
} from "@tauri-apps/plugin-fs"
import { CODE_MAP_REL, type CodeMap, type CodeSymbol, type CallEdge } from "./schema"
import { extToLang, parseSource } from "./parsers/regex"

const INCLUDE_EXT = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mts",
  ".mjs",
  ".cjs",
  ".py",
  ".rs",
  ".go",
  ".java",
])

const IGNORE_DIRS = new Set([
  ".git",
  ".svn",
  ".hg",
  "node_modules",
  "dist",
  "build",
  "out",
  "target",
  ".next",
  ".nuxt",
  ".vite",
  ".cache",
  "__pycache__",
  ".venv",
  "venv",
  ".codezal",
  ".idea",
  ".vscode",
  "coverage",
])

const MAX_FILE_BYTES = 250_000

export type BuildProgress = {
  total: number
  done: number
  currentFile: string
  symbolsSoFar: number
}

export type BuildOptions = {
  workspace: string
  onProgress?: (p: BuildProgress) => void
}

function indexPath(workspace: string): string {
  return `${workspace.replace(/[\\/]+$/, "")}/${CODE_MAP_REL}`
}

function shouldIndex(name: string): boolean {
  const dot = name.lastIndexOf(".")
  if (dot === -1) return false
  return INCLUDE_EXT.has(name.slice(dot).toLowerCase())
}

async function collectFiles(workspace: string, rel = ""): Promise<string[]> {
  const ws = workspace.replace(/[\\/]+$/, "")
  const abs = rel ? `${ws}/${rel}` : ws
  let entries
  try {
    entries = await readDir(abs)
  } catch {
    return []
  }
  const out: string[] = []
  for (const e of entries) {
    if (IGNORE_DIRS.has(e.name)) continue
    if (e.name.startsWith(".") && e.isDirectory) continue
    const childRel = rel ? `${rel}/${e.name}` : e.name
    if (e.isDirectory) {
      out.push(...(await collectFiles(workspace, childRel)))
    } else if (shouldIndex(e.name)) {
      out.push(childRel)
    }
  }
  return out
}

export async function buildCodeMap({ workspace, onProgress }: BuildOptions): Promise<CodeMap> {
  if (!workspace) throw new Error("Code Map: workspace not set")
  const files = await collectFiles(workspace)

  const symbols: CodeSymbol[] = []
  type FileResult = {
    ownerByLine: string[]
    calls: Array<{ name: string; line: number }>
  }
  const perFile: Array<{ file: string } & FileResult> = []

  for (let i = 0; i < files.length; i++) {
    const rel = files[i]!
    const abs = `${workspace.replace(/[\\/]+$/, "")}/${rel}`
    let text: string
    try {
      text = await readTextFile(abs)
    } catch {
      onProgress?.({ total: files.length, done: i + 1, currentFile: rel, symbolsSoFar: symbols.length })
      continue
    }
    if (text.length > MAX_FILE_BYTES) {
      onProgress?.({ total: files.length, done: i + 1, currentFile: rel, symbolsSoFar: symbols.length })
      continue
    }
    const dot = rel.lastIndexOf(".")
    const lang = dot === -1 ? null : extToLang(rel.slice(dot))
    if (!lang) {
      onProgress?.({ total: files.length, done: i + 1, currentFile: rel, symbolsSoFar: symbols.length })
      continue
    }
    const parsed = parseSource(rel, text, lang)
    symbols.push(...parsed.symbols)
    perFile.push({ file: rel, ownerByLine: parsed.ownerByLine, calls: parsed.rawCalls })

    onProgress?.({
      total: files.length,
      done: i + 1,
      currentFile: rel,
      symbolsSoFar: symbols.length,
    })

    // Yield to the event loop every batch so the UI stays responsive.
    if (i % 25 === 24) await sleep(0)
  }

  // Build name → ids map.
  const byName: Record<string, string[]> = {}
  for (const s of symbols) {
    const k = s.name.toLowerCase()
    if (!byName[k]) byName[k] = []
    byName[k].push(s.id)
  }

  // Resolve calls into edges. Each call's owner (the symbol that wraps the
  // call's line) is the edge's "from"; targets are all symbols matching the
  // called name (any file). Self-loops dropped.
  const edges: CallEdge[] = []
  const seen = new Set<string>()
  for (const fr of perFile) {
    for (const call of fr.calls) {
      const fromId = fr.ownerByLine[call.line]
      if (!fromId) continue
      const targets = byName[call.name.toLowerCase()]
      if (!targets) continue
      for (const toId of targets) {
        if (toId === fromId) continue
        const key = `${fromId}|${toId}`
        if (seen.has(key)) continue
        seen.add(key)
        edges.push({ from: fromId, to: toId })
      }
    }
  }

  const map: CodeMap = {
    version: 1,
    builtAt: Date.now(),
    symbols,
    edges,
    byName,
  }

  await ensureDir(`${workspace.replace(/[\\/]+$/, "")}/.codezal`)
  await writeTextFile(indexPath(workspace), JSON.stringify(map))
  return map
}

export async function loadCodeMap(workspace: string): Promise<CodeMap | null> {
  if (!workspace) return null
  const p = indexPath(workspace)
  if (!(await exists(p))) return null
  try {
    const raw = await readTextFile(p)
    const parsed = JSON.parse(raw) as CodeMap
    if (parsed.version !== 1) return null
    return parsed
  } catch {
    return null
  }
}

async function ensureDir(p: string): Promise<void> {
  if (!(await exists(p))) await mkdir(p, { recursive: true })
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}
