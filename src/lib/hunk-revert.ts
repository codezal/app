import type { DiffLine } from "./diff"

export function countHunks(lines: DiffLine[]): number {
  let n = 0
  let inHunk = false
  for (const l of lines) {
    if (l.kind === "ctx") inHunk = false
    else if (!inHunk) {
      n++
      inHunk = true
    }
  }
  return n
}

export function splitHunks(
  lines: DiffLine[],
  contextLines = 2,
): Array<{ index: number; display: DiffLine[] }> {
  const hunks: Array<{ index: number; display: DiffLine[] }> = []
  let idx = -1
  let i = 0
  while (i < lines.length) {
    if (lines[i].kind === "ctx") {
      i++
      continue
    }
    idx++
    const start = i
    while (i < lines.length && lines[i].kind !== "ctx") i++
    const before = lines.slice(Math.max(0, start - contextLines), start)
    const after = lines.slice(i, Math.min(lines.length, i + contextLines))
    hunks.push({ index: idx, display: [...before, ...lines.slice(start, i), ...after] })
  }
  return hunks
}

export function revertHunk(lines: DiffLine[], hunkIndex: number): string {
  const out: string[] = []
  let idx = -1
  let i = 0
  while (i < lines.length) {
    if (lines[i].kind === "ctx") {
      out.push(lines[i].text)
      i++
      continue
    }
    idx++
    const dels: string[] = []
    const adds: string[] = []
    while (i < lines.length && lines[i].kind !== "ctx") {
      if (lines[i].kind === "del") dels.push(lines[i].text)
      else adds.push(lines[i].text)
      i++
    }
    out.push(...(idx === hunkIndex ? dels : adds))
  }
  return out.join("\n")
}
