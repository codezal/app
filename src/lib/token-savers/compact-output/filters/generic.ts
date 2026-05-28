// Generic filter — applied to any shell output, also used as a base layer by
// the other filters. Two passes:
//   1. Strip ANSI escape sequences (colors, cursor moves) — model never needs
//      these and they pollute tokens.
//   2. Collapse consecutive identical lines to "line (× N)".
//
// Carriage-return progress lines (e.g. download bars rewriting the same line)
// have already been flattened to many duplicate lines by the time we see them.

const ANSI_RE = /\x1b\[[0-9;?]*[ -/]*[@-~]/g

export function stripAnsi(s: string): string {
  return s.replace(ANSI_RE, "")
}

export function dedupeRuns(s: string): string {
  const lines = s.split("\n")
  const out: string[] = []
  let prev: string | null = null
  let run = 0
  for (const ln of lines) {
    if (ln === prev) {
      run += 1
      continue
    }
    if (prev !== null && run > 1) {
      out.push(`${prev} (× ${run})`)
    } else if (prev !== null) {
      out.push(prev)
    }
    prev = ln
    run = 1
  }
  if (prev !== null) {
    if (run > 1) out.push(`${prev} (× ${run})`)
    else out.push(prev)
  }
  return out.join("\n")
}

export function genericFilter(raw: string): string {
  return dedupeRuns(stripAnsi(raw))
}
