// Package manager filter — npm/pnpm/yarn install/update. Drop the progress
// rain (downloading, extracting, fetching) and keep changes summary.

import { genericFilter } from "./generic"

const NOISE_RE = /^(?:\s*(?:idealTree|reify:|fetch:|fetched|extract:|extracted|http\s+fetch|added\s+\d+|removed\s+\d+|changed\s+\d+|audited\s+|updated\s+|✱|\.\.\.))/i
const KEEP_RE = /\b(added|removed|updated|warn|error|deprecated|peer\s+dep|funding|vulnerabilit)/i
const PROGRESS_RE = /^Progress:\s*\[|^Downloading\b|^Resolving\b|^Linking\b/i

export function pkgFilter(raw: string): string {
  const base = genericFilter(raw)
  const lines = base.split("\n")
  const out: string[] = []
  for (const ln of lines) {
    if (PROGRESS_RE.test(ln)) continue
    if (NOISE_RE.test(ln) && !KEEP_RE.test(ln)) continue
    if (ln.trim() === "") {
      if (out[out.length - 1]?.trim() === "") continue
      out.push(ln)
      continue
    }
    out.push(ln)
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim()
}
