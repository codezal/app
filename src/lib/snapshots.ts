// Snapshot yüksek seviye yardımcıları — tool execute'undan çağrılır.
// Capture: mutasyon öncesi etkilenen dosyaların durumunu sakla.
// Restore: bir mesajdaki tüm snapshot'ları workspace'e geri yaz.
import {
  exists as fsExists,
  readTextFile,
  writeTextFile,
  remove as fsRemove,
  mkdir,
} from "@tauri-apps/plugin-fs"
import { resolveInWorkspace } from "./tools/paths"
import { saveSnapshot, readSnapshot, listSnapshotPaths } from "./storage"

// Mutasyon öncesi dosyaları snapshot'a yaz. relPaths: workspace'e relative.
// null content → dosya o an yoktu (revert sırasında oluşturulacak silme komutu).
export async function captureFiles(
  sessionId: string,
  messageId: string,
  workspace: string,
  relPaths: string[],
): Promise<void> {
  // Aynı path'i tekrar capture etme — ilk hâli korunmalı
  const already = new Set(await listSnapshotPaths(sessionId, messageId))
  for (const rel of relPaths) {
    if (already.has(rel)) continue
    let content: string | null = null
    try {
      const abs = resolveInWorkspace(workspace, rel)
      if (await fsExists(abs)) {
        content = await readTextFile(abs)
      }
    } catch {
      content = null
    }
    try {
      await saveSnapshot(sessionId, messageId, rel, content)
    } catch (e) {
      console.warn(`[snapshot] capture başarısız: ${rel}`, e)
    }
  }
}

// Mesajdaki tüm snapshot'ları workspace'e geri yaz.
// content !== null → o içerikle üzerine yaz. content === null → dosyayı sil.
export async function restoreMessage(
  sessionId: string,
  messageId: string,
  workspace: string,
): Promise<{ restored: number; deleted: number }> {
  const paths = await listSnapshotPaths(sessionId, messageId)
  let restored = 0
  let deleted = 0
  for (const rel of paths) {
    const snap = await readSnapshot(sessionId, messageId, rel)
    if (!snap.exists) continue
    const abs = resolveInWorkspace(workspace, rel)
    if (snap.content === null) {
      // Eskiden yoktu — şimdi varsa sil
      if (await fsExists(abs)) {
        await fsRemove(abs)
        deleted++
      }
      continue
    }
    // Parent dir oluştur
    const lastSep = Math.max(abs.lastIndexOf("/"), abs.lastIndexOf("\\"))
    if (lastSep > 0) {
      const parent = abs.slice(0, lastSep)
      if (!(await fsExists(parent))) await mkdir(parent, { recursive: true })
    }
    await writeTextFile(abs, snap.content)
    restored++
  }
  return { restored, deleted }
}

// Bir tool çağrısı verilen input'tan etkilenen path'leri tahmin et.
// bash desteklenmez (path bilinmez); diğer mutasyon tool'ları için path çıkarılır.
export function affectedPaths(toolName: string, input: unknown): string[] {
  const i = (input as Record<string, unknown>) ?? {}
  if (toolName === "write_file" || toolName === "edit_file") {
    return typeof i.path === "string" ? [i.path] : []
  }
  if (toolName === "apply_patch") {
    const patch = String(i.patch ?? "")
    const paths: string[] = []
    for (const line of patch.split(/\r?\n/)) {
      if (line.startsWith("*** Update File:")) paths.push(line.slice("*** Update File:".length).trim())
      else if (line.startsWith("*** Add File:")) paths.push(line.slice("*** Add File:".length).trim())
      else if (line.startsWith("*** Delete File:")) paths.push(line.slice("*** Delete File:".length).trim())
    }
    return paths
  }
  return []
}
