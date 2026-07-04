//
import { hunksForEdit, type DiffLine } from "@/lib/diff"
import { parsePatchForUI } from "@/lib/tools/patch"
import type { Part } from "@/store/types"

export type TurnEditFile = {
  path: string
  added: number
  removed: number
  lines: DiffLine[]
  newContent?: string
}

export type TurnEdits = {
  files: TurnEditFile[]
  totalAdded: number
  totalRemoved: number
}

const EDIT_TOOLS = new Set(["edit_file", "write_file", "apply_patch"])

function countLines(lines: DiffLine[]): { added: number; removed: number } {
  let added = 0
  let removed = 0
  for (const l of lines) {
    if (l.kind === "add") added++
    else if (l.kind === "del") removed++
  }
  return { added, removed }
}

export function aggregateTurnEdits(
  parts: Part[] | undefined,
  writeOldByCallId: Record<string, string> = {},
): TurnEdits {
  if (!parts) return { files: [], totalAdded: 0, totalRemoved: 0 }

  const errored = new Set<string>()
  for (const p of parts) {
    if (p.type === "tool-result" && p.isError) errored.add(p.toolCallId)
  }

  const byPath = new Map<string, TurnEditFile>()
  const merge = (path: string, lines: DiffLine[], newContent?: string) => {
    const { added, removed } = countLines(lines)
    const prev = byPath.get(path)
    if (prev) {
      prev.added += added
      prev.removed += removed
      prev.lines = prev.lines.concat(lines)
      if (newContent != null) prev.newContent = newContent
    } else {
      byPath.set(path, { path, added, removed, lines: [...lines], newContent })
    }
  }

  for (const p of parts) {
    if (p.type !== "tool-call" || !EDIT_TOOLS.has(p.toolName)) continue
    if (errored.has(p.toolCallId)) continue
    const input = (p.input as Record<string, unknown>) ?? {}

    if (p.toolName === "edit_file") {
      const path = String(input.path ?? "")
      if (!path) continue
      merge(path, hunksForEdit(String(input.old_string ?? ""), String(input.new_string ?? "")))
    } else if (p.toolName === "write_file") {
      const path = String(input.path ?? "")
      if (!path) continue
      const content = String(input.content ?? "")
      const old = writeOldByCallId[p.toolCallId]
      if (old != null && old !== content) {
        // Overwrite → edit_file gibi renkli diff.
        merge(path, hunksForEdit(old, content))
      } else {
        const added = content === "" ? 0 : content.split("\n").length
        const prev = byPath.get(path)
        if (prev) {
          prev.added += added
          prev.newContent = content
        } else {
          byPath.set(path, { path, added, removed: 0, lines: [], newContent: content })
        }
      }
    } else if (p.toolName === "apply_patch") {
      let views
      try {
        views = parsePatchForUI(String(input.patch ?? ""))
      } catch {
        continue
      }
      for (const v of views) {
        const label = v.movePath ? `${v.path} → ${v.movePath}` : v.path
        merge(label, v.lines)
      }
    }
  }

  const files = [...byPath.values()]
  let totalAdded = 0
  let totalRemoved = 0
  for (const f of files) {
    totalAdded += f.added
    totalRemoved += f.removed
  }
  return { files, totalAdded, totalRemoved }
}

export function turnEditsToUnifiedDiff(edits: TurnEdits): string {
  const out: string[] = []
  for (const f of edits.files) {
    out.push(`diff --git a/${f.path} b/${f.path}`)
    if (f.lines.length > 0) {
      const firstOld = f.lines.find((l) => l.oldNo != null)?.oldNo ?? 1
      const firstNew = f.lines.find((l) => l.newNo != null)?.newNo ?? 1
      out.push(`@@ -${firstOld} +${firstNew} @@`)
      for (const l of f.lines) {
        const prefix = l.kind === "add" ? "+" : l.kind === "del" ? "-" : " "
        out.push(prefix + l.text)
      }
    } else if (f.newContent != null) {
      const contentLines = f.newContent === "" ? [] : f.newContent.split("\n")
      out.push("@@ -0,0 +1 @@")
      for (const line of contentLines) out.push("+" + line)
    }
  }
  return out.join("\n")
}
