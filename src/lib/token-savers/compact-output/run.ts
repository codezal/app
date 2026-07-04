// Compact Output entry — wraps the per-kind filters and adds a one-line
// footer with savings ratio so the model can see how aggressive the filter was.

import type { CompactOutputSettings } from "../types"
import { formatBytes } from "@/lib/format"
import { detect, type CommandKind } from "./detect"
import { genericFilter } from "./filters/generic"
import { gitFilter } from "./filters/git"
import { testFilter } from "./filters/test"
import { buildFilter } from "./filters/build"
import { lintFilter } from "./filters/lint"
import { grepFilter } from "./filters/grep"
import { pkgFilter } from "./filters/pkg"

function runFilter(kind: CommandKind, raw: string): string {
  switch (kind) {
    case "git":
      return gitFilter(raw)
    case "test":
      return testFilter(raw)
    case "build":
      return buildFilter(raw)
    case "lint":
      return lintFilter(raw)
    case "grep":
      return grepFilter(raw)
    case "pkg":
      return pkgFilter(raw)
    case "generic":
      return genericFilter(raw)
  }
}

export function applyCompact(
  command: string,
  raw: string,
  cfg: CompactOutputSettings,
): string {
  if (!cfg.enabled) return raw
  const kind = detect(command)
  // Respect per-kind toggle. When disabled for this kind, return raw.
  if (!cfg.filters[kind]) return raw

  const before = raw.length
  const filtered = runFilter(kind, raw)
  const after = filtered.length

  // Add a footer only when meaningful compression happened so we don't
  // pollute small outputs.
  if (before > 1000 && after < before * 0.85) {
    const pct = Math.round((1 - after / before) * 100)
    return `${filtered}\n[compacted: ${formatBytes(before)} → ${formatBytes(after)}, -${pct}% · filter=${kind}]`
  }
  return filtered
}
