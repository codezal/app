// Memory katmanı — workspace + global markdown'larını oku, system prompt'a inject.
// Reasonix mimarisinden ilham: project memory (workspace) > user memory (global) > builtin.
import { readTextFile, exists, readDir } from "@tauri-apps/plugin-fs"
import { homeDir } from "@tauri-apps/api/path"

export type MemoryFile = {
  path: string
  name: string
  scope: "project" | "global"
  content: string
  bytes: number
}

const PROJECT_NAMES = ["CODEZAL.md", "CLAUDE.md", "AGENTS.md", "AGENT.md"]
const MAX_FILE_BYTES = 32_000 // 32K per file (model context koruması)
const TOTAL_BUDGET_BYTES = 96_000 // toplam memory ~96K

// Workspace root'undaki bilinen memory dosyalarını ve .codezal/rules/*.md'leri oku
export async function readProjectMemory(workspace: string): Promise<MemoryFile[]> {
  const out: MemoryFile[] = []

  // Root memory dosyaları
  for (const name of PROJECT_NAMES) {
    const p = joinPath(workspace, name)
    if (await safeExists(p)) {
      const content = await safeRead(p)
      if (content) {
        out.push(makeFile(p, name, "project", content))
      }
    }
  }

  // .codezal/rules/*.md
  const rulesDir = joinPath(workspace, ".codezal/rules")
  if (await safeExists(rulesDir)) {
    try {
      const entries = await readDir(rulesDir)
      for (const e of entries) {
        if (!e.isDirectory && e.name.toLowerCase().endsWith(".md")) {
          const p = joinPath(rulesDir, e.name)
          const content = await safeRead(p)
          if (content) {
            out.push(makeFile(p, ".codezal/rules/" + e.name, "project", content))
          }
        }
      }
    } catch {
      // klasör erişim hatası → sessiz geç
    }
  }

  return out
}

// ~/.codezal/MEMORY.md ve ~/.codezal/rules/*.md
export async function readUserMemory(): Promise<MemoryFile[]> {
  const out: MemoryFile[] = []
  let home: string
  try {
    home = await homeDir()
  } catch {
    return out
  }
  const root = joinPath(home, ".codezal")
  const memoryPath = joinPath(root, "MEMORY.md")
  if (await safeExists(memoryPath)) {
    const content = await safeRead(memoryPath)
    if (content) {
      out.push(makeFile(memoryPath, "MEMORY.md", "global", content))
    }
  }

  const rulesDir = joinPath(root, "rules")
  if (await safeExists(rulesDir)) {
    try {
      const entries = await readDir(rulesDir)
      for (const e of entries) {
        if (!e.isDirectory && e.name.toLowerCase().endsWith(".md")) {
          const p = joinPath(rulesDir, e.name)
          const content = await safeRead(p)
          if (content) {
            out.push(makeFile(p, "rules/" + e.name, "global", content))
          }
        }
      }
    } catch {
      // sessiz
    }
  }

  return out
}

// Tüm memory dosyalarını system prompt'a uygun tek metne çevir.
// Toplam ~96K bütçe; aşılırsa proje öncelikli, sırayla atılır.
export function buildMemorySystemPrompt(files: MemoryFile[]): string {
  if (files.length === 0) return ""

  // Project önce, sonra global
  const sorted = [...files].sort((a, b) => {
    if (a.scope !== b.scope) return a.scope === "project" ? -1 : 1
    return a.name.localeCompare(b.name)
  })

  const parts: string[] = []
  let used = 0
  for (const f of sorted) {
    const header = `## ${f.scope === "project" ? "Proje" : "Global"}: ${f.name}\n`
    const block = header + f.content.trim() + "\n"
    if (used + block.length > TOTAL_BUDGET_BYTES) break
    parts.push(block)
    used += block.length
  }

  if (parts.length === 0) return ""

  return [
    "# Aktif Bellek ve Kurallar",
    "Aşağıdaki yönergeler kullanıcı tarafından yüklenmiştir. Görevleri yaparken bunlara uy.",
    "",
    parts.join("\n"),
  ].join("\n")
}

function makeFile(
  path: string,
  name: string,
  scope: "project" | "global",
  raw: string,
): MemoryFile {
  const trimmed =
    raw.length > MAX_FILE_BYTES
      ? raw.slice(0, MAX_FILE_BYTES) +
        `\n\n[... kesildi, toplam ${raw.length} char]`
      : raw
  return {
    path,
    name,
    scope,
    content: trimmed,
    bytes: trimmed.length,
  }
}

async function safeExists(p: string): Promise<boolean> {
  try {
    return await exists(p)
  } catch {
    return false
  }
}

async function safeRead(p: string): Promise<string | null> {
  try {
    return await readTextFile(p)
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
