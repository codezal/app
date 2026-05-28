// Grep filter — collapse many matches per file into "file: N matches". If
// fewer than a threshold per file, keep individual lines (the model needs the
// line content to act).

import { genericFilter } from "./generic"

const PER_FILE_KEEP = 5
const FILE_MATCH_RE = /^([^:\n]+):(\d+):(.*)$/

export function grepFilter(raw: string): string {
  const base = genericFilter(raw)
  const lines = base.split("\n")

  // Bucket lines by file.
  const buckets = new Map<string, string[]>()
  const passthrough: string[] = []
  for (const ln of lines) {
    const m = FILE_MATCH_RE.exec(ln)
    if (!m) {
      passthrough.push(ln)
      continue
    }
    const file = m[1] ?? ""
    if (!buckets.has(file)) buckets.set(file, [])
    buckets.get(file)!.push(ln)
  }

  const out: string[] = []
  for (const ln of passthrough) {
    if (ln.trim() !== "") out.push(ln)
  }
  for (const [file, hits] of buckets) {
    if (hits.length <= PER_FILE_KEEP) {
      out.push(...hits)
    } else {
      out.push(...hits.slice(0, PER_FILE_KEEP))
      out.push(`${file}: + ${hits.length - PER_FILE_KEEP} more matches`)
    }
  }
  return out.join("\n").trim()
}
