// Semantic index — workspace kaynak dosyalarını chunk'la, embedding'e çevir, JSON'a yaz.
// Query: sorgu embed et, cosine sim ile top-K chunk döndür.
//
// Storage: <workspace>/.codezal/index.json
// Schema: { version, model, dim, chunks: [{ id, path, line0, line1, text, vec }] }
//
// İndex tek dosya — küçük-orta repo (<5k chunk) için yeterli. Daha büyük için SQLite gerekir.
import {
  exists,
  mkdir,
  readDir,
  readTextFile,
  writeTextFile,
} from "@tauri-apps/plugin-fs"
import { embedMany, cosine, type EmbeddingConfig } from "./embedding"

// Index'e dahil edilecek dosya uzantıları — kaynak kod + dokümantasyon.
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
  ".kt",
  ".swift",
  ".rb",
  ".php",
  ".c",
  ".h",
  ".cpp",
  ".hpp",
  ".cs",
  ".scala",
  ".sh",
  ".bash",
  ".zsh",
  ".sql",
  ".md",
  ".mdx",
  ".rst",
  ".toml",
  ".yaml",
  ".yml",
  ".json",
])

// Ignore klasörleri — büyük binary / generated.
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

const MAX_FILE_BYTES = 200_000
const CHUNK_CHAR_TARGET = 1200
const CHUNK_OVERLAP = 200

export type IndexChunk = {
  id: string
  path: string // workspace-relative
  line0: number // 1-based dahil
  line1: number // 1-based dahil
  text: string
  vec: number[]
}

export type SemanticIndex = {
  version: 1
  model: string
  dim: number
  builtAt: number
  chunks: IndexChunk[]
}

const INDEX_REL = ".codezal/index.json"

// İndex dosya yolu (workspace absolute path).
function indexPath(workspace: string): string {
  const ws = workspace.replace(/[\\/]+$/, "")
  return `${ws}/${INDEX_REL}`
}

// Dosyayı işlemeli mi?
function shouldIndex(name: string): boolean {
  const dot = name.lastIndexOf(".")
  if (dot === -1) return false
  return INCLUDE_EXT.has(name.slice(dot).toLowerCase())
}

// Workspace içinde tüm desteklenen dosyaları topla (relative path olarak).
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

// Bir dosyayı line-aware chunk'lara böl. CHUNK_CHAR_TARGET'a yakın, overlap'li.
function chunkFile(text: string): Array<{ line0: number; line1: number; text: string }> {
  const lines = text.split("\n")
  const out: Array<{ line0: number; line1: number; text: string }> = []
  let buf: string[] = []
  let bufStart = 1
  let bufChars = 0

  const flush = (endLine: number) => {
    if (buf.length === 0) return
    out.push({ line0: bufStart, line1: endLine, text: buf.join("\n") })
  }

  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i]
    if (bufChars + ln.length + 1 > CHUNK_CHAR_TARGET && buf.length > 0) {
      flush(bufStart + buf.length - 1)
      // Overlap: son N karakterlik kuyruk
      const overlapLines: string[] = []
      let overlapChars = 0
      for (let j = buf.length - 1; j >= 0; j--) {
        overlapChars += buf[j].length + 1
        overlapLines.unshift(buf[j])
        if (overlapChars >= CHUNK_OVERLAP) break
      }
      bufStart = bufStart + buf.length - overlapLines.length
      buf = overlapLines
      bufChars = overlapChars
    }
    buf.push(ln)
    bufChars += ln.length + 1
  }
  flush(bufStart + buf.length - 1)
  return out
}

export type BuildProgress = {
  phase: "collect" | "read" | "embed" | "write"
  done: number
  total: number
  current?: string
}

// Index inşa et + diske yaz.
export async function buildIndex(args: {
  workspace: string
  cfg: EmbeddingConfig
  onProgress?: (p: BuildProgress) => void
  signal?: AbortSignal
}): Promise<SemanticIndex> {
  const { workspace, cfg, onProgress, signal } = args
  if (!workspace) throw new Error("Workspace bağlı değil — index oluşturulamaz")

  onProgress?.({ phase: "collect", done: 0, total: 0 })
  const files = await collectFiles(workspace)
  if (files.length === 0) throw new Error("İndex'lenecek dosya yok")

  // Dosyaları oku + chunk'la
  const chunks: Array<Omit<IndexChunk, "vec">> = []
  let read = 0
  for (const rel of files) {
    if (signal?.aborted) throw new Error("İptal edildi")
    read++
    onProgress?.({ phase: "read", done: read, total: files.length, current: rel })
    let content: string
    try {
      content = await readTextFile(`${workspace.replace(/[\\/]+$/, "")}/${rel}`)
    } catch {
      continue
    }
    if (content.length > MAX_FILE_BYTES) content = content.slice(0, MAX_FILE_BYTES)
    if (!content.trim()) continue
    const parts = chunkFile(content)
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i]
      chunks.push({
        id: `${rel}#${i}`,
        path: rel,
        line0: p.line0,
        line1: p.line1,
        text: p.text,
      })
    }
  }

  if (chunks.length === 0) throw new Error("Chunk üretilemedi")

  // Embed et (batch)
  const texts = chunks.map((c) => `${c.path}\n\n${c.text}`)
  const vecs = await embedMany(cfg, texts, 64, (done, total) => {
    if (signal?.aborted) throw new Error("İptal edildi")
    onProgress?.({ phase: "embed", done, total })
  })
  if (vecs.length !== chunks.length) {
    throw new Error(`Embedding sayısı uyumsuz: ${vecs.length} != ${chunks.length}`)
  }

  const index: SemanticIndex = {
    version: 1,
    model: cfg.model,
    dim: vecs[0]?.length ?? 0,
    builtAt: Date.now(),
    chunks: chunks.map((c, i) => ({ ...c, vec: vecs[i] })),
  }

  // Diske yaz
  onProgress?.({ phase: "write", done: 0, total: 1 })
  const dir = `${workspace.replace(/[\\/]+$/, "")}/.codezal`
  if (!(await exists(dir))) await mkdir(dir, { recursive: true })
  await writeTextFile(indexPath(workspace), JSON.stringify(index))
  onProgress?.({ phase: "write", done: 1, total: 1 })
  return index
}

// Diskten yükle. Yoksa null.
export async function loadIndex(workspace: string): Promise<SemanticIndex | null> {
  if (!workspace) return null
  const p = indexPath(workspace)
  if (!(await exists(p))) return null
  try {
    const raw = await readTextFile(p)
    const parsed = JSON.parse(raw) as SemanticIndex
    if (parsed.version !== 1 || !Array.isArray(parsed.chunks)) return null
    return parsed
  } catch {
    return null
  }
}

// Query — sorgu embed et + cosine sim ile en yakın K chunk.
export async function queryIndex(args: {
  index: SemanticIndex
  cfg: EmbeddingConfig
  query: string
  topK?: number
}): Promise<Array<{ chunk: IndexChunk; score: number }>> {
  const { index, cfg, query, topK = 5 } = args
  if (cfg.model !== index.model) {
    console.warn(
      `[semantic] index modeli (${index.model}) ≠ aktif model (${cfg.model}). Yeniden index önerilir.`,
    )
  }
  const [qvec] = await embedMany(cfg, [query], 1)
  if (!qvec) throw new Error("Query embedding alınamadı")
  const scored = index.chunks.map((c) => ({ chunk: c, score: cosine(qvec, c.vec) }))
  scored.sort((a, b) => b.score - a.score)
  return scored.slice(0, topK)
}
