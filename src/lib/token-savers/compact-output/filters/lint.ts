// Lint filter — ESLint, Biome, Prettier, Ruff. Keep file:line:col + message,
// drop stacks of cosmetic notes that wrap each rule output. Summary stays.

import { genericFilter } from "./generic"

const FILE_HEADER_RE = /^\S.*\.(?:js|jsx|ts|tsx|py|rs|go|java|kt|swift|rb|php|css|scss|html|json|md)$/i
const DIAGNOSTIC_RE = /^\s*\d+:\d+\s+(error|warning|info)/i
const SUMMARY_RE = /(problems?|errors?|warnings?)\b.*(\d+)/i

export function lintFilter(raw: string): string {
  const base = genericFilter(raw)
  const lines = base.split("\n")
  const out: string[] = []
  for (const ln of lines) {
    if (FILE_HEADER_RE.test(ln.trimEnd())) {
      out.push(ln)
      continue
    }
    if (DIAGNOSTIC_RE.test(ln)) {
      out.push(ln)
      continue
    }
    if (SUMMARY_RE.test(ln)) {
      out.push(ln)
      continue
    }
    // Drop empty padding lines around individual diagnostics.
    if (ln.trim() === "") {
      if (out[out.length - 1]?.trim() === "") continue
      out.push(ln)
      continue
    }
    // Default keep — many linters print extra "fix help" lines that are still
    // informative. We accept some noise rather than drop diagnostics by accident.
    out.push(ln)
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim()
}
