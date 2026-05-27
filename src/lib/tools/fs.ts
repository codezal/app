// Filesystem tool implementasyonları — Tauri fs plugin üzerinden.
// Hepsi workspace kökü altında çalışır, dışına çıkamaz.
import {
  readTextFile,
  writeTextFile,
  readDir,
  mkdir,
  exists,
} from "@tauri-apps/plugin-fs"
import { resolveInWorkspace } from "./paths"

// Dizini listele — alt klasör/dosya isimleri + tip
export async function listDir(workspace: string, rel: string): Promise<string> {
  const abs = resolveInWorkspace(workspace, rel || ".")
  const entries = await readDir(abs)
  if (entries.length === 0) return "(boş klasör)"
  const lines = entries
    .map((e) => `${e.isDirectory ? "d" : "-"} ${e.name}`)
    .sort()
  return lines.join("\n")
}

// Metin dosyası oku — 200KB sınırı
export async function readFile(workspace: string, rel: string): Promise<string> {
  const abs = resolveInWorkspace(workspace, rel)
  const content = await readTextFile(abs)
  if (content.length > 200_000) {
    return content.slice(0, 200_000) + `\n\n... (kesildi, toplam ${content.length} char)`
  }
  return content
}

// Metin dosyası yaz — üst klasör yoksa oluştur
export async function writeFile(
  workspace: string,
  rel: string,
  content: string,
): Promise<string> {
  const abs = resolveInWorkspace(workspace, rel)
  // Parent dir oluştur (recursive)
  const lastSep = Math.max(abs.lastIndexOf("/"), abs.lastIndexOf("\\"))
  if (lastSep > 0) {
    const parent = abs.slice(0, lastSep)
    if (!(await exists(parent))) {
      await mkdir(parent, { recursive: true })
    }
  }
  await writeTextFile(abs, content)
  return `Yazıldı: ${rel} (${content.length} char)`
}

// Surgical edit — old_string → new_string. Tek eşleşme zorunlu.
export async function editFile(
  workspace: string,
  rel: string,
  oldString: string,
  newString: string,
): Promise<string> {
  const abs = resolveInWorkspace(workspace, rel)
  const content = await readTextFile(abs)
  const idx = content.indexOf(oldString)
  if (idx === -1) {
    throw new Error(`old_string bulunamadı: ${rel}`)
  }
  const secondIdx = content.indexOf(oldString, idx + 1)
  if (secondIdx !== -1) {
    throw new Error(`old_string birden fazla yerde geçiyor (${rel}) — daha fazla bağlam ekle`)
  }
  const next = content.slice(0, idx) + newString + content.slice(idx + oldString.length)
  await writeTextFile(abs, next)
  return `Düzenlendi: ${rel}`
}
