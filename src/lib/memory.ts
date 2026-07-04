// Reasonix mimarisinden ilham: project memory (workspace) > user memory (global) > builtin.
//
import { readTextFile, exists, readDir, stat } from "@tauri-apps/plugin-fs"
import { homeDir } from "@tauri-apps/api/path"
import { globWorkspace } from "./search"
import { tauriFetch } from "./providers/tauri-fetch"
import { expandImports, type ImportResolver } from "./memory-import"

export type MemoryFile = {
  path: string
  name: string
  scope: "project" | "global"
  content: string
  bytes: number
}

export type MemoryReadOptions = {
  maxFileBytes?: number
  cache?: boolean
}

const PROJECT_NAMES = ["CODEZAL.md", "CLAUDE.md", "AGENTS.md", "AGENT.md"]
// Rival agent rule files Codezal also reads in-place. The user doesn't have
// to migrate or copy anything — if .cursorrules or .windsurfrules exist at
// the workspace root, we pull them straight into the memory system prompt
// alongside CLAUDE.md / AGENTS.md.
const RIVAL_RULE_FILES = [
  ".cursorrules",
  ".windsurfrules",
  ".clinerules",
  ".aiderules",
  ".github/copilot-instructions.md",
]
// Rival agent rule DIRECTORIES — each .md / .mdc child is loaded as its own
// memory file (Cursor v2, Cline multi-file).
const RIVAL_RULE_DIRS = [".cursor/rules", ".clinerules"]
const MAX_FILE_BYTES = 32_000
const TOTAL_BUDGET_BYTES = 96_000 // toplam memory ~96K — fallback default
const READ_CONCURRENCY = 8
const FETCH_TIMEOUT_MS = 5_000 // remote URL instruction fetch timeout
const URL_CACHE_TTL_MS = 5 * 60_000


const _enc = new TextEncoder()
function byteLen(s: string): number {
  return _enc.encode(s).length
}

function truncateToBytes(s: string, maxBytes: number): string {
  const bytes = _enc.encode(s)
  if (bytes.length <= maxBytes) return s
  let out = new TextDecoder("utf-8").decode(bytes.slice(0, maxBytes))
  if (out.endsWith("�")) out = out.slice(0, -1)
  return out
}


function normalizeSlashes(p: string): string {
  return p.replace(/\\/g, "/")
}

function dirOf(p: string): string {
  const s = normalizeSlashes(p).replace(/\/+$/, "")
  const i = s.lastIndexOf("/")
  return i <= 0 ? s : s.slice(0, i)
}

function isAbsolute(p: string): boolean {
  return /^([a-zA-Z]:\/|\/)/.test(normalizeSlashes(p))
}

function resolveRel(baseDir: string, rel: string): string {
  const r = normalizeSlashes(rel)
  const combined = isAbsolute(r) ? r : normalizeSlashes(baseDir).replace(/\/+$/, "") + "/" + r
  const drive = combined.match(/^[a-zA-Z]:/)?.[0] ?? ""
  const absRoot = drive ? combined.slice(drive.length).startsWith("/") : combined.startsWith("/")
  const body = drive ? combined.slice(drive.length) : combined
  const stack: string[] = []
  for (const seg of body.split("/")) {
    if (seg === "" || seg === ".") continue
    if (seg === "..") {
      if (stack.length) stack.pop()
      continue
    }
    stack.push(seg)
  }
  return drive + (absRoot ? "/" : "") + stack.join("/")
}

function isInside(root: string, p: string): boolean {
  const r = normalizeSlashes(root).replace(/\/+$/, "")
  const x = normalizeSlashes(p)
  return x === r || x.startsWith(r + "/")
}


type CacheEntry = { content: string; mtimeMs: number | null }
const fileCache = new Map<string, CacheEntry>()
const urlCache = new Map<string, { at: number; text: string }>()

export function invalidateMemoryCache(path?: string): void {
  if (path) {
    fileCache.delete(normalizeSlashes(path))
  } else {
    fileCache.clear()
    urlCache.clear()
  }
}

async function statMtimeMs(p: string): Promise<number | null> {
  try {
    const s = await stat(p)
    return s.mtime ? s.mtime.getTime() : null
  } catch {
    return null
  }
}

async function safeExists(p: string): Promise<boolean> {
  try {
    return await exists(p)
  } catch {
    return false
  }
}

async function safeRead(p: string, useCache = false): Promise<string | null> {
  const key = normalizeSlashes(p)
  if (useCache) {
    const cached = fileCache.get(key)
    if (cached) {
      const m = await statMtimeMs(p)
      if (m === null || m === cached.mtimeMs) return cached.content
    }
  }
  try {
    const content = await readTextFile(p)
    if (useCache) fileCache.set(key, { content, mtimeMs: await statMtimeMs(p) })
    return content
  } catch {
    return null
  }
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const res: R[] = new Array(items.length)
  let i = 0
  async function worker() {
    while (i < items.length) {
      const idx = i++
      res[idx] = await fn(items[idx])
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) || 0 }, worker))
  return res
}

