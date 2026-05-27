// apply_patch — context tabanlı multi-hunk diff uygulama.
// Format (Opencode/GPT-OSS stili):
//
// *** Begin Patch
// *** Update File: src/foo.ts
// @@
//  context line
// -removed line 1
// -removed line 2
// +added line 1
// +added line 2
//  context line
// @@
//  another hunk...
// *** Update File: src/bar.ts
// @@
//  ...
// *** End Patch
//
// Aynı patch tek/çoklu dosya, tek/çoklu hunk içerebilir.
// Line number gerektirmez — context satırları benzersiz konum bulur.
// "*** Add File:" ve "*** Delete File:" başlıkları da desteklenir.
import { readTextFile, writeTextFile, exists, remove, mkdir } from "@tauri-apps/plugin-fs"
import { resolveInWorkspace } from "./paths"

type HunkLine =
  | { kind: "ctx"; text: string }
  | { kind: "del"; text: string }
  | { kind: "add"; text: string }

type Hunk = { lines: HunkLine[] }

type FileOp =
  | { op: "update"; path: string; hunks: Hunk[] }
  | { op: "add"; path: string; content: string }
  | { op: "delete"; path: string }

class PatchError extends Error {}

function parsePatch(input: string): FileOp[] {
  const lines = input.split(/\r?\n/)
  let i = 0

  // Begin Patch öncesi blank/whitespace atla
  while (i < lines.length && lines[i].trim() === "") i++
  if (i >= lines.length || !lines[i].startsWith("*** Begin Patch")) {
    throw new PatchError("Patch '*** Begin Patch' satırı ile başlamalı")
  }
  i++

  const ops: FileOp[] = []
  while (i < lines.length) {
    const line = lines[i]
    if (line.startsWith("*** End Patch")) {
      return ops
    }
    if (line.startsWith("*** Update File:")) {
      const path = line.slice("*** Update File:".length).trim()
      i++
      const { hunks, nextIdx } = parseHunks(lines, i)
      ops.push({ op: "update", path, hunks })
      i = nextIdx
      continue
    }
    if (line.startsWith("*** Add File:")) {
      const path = line.slice("*** Add File:".length).trim()
      i++
      // Add File içeriği: + ile başlayan satırlar
      const buf: string[] = []
      while (i < lines.length && !lines[i].startsWith("*** ")) {
        if (lines[i].startsWith("+")) {
          buf.push(lines[i].slice(1))
        } else if (lines[i].trim() === "") {
          buf.push("")
        }
        i++
      }
      ops.push({ op: "add", path, content: buf.join("\n") })
      continue
    }
    if (line.startsWith("*** Delete File:")) {
      const path = line.slice("*** Delete File:".length).trim()
      ops.push({ op: "delete", path })
      i++
      continue
    }
    // Bilinmeyen satır → atla (boş veya yorum)
    if (line.trim() === "") {
      i++
      continue
    }
    throw new PatchError(`Tanınmayan patch direktifi (satır ${i + 1}): ${line}`)
  }
  throw new PatchError("Patch '*** End Patch' ile bitmedi")
}

// Update File altındaki hunk listesini parse et.
// Hunk başlangıcı '@@', sonu sonraki '@@' veya '*** ' direktifi.
function parseHunks(lines: string[], start: number): { hunks: Hunk[]; nextIdx: number } {
  let i = start
  const hunks: Hunk[] = []

  // İlk @@ bekle
  while (i < lines.length && lines[i].trim() === "") i++
  if (i >= lines.length || !lines[i].startsWith("@@")) {
    if (i < lines.length && lines[i].startsWith("*** ")) {
      // Boş hunk değil — bir sonraki direktif, hunk yok
      throw new PatchError(`Update File altında en az bir '@@' hunk gerekir (satır ${i + 1})`)
    }
    throw new PatchError(`'@@' hunk başlığı bekleniyordu (satır ${i + 1})`)
  }

  while (i < lines.length) {
    if (!lines[i].startsWith("@@")) {
      if (lines[i].startsWith("*** ")) break
      throw new PatchError(`Hunk başlığı '@@' bekleniyordu (satır ${i + 1})`)
    }
    i++ // @@ satırını geç
    const hunkLines: HunkLine[] = []
    while (i < lines.length) {
      const l = lines[i]
      if (l.startsWith("@@") || l.startsWith("*** ")) break
      if (l.startsWith("+")) hunkLines.push({ kind: "add", text: l.slice(1) })
      else if (l.startsWith("-")) hunkLines.push({ kind: "del", text: l.slice(1) })
      else if (l.startsWith(" ")) hunkLines.push({ kind: "ctx", text: l.slice(1) })
      else if (l === "") hunkLines.push({ kind: "ctx", text: "" })
      else {
        // Bilinmeyen prefix — context olarak kabul et
        hunkLines.push({ kind: "ctx", text: l })
      }
      i++
    }
    hunks.push({ lines: hunkLines })
  }
  return { hunks, nextIdx: i }
}

