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
import { readTextFile, writeTextFile, exists, remove, mkdir } from "@tauri-apps/plugin-fs"
import { resolveInWorkspace } from "./paths"
import { trimContext, type DiffLine } from "@/lib/diff"
import {
  SimpleReplacer,
  LineTrimmedReplacer,
  WhitespaceNormalizedReplacer,
  UnicodeNormalizedReplacer,
  IndentationFlexibleReplacer,
  EscapeNormalizedReplacer,
  TrimmedBoundaryReplacer,
  type Replacer,
} from "./replace"

export type HunkLine =
  | { kind: "ctx"; text: string }
  | { kind: "del"; text: string }
  | { kind: "add"; text: string }

export type Hunk = { lines: HunkLine[]; context?: string }

type FileOp =
  | { op: "update"; path: string; hunks: Hunk[]; movePath?: string }
  | { op: "add"; path: string; content: string }
  | { op: "delete"; path: string }

class PatchError extends Error {}

function parsePatch(input: string): FileOp[] {
  const lines = input.split(/\r?\n/)
  let i = 0

  while (i < lines.length && lines[i].trim() === "") i++
  if (i >= lines.length || !lines[i].startsWith("*** Begin Patch")) {
    throw new PatchError("Patch '*** Begin Patch' satırı ile başlamalı")
  }
  i++

  const ops: FileOp[] = []
  while (i < lines.length) {
    const line = lines[i]
    if (line.startsWith("*** End Patch")) {
      if (ops.length === 0) throw new PatchError("Boş patch — hiçbir dosya işlemi yok")
      return ops
    }
    if (line.startsWith("*** Update File:")) {
      const path = line.slice("*** Update File:".length).trim()
      i++
      let movePath: string | undefined
      while (i < lines.length && lines[i].trim() === "") i++
      if (i < lines.length && lines[i].startsWith("*** Move to:")) {
        movePath = lines[i].slice("*** Move to:".length).trim()
        i++
      }
      const { hunks, nextIdx } = parseHunks(lines, i)
      ops.push({ op: "update", path, hunks, movePath })
      i = nextIdx
      continue
    }
    if (line.startsWith("*** Add File:")) {
      const path = line.slice("*** Add File:".length).trim()
      i++
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
    if (line.trim() === "") {
      i++
      continue
    }
    throw new PatchError(`Tanınmayan patch direktifi (satır ${i + 1}): ${line}`)
  }
  throw new PatchError("Patch '*** End Patch' ile bitmedi")
}

function parseHunks(lines: string[], start: number): { hunks: Hunk[]; nextIdx: number } {
  let i = start
  const hunks: Hunk[] = []

  while (i < lines.length && lines[i].trim() === "") i++
  if (i >= lines.length || !lines[i].startsWith("@@")) {
    if (i < lines.length && lines[i].startsWith("*** ")) {
      throw new PatchError(`Update File altında en az bir '@@' hunk gerekir (satır ${i + 1})`)
    }
    throw new PatchError(`'@@' hunk başlığı bekleniyordu (satır ${i + 1})`)
  }

  while (i < lines.length) {
    if (!lines[i].startsWith("@@")) {
      if (lines[i].startsWith("*** ")) break
      throw new PatchError(`Hunk başlığı '@@' bekleniyordu (satır ${i + 1})`)
    }
    const ctxHeader = lines[i].slice(2).trim()
    i++
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
    hunks.push({ lines: hunkLines, context: ctxHeader || undefined })
  }
  return { hunks, nextIdx: i }
}

const PATCH_REPLACERS: Replacer[] = [
  SimpleReplacer,
  LineTrimmedReplacer,
  WhitespaceNormalizedReplacer,
  UnicodeNormalizedReplacer,
  IndentationFlexibleReplacer,
  EscapeNormalizedReplacer,
  TrimmedBoundaryReplacer,
]

export type BlockMatch = { index: number; length: number } | { error: "notfound" | "ambiguous" }

function searchBlock(content: string, oldBlock: string, fromOffset = 0): BlockMatch {
  let ambiguous = false
  for (const replacer of PATCH_REPLACERS) {
    for (const search of replacer(content, oldBlock)) {
      const index = content.indexOf(search, fromOffset)
      if (index === -1) continue
      if (content.indexOf(search, index + search.length) !== -1) {
        ambiguous = true
        continue
      }
      return { index, length: search.length }
    }
  }
  return { error: ambiguous ? "ambiguous" : "notfound" }
}

function findContextOffset(content: string, context: string): number {
  const needle = context.trim()
  if (!needle) return -1
  const lines = content.split("\n")
  let offset = 0
  for (const line of lines) {
    if (line.trim() === needle) return offset
    offset += line.length + 1
  }
  offset = 0
  for (const line of lines) {
    if (line.includes(needle)) return offset
    offset += line.length + 1
  }
  return -1
}

export function findBlock(content: string, oldBlock: string, context?: string): BlockMatch {
  const plain = searchBlock(content, oldBlock, 0)
  if ("index" in plain) return plain
  if (plain.error === "notfound") return plain
  if (context) {
    const anchor = findContextOffset(content, context)
    if (anchor >= 0) {
      const tail = searchBlock(content, oldBlock, anchor)
      if ("index" in tail) return tail
    }
  }
  return { error: "ambiguous" }
}

export function applyHunk(content: string, hunk: Hunk): string {
  const oldLines = hunk.lines.filter((l) => l.kind !== "add").map((l) => l.text)
  const newLines = hunk.lines.filter((l) => l.kind !== "del").map((l) => l.text)
  if (oldLines.length === 0) {
    if (newLines.length === 0) return content
    const added = newLines.join("\n")
    if (hunk.context) {
      const anchor = findContextOffset(content, hunk.context)
      if (anchor >= 0) {
        const lineEnd = content.indexOf("\n", anchor)
        const insertAt = lineEnd === -1 ? content.length : lineEnd
        return content.slice(0, insertAt) + "\n" + added + content.slice(insertAt)
      }
    }
    const sep = content.endsWith("\n") || content === "" ? "" : "\n"
    return content + sep + added + "\n"
  }
  const oldBlock = oldLines.join("\n")
  const newBlock = newLines.join("\n")
  if (oldBlock === newBlock) return content

  const match = findBlock(content, oldBlock, hunk.context)
  if ("error" in match) {
    if (match.error === "ambiguous") {
      throw new PatchError(
        `Hunk birden fazla yerde eşleşiyor — daha fazla context satırı ekle:\n---\n${oldBlock.slice(0, 400)}\n---`,
      )
    }
    throw new PatchError(
      `Hunk eşleşmedi — eski blok dosyada bulunamadı:\n---\n${oldBlock.slice(0, 400)}\n---`,
    )
  }
  return content.slice(0, match.index) + newBlock + content.slice(match.index + match.length)
}

export type ApplyPatchResult = {
  filesChanged: string[]
  filesAdded: string[]
  filesDeleted: string[]
  filesMoved: { from: string; to: string }[]
  hunksApplied: number
}

export async function applyPatch(workspace: string, patch: string): Promise<ApplyPatchResult> {
  const ops = parsePatch(patch)
  const result: ApplyPatchResult = {
    filesChanged: [],
    filesAdded: [],
    filesDeleted: [],
    filesMoved: [],
    hunksApplied: 0,
  }

  const overlay = new Map<string, string | null>()
  const readState = async (abs: string): Promise<string | null> => {
    if (overlay.has(abs)) return overlay.get(abs)!
    if (await exists(abs)) return readTextFile(abs)
    return null
  }

  for (const op of ops) {
    const abs = resolveInWorkspace(workspace, op.path)
    if (op.op === "update") {
      const cur = await readState(abs)
      if (cur === null) throw new PatchError(`Update File: dosya yok — ${op.path}`)
      let content = cur
      for (const hunk of op.hunks) {
        content = applyHunk(content, hunk)
        result.hunksApplied++
      }
      if (op.movePath) {
        const moveAbs = resolveInWorkspace(workspace, op.movePath)
        overlay.set(abs, null)
        overlay.set(moveAbs, content)
        result.filesMoved.push({ from: op.path, to: op.movePath })
      } else {
        overlay.set(abs, content)
        result.filesChanged.push(op.path)
      }
    } else if (op.op === "add") {
      const cur = await readState(abs)
      if (cur !== null) throw new PatchError(`Add File: dosya zaten var — ${op.path}`)
      overlay.set(abs, op.content)
      result.filesAdded.push(op.path)
    } else if (op.op === "delete") {
      const cur = await readState(abs)
      if (cur === null) throw new PatchError(`Delete File: dosya yok — ${op.path}`)
      overlay.set(abs, null)
      result.filesDeleted.push(op.path)
    }
  }

  for (const [abs, content] of overlay) {
    if (content === null) {
      if (await exists(abs)) await remove(abs)
    } else {
      const lastSep = Math.max(abs.lastIndexOf("/"), abs.lastIndexOf("\\"))
      if (lastSep > 0) {
        const parent = abs.slice(0, lastSep)
        if (!(await exists(parent))) await mkdir(parent, { recursive: true })
      }
      await writeTextFile(abs, content)
    }
  }

  return result
}

export type PatchFileView = {
  path: string
  op: "update" | "add" | "delete"
  movePath?: string
  lines: DiffLine[]
}

export function parsePatchForUI(patch: string): PatchFileView[] {
  let ops: FileOp[]
  try {
    ops = parsePatch(patch)
  } catch {
    return []
  }
  return ops.map((op): PatchFileView => {
    if (op.op === "add") {
      let newN = 0
      return {
        path: op.path,
        op: "add",
        lines: op.content.split("\n").map((text) => ({ kind: "add", text, newNo: ++newN })),
      }
    }
    if (op.op === "delete") {
      return { path: op.path, op: "delete", lines: [] }
    }
    let oldN = 0
    let newN = 0
    const lines: DiffLine[] = []
    op.hunks.forEach((h) => {
      const numbered: DiffLine[] = h.lines.map((l) => {
        if (l.kind === "del") return { kind: "del", text: l.text, oldNo: ++oldN }
        if (l.kind === "add") return { kind: "add", text: l.text, newNo: ++newN }
        return { kind: "ctx", text: l.text, oldNo: ++oldN, newNo: ++newN }
      })
      const trimmed = trimContext(numbered)
      if (trimmed.length === 0) return
      if (lines.length > 0) lines.push({ kind: "ctx", text: "…" })
      lines.push(...trimmed)
    })
    return { path: op.path, op: "update", movePath: op.movePath, lines }
  })
}

export function formatApplyResult(r: ApplyPatchResult): string {
  const lines: string[] = []
  for (const f of r.filesAdded) lines.push(`A ${f}`)
  for (const f of r.filesChanged) lines.push(`M ${f}`)
  for (const m of r.filesMoved) lines.push(`R ${m.from} → ${m.to}`)
  for (const f of r.filesDeleted) lines.push(`D ${f}`)
  if (lines.length === 0) return "Patch uygulandı ama dosya değişmedi."
  return `Başarılı. Değişen dosyalar:\n${lines.join("\n")}\n(${r.hunksApplied} hunk)`
}
