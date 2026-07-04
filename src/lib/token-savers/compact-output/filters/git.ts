// Git filter — handles status, diff, log, show. Strategy is conservative:
// keep informational content, drop human-only hints, cap diff size per file.

import { genericFilter } from "./generic"

const MAX_DIFF_LINES_PER_FILE = 40

export function gitFilter(raw: string): string {
  const base = genericFilter(raw)

  // Status hints (`  (use "git add <file>..." to update ...)`) are noise for the
  // model. The quote is NOT adjacent to the closing paren, so match the whole
  // `(use "..." ...)` line up to its trailing `)` — not just a `"`-terminated one.
  let s = base.replace(/^[ \t]*\(use ".*\)[ \t]*$/gm, "")

  // Compact the `git diff` block: per-file header + hunks. If a file has more
  // than MAX_DIFF_LINES_PER_FILE diff lines, keep the header + first N + a
  // `... (X more lines)` marker.
  s = compactDiff(s)

  // Drop trailing empty lines that pile up after stripping hints.
  s = s.replace(/\n{3,}/g, "\n\n")
  return s.trim()
}

function compactDiff(s: string): string {
  const lines = s.split("\n")
  const out: string[] = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    if (line?.startsWith("diff --git ")) {
      // Collect this file's block until the next "diff --git" or EOF.
      const block: string[] = [line]
      i++
      while (i < lines.length && !lines[i]?.startsWith("diff --git ")) {
        block.push(lines[i] ?? "")
        i++
      }
      if (block.length <= MAX_DIFF_LINES_PER_FILE) {
        out.push(...block)
      } else {
        const kept = block.slice(0, MAX_DIFF_LINES_PER_FILE)
        const dropped = block.length - kept.length
        out.push(...kept)
        out.push(`... (${dropped} more diff lines)`)
      }
    } else {
      out.push(line ?? "")
      i++
    }
  }
  return out.join("\n")
}