// Tek hunk'ı içeriğe uygula. Context+del satırlarını birleştir, dosya içinde
// benzersiz olarak bul, replace et.
function applyHunk(content: string, hunk: Hunk): string {
  // Eski blok: ctx + del
  const oldLines = hunk.lines.filter((l) => l.kind !== "add").map((l) => l.text)
  // Yeni blok: ctx + add
  const newLines = hunk.lines.filter((l) => l.kind !== "del").map((l) => l.text)
  // Pure-add hunk (tüm hunk + ile başlıyor) → dosya sonuna ekle
  if (oldLines.length === 0) {
    if (newLines.length === 0) return content
    const sep = content.endsWith("\n") || content === "" ? "" : "\n"
    return content + sep + newLines.join("\n") + "\n"
  }
  const oldBlock = oldLines.join("\n")
  const newBlock = newLines.join("\n")

  // Trim sonu olabilir — satır sınırlarında ara
  const idx = content.indexOf(oldBlock)
  if (idx === -1) {
    throw new PatchError(
      `Hunk eşleşmedi — eski blok dosyada bulunamadı:\n---\n${oldBlock.slice(0, 400)}\n---`,
    )
  }
  const secondIdx = content.indexOf(oldBlock, idx + 1)
  if (secondIdx !== -1) {
    throw new PatchError(
      `Hunk birden fazla yerde eşleşiyor — daha fazla context satırı ekle:\n---\n${oldBlock.slice(0, 400)}\n---`,
    )
  }
  return content.slice(0, idx) + newBlock + content.slice(idx + oldBlock.length)
}

export type ApplyPatchResult = {
  filesChanged: string[]
  filesAdded: string[]
  filesDeleted: string[]
  hunksApplied: number
}

export async function applyPatch(workspace: string, patch: string): Promise<ApplyPatchResult> {
  const ops = parsePatch(patch)
  const result: ApplyPatchResult = {
    filesChanged: [],
    filesAdded: [],
    filesDeleted: [],
    hunksApplied: 0,
  }

  for (const op of ops) {
    const abs = resolveInWorkspace(workspace, op.path)
    if (op.op === "update") {
      if (!(await exists(abs))) throw new PatchError(`Update File: dosya yok — ${op.path}`)
      let content = await readTextFile(abs)
      for (const hunk of op.hunks) {
        content = applyHunk(content, hunk)
        result.hunksApplied++
      }
      await writeTextFile(abs, content)
      result.filesChanged.push(op.path)
    } else if (op.op === "add") {
      if (await exists(abs)) throw new PatchError(`Add File: dosya zaten var — ${op.path}`)
      // Parent dir yoksa oluştur
      const lastSep = Math.max(abs.lastIndexOf("/"), abs.lastIndexOf("\\"))
      if (lastSep > 0) {
        const parent = abs.slice(0, lastSep)
        if (!(await exists(parent))) await mkdir(parent, { recursive: true })
      }
      await writeTextFile(abs, op.content)
      result.filesAdded.push(op.path)
    } else if (op.op === "delete") {
      if (!(await exists(abs))) throw new PatchError(`Delete File: dosya yok — ${op.path}`)
      await remove(abs)
      result.filesDeleted.push(op.path)
    }
  }
  return result
}

export function formatApplyResult(r: ApplyPatchResult): string {
  const parts: string[] = []
  if (r.filesChanged.length > 0) parts.push(`Güncellendi (${r.filesChanged.length}): ${r.filesChanged.join(", ")}`)
  if (r.filesAdded.length > 0) parts.push(`Eklendi (${r.filesAdded.length}): ${r.filesAdded.join(", ")}`)
  if (r.filesDeleted.length > 0) parts.push(`Silindi (${r.filesDeleted.length}): ${r.filesDeleted.join(", ")}`)
  parts.push(`Toplam ${r.hunksApplied} hunk uygulandı.`)
  return parts.join("\n")
}
