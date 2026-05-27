// Workspace klasör tarayıcı — lazy, Tauri fs üzerinden.
// node_modules / .git gibi gürültüyü gizler.
import { readDir } from "@tauri-apps/plugin-fs"

export type FsEntry = {
  name: string
  path: string // absolute
  isDir: boolean
}

const IGNORE = new Set([
  "node_modules",
  ".git",
  ".next",
  "dist",
  "build",
  "out",
  ".turbo",
  ".cache",
  "coverage",
  "target",
  ".DS_Store",
  ".venv",
  "__pycache__",
])

// Tek seviyede içerik oku — dizinler önce, sonra dosyalar; alfabetik
export async function readWorkspaceDir(absPath: string): Promise<FsEntry[]> {
  const entries = await readDir(absPath)
  const out: FsEntry[] = []
  for (const e of entries) {
    if (IGNORE.has(e.name)) continue
    if (e.name.startsWith(".") && e.name !== ".env.example") {
      // Gizli dosyaları varsayılan gizle, env.example gibi sık görüleni göster
      // (kullanıcı isterse toggle eklenir)
      continue
    }
    out.push({
      name: e.name,
      path: absPath.replace(/[\\/]+$/, "") + "/" + e.name,
      isDir: !!e.isDirectory,
    })
  }
  out.sort((a, b) => {
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1
    return a.name.localeCompare(b.name)
  })
  return out
}