// ---- @import resolver kurucu ----------------------------------------------

function makeResolver(opts: {
  workspace?: string
  home: string | null
  cache: boolean
  bound: boolean
}): ImportResolver {
  return {
    resolve(importPath, baseDir) {
      let raw = importPath
      if (raw.startsWith("~")) {
        if (!opts.home) return null
        raw = opts.home.replace(/\/+$/, "") + raw.slice(1)
      }
      const abs = resolveRel(baseDir, raw)
      if (opts.bound && opts.workspace && !isInside(opts.workspace, abs)) return null
      return abs
    },
    read: (abs) => safeRead(abs, opts.cache),
    dirOf,
  }
}


function makeFile(
  path: string,
  name: string,
  scope: "project" | "global",
  raw: string,
  maxFileBytes: number,
): MemoryFile {
  const trimmed =
    byteLen(raw) > maxFileBytes
      ? truncateToBytes(raw, maxFileBytes) + `\n\n[... kesildi, toplam ${byteLen(raw)} byte]`
      : raw
  return {
    path,
    name,
    scope,
    content: trimmed,
    bytes: byteLen(trimmed),
  }
}

async function buildFile(
  path: string,
  name: string,
  scope: "project" | "global",
  raw: string,
  resolver: ImportResolver,
  maxFileBytes: number,
): Promise<MemoryFile> {
  const expanded = await expandImports(raw, dirOf(path), resolver)
  return makeFile(path, name, scope, expanded, maxFileBytes)
}

// ---- proje memory ----------------------------------------------------------

export async function readProjectMemory(
  workspace: string,
  opts: MemoryReadOptions = {},
): Promise<MemoryFile[]> {
  const maxFileBytes = opts.maxFileBytes ?? MAX_FILE_BYTES
  const cache = opts.cache ?? false
  const seen = new Set<string>()
  const candidates: { path: string; name: string }[] = []

  const add = (path: string, name: string) => {
    if (seen.has(path)) return
    seen.add(path)
    candidates.push({ path, name })
  }

  for (const name of PROJECT_NAMES) {
    const p = joinPath(workspace, name)
    if (await safeExists(p)) add(p, name)
  }

  for (const rel of RIVAL_RULE_FILES) {
    const p = joinPath(workspace, rel)
    if (await safeExists(p)) add(p, rel)
  }

  for (const dirRel of RIVAL_RULE_DIRS) {
    const dirAbs = joinPath(workspace, dirRel)
    if (!(await safeExists(dirAbs))) continue
    try {
      for (const e of await readDir(dirAbs)) {
        if (e.isDirectory) continue
        const lower = e.name.toLowerCase()
        if (!lower.endsWith(".md") && !lower.endsWith(".mdc")) continue
        add(joinPath(dirAbs, e.name), dirRel + "/" + e.name)
      }
    } catch {
      // Intentionally ignored.
    }
  }

  const projMemory = joinPath(workspace, ".codezal/memory.md")
  if (await safeExists(projMemory)) add(projMemory, ".codezal/memory.md")

  // .codezal/rules/*.md
  const rulesDir = joinPath(workspace, ".codezal/rules")
  if (await safeExists(rulesDir)) {
    try {
      for (const e of await readDir(rulesDir)) {
        if (!e.isDirectory && e.name.toLowerCase().endsWith(".md")) {
          add(joinPath(rulesDir, e.name), ".codezal/rules/" + e.name)
        }
      }
    } catch {
      // Intentionally ignored.
    }
  }

  const home = await safeHomeDir()
  const resolver = makeResolver({ workspace, home, cache, bound: true })
  const files = await mapLimit(candidates, READ_CONCURRENCY, async (c) => {
    const raw = await safeRead(c.path, cache)
    if (raw == null) return null
    return buildFile(c.path, c.name, "project", raw, resolver, maxFileBytes)
  })
  return files.filter((f): f is MemoryFile => f !== null)
}


// ~/.codezal/MEMORY.md ve ~/.codezal/rules/*.md
export async function readUserMemory(opts: MemoryReadOptions = {}): Promise<MemoryFile[]> {
  const maxFileBytes = opts.maxFileBytes ?? MAX_FILE_BYTES
  const cache = opts.cache ?? false
  const home = await safeHomeDir()
  if (!home) return []

  const root = joinPath(home, ".codezal")
  const candidates: { path: string; name: string }[] = []

  const memoryPath = joinPath(root, "MEMORY.md")
  if (await safeExists(memoryPath)) candidates.push({ path: memoryPath, name: "MEMORY.md" })

  const rulesDir = joinPath(root, "rules")
  if (await safeExists(rulesDir)) {
    try {
      for (const e of await readDir(rulesDir)) {
        if (!e.isDirectory && e.name.toLowerCase().endsWith(".md")) {
          candidates.push({ path: joinPath(rulesDir, e.name), name: "rules/" + e.name })
        }
      }
    } catch {
      // sessiz
    }
  }

  const resolver = makeResolver({ home, cache, bound: false })
  const files = await mapLimit(candidates, READ_CONCURRENCY, async (c) => {
    const raw = await safeRead(c.path, cache)
    if (raw == null) return null
    return buildFile(c.path, c.name, "global", raw, resolver, maxFileBytes)
  })
  return files.filter((f): f is MemoryFile => f !== null)
}

