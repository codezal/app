// Build filter — for compilers/bundlers (tsc, vite/next build, cargo build).
// Strategy: keep error/warning lines and final summary, drop progress lines.

import { genericFilter } from "./generic"

const ERROR_RE = /\b(error|err|fatal|fail|warning|warn)[: ]/i
const TS_DIAGNOSTIC_RE = /^[^:\n]+\(\d+,\d+\):\s*(error|warning)/
const PROGRESS_RE = /^(\s*Compiling|\s*Building|\s*Bundling|\s*Resolving|\s*Computing|\s*Optimizing|\s*Finished|\s*Compiled|\s*Built|\s*\d+%\s|\s*\[\d+\/\d+\])/
// Final success summaries ("Finished `dev` in 2.3s", "Built in 1.2s",
// "Compiled successfully in 340ms") start with a PROGRESS_RE verb but carry the
// build outcome + duration — the model needs them. Keep lines with a duration
// or an explicit success token even when PROGRESS_RE matches.
const SUCCESS_SUMMARY_RE = /(?:\bin\s+[\d.]+\s*(?:ms|msec|msecs|s|sec|secs|second|seconds|m|min|mins|minute|minutes|h|hr|hrs|hour|hours)\b|\bsuccessfully\b|✓|\bdone\b)/i

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
    if (PROGRESS_RE.test(ln) && !SUCCESS_SUMMARY_RE.test(ln)) continue
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
