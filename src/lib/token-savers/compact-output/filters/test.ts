// Test filter — keep failures, drop pass-stream noise. Works for vitest, jest,
// mocha, pytest, cargo test, go test outputs. Heuristic: lines that look like
// progress ticks ("✓", "PASS", "RUNS") get dropped; FAIL blocks and summary
// stay.

import { genericFilter } from "./generic"

const PASS_TICK_RE = /^(✓|✓|PASS|RUNS|RUN |ok\s+\d+|test\s+\S+\s+\.\.\.\s+ok)/
const FAIL_TICK_RE = /^(✗|✗|FAIL|FAILED|✘|not ok\s+\d+|ERROR|--- FAIL:)/
const SUMMARY_RE = /(Tests?:|Test Files?|Suites?:|Snapshots?:|Time:|Duration|test result:|passed|failed|skipped|todo)/i

export function testFilter(raw: string): string {
  const base = genericFilter(raw)
  const lines = base.split("\n")
  const out: string[] = []

  let inFailBlock = false
  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i] ?? ""

    if (FAIL_TICK_RE.test(ln.trimStart())) {
      inFailBlock = true
      out.push(ln)
      continue
    }

    // Indented continuation under a FAIL block — keep it (stack traces, expected/received).
    if (inFailBlock && /^\s/.test(ln)) {
      out.push(ln)
      continue
    }

    // End of fail block when a non-indented non-fail line appears.
    if (inFailBlock && !/^\s/.test(ln)) {
      inFailBlock = false
    }

    if (PASS_TICK_RE.test(ln.trimStart())) continue
    if (SUMMARY_RE.test(ln)) {
      out.push(ln)
      continue
    }
    // Keep stderr-ish lines or anything not obviously a tick.
    if (ln.trim().length === 0) {
      if (out[out.length - 1]?.length === 0) continue
      out.push(ln)
      continue
    }
    out.push(ln)
  }

  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim()
}
