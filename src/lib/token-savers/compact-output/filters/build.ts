// Build filter — for compilers/bundlers (tsc, vite/next build, cargo build).
// Strategy: keep error/warning lines and final summary, drop progress lines.

import { genericFilter } from "./generic"

const ERROR_RE = /\b(error|err|fatal|fail|warning|warn)[: ]/i
const TS_DIAGNOSTIC_RE = /^[^:\n]+\(\d+,\d+\):\s*(error|warning)/
const PROGRESS_RE = /^(\s*Compiling|\s*Building|\s*Bundling|\s*Resolving|\s*Computing|\s*Optimizing|\s*Finished|\s*Compiled|\s*Built|\s*\d+%\s|\s*\[\d+\/\d+\])/

export function buildFilter(raw: string): string {
  const base = genericFilter(raw)
  const lines = base.split("\n")
  const kept: string[] = []
  for (const ln of lines) {
    if (TS_DIAGNOSTIC_RE.test(ln)) {
      kept.push(ln)
      continue
    }
    if (ERROR_RE.test(ln)) {
      kept.push(ln)
      continue
    }
    if (PROGRESS_RE.test(ln)) continue
    if (ln.trim() === "") {
      if (kept[kept.length - 1]?.trim() === "") continue
      kept.push(ln)
      continue
    }
    // Default: keep — being conservative on builds because diagnostics often
    // span multiple lines (caret pointer, surrounding source).
    kept.push(ln)
  }
  return kept.join("\n").replace(/\n{3,}/g, "\n\n").trim()
}