// ---- config instructions[] -------------------------------------------------

// - http(s):// → fetch (native HTTP, CORS-safe, 5s timeout) → global
//
export async function readConfiguredInstructions(
  workspace: string | undefined,
  instructions: string[] | undefined,
  opts: MemoryReadOptions = {},
): Promise<MemoryFile[]> {
  if (!instructions || instructions.length === 0) return []
  const maxFileBytes = opts.maxFileBytes ?? MAX_FILE_BYTES
  const cache = opts.cache ?? false
  const home = await safeHomeDir()
  const out: MemoryFile[] = []

  // URL'ler — paralel fetch.
  const urls = instructions.filter((s) => /^https?:\/\//i.test(s.trim()))
  const remote = await mapLimit(urls, 4, async (url) => {
    const text = await fetchText(url.trim(), FETCH_TIMEOUT_MS)
    if (text == null) return null
    return makeFile(url.trim(), url.trim(), "global", text, maxFileBytes)
  })
  for (const f of remote) if (f) out.push(f)

  // ~ / absolute dosyalar — global resolver.
  const globalResolver = makeResolver({ home, cache, bound: false })
  const localAbs = instructions.filter((s) => {
    const t = s.trim()
    return !/^https?:\/\//i.test(t) && (t.startsWith("~") || isAbsolute(t))
  })
  const absFiles = await mapLimit(localAbs, READ_CONCURRENCY, async (item) => {
    const t = item.trim()
    const abs = t.startsWith("~") && home ? home.replace(/\/+$/, "") + t.slice(1) : t
    const raw = await safeRead(abs, cache)
    if (raw == null) return null
    return buildFile(abs, t, "global", raw, globalResolver, maxFileBytes)
  })
  for (const f of absFiles) if (f) out.push(f)

  if (workspace) {
    const projResolver = makeResolver({ workspace, home, cache, bound: true })
    const globs = instructions.filter((s) => {
      const t = s.trim()
      return t && !/^https?:\/\//i.test(t) && !t.startsWith("~") && !isAbsolute(t)
    })
    for (const pattern of globs) {
      const matches = await globWorkspace(workspace, pattern).catch(() => [] as string[])
      const globFiles = await mapLimit(matches, READ_CONCURRENCY, async (rel) => {
        const abs = isAbsolute(rel) ? rel : joinPath(workspace, rel)
        const raw = await safeRead(abs, cache)
        if (raw == null) return null
        return buildFile(abs, rel, "project", raw, projResolver, maxFileBytes)
      })
      for (const f of globFiles) if (f) out.push(f)
    }
  }

  return out
}


export function buildMemorySystemPrompt(
  files: MemoryFile[],
  opts: { totalBudgetBytes?: number } = {},
): string {
  if (files.length === 0) return ""
  const budget = opts.totalBudgetBytes ?? TOTAL_BUDGET_BYTES

  const sorted = [...files].sort((a, b) => {
    if (a.scope !== b.scope) return a.scope === "project" ? -1 : 1
    return a.name.localeCompare(b.name)
  })

  const parts: string[] = []
  let used = 0
  for (const f of sorted) {
    const header = `## ${f.scope === "project" ? "Project" : "Global"}: ${f.name}\n`
    const block = header + f.content.trim() + "\n"
    if (used + byteLen(block) > budget) break
    parts.push(block)
    used += byteLen(block)
  }

  if (parts.length === 0) return ""

  return [
    "# Active Memory and Rules",
    "The following instructions were loaded by the user. Follow them while working on tasks.",
    "",
    parts.join("\n"),
  ].join("\n")
}


async function safeHomeDir(): Promise<string | null> {
  try {
    return await homeDir()
  } catch {
    return null
  }
}

async function fetchText(url: string, timeoutMs: number): Promise<string | null> {
  const cached = urlCache.get(url)
  if (cached && Date.now() - cached.at < URL_CACHE_TTL_MS) return cached.text
  try {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), timeoutMs)
    try {
      const res = await tauriFetch(url, { signal: ctrl.signal })
      if (!res.ok) return null
      const text = await res.text()
      urlCache.set(url, { at: Date.now(), text })
      return text
    } finally {
      clearTimeout(timer)
    }
  } catch {
    return null
  }
}

function joinPath(...parts: string[]): string {
  return parts
    .map((p, i) => (i === 0 ? p.replace(/[\\/]+$/, "") : p.replace(/^[\\/]+|[\\/]+$/g, "")))
    .filter(Boolean)
    .join("/")
}
