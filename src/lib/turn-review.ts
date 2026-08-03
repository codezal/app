// Post-turn change review — risk classification.
//
// Mirrors the spirit of Reasonix's risk-adaptive review gate, but scoped to an
// interactive desktop assistant: instead of BLOCKING delivery, the risk level
// only decides how prominently the "Review changes" action is surfaced after a
// turn that modified files (see components/TurnDiffViewer.tsx). A model review
// of the working-tree diff is always one click away; high-risk turns simply
// draw attention to it. Pure, dependency-free, synchronous and node-testable —
// the same design constraints as the rest of lib/security.
//
// Risk tiers:
//  - high:   a touched path can execute code (shell rc, git hook/config, build
//            config — reused from security/sensitive-paths) OR sits in a
//            security/auth/crypto/payment/migration area. Worth an immediate
//            model review, so the button is emphasized.
//  - low:    docs / tests / styles / lockfiles / i18n only — a bug-review rarely
//            pays off, so the button stays neutral.
//  - medium: everything else (ordinary production code).

import { classifySensitiveWrite } from "@/lib/security/sensitive-paths"

export type TurnRisk = "low" | "medium" | "high"

// Security- / correctness-sensitive path fragments. Matched case-insensitively
// against the forward-slash-normalized path, requiring a leading boundary
// (start, "/", ".", "-" or "_") so a keyword may begin a longer segment
// ("auth" matches "authentication.ts") without matching arbitrary substrings.
// Deliberately a focused set — broad terms like "config" or "http" would flag
// most ordinary files and train users to ignore the emphasis.
const HIGH_RE =
  /(?:^|[/.\-_])(auth|login|signin|signup|session|oauth|jwt|sso|crypto|encrypt|decrypt|cipher|secret|token|password|passwd|credential|permission|rbac|acl|payment|billing|invoice|stripe|webhook|security|secure|sanitiz|escap|migration|migrate)/i

// Low-value targets where an LLM bug-review rarely adds anything. A turn is
// "low" only when EVERY touched file matches — one production file alongside a
// test already bumps the whole turn to "medium".
const LOW_RE =
  /(\.test\.|\.spec\.|__tests__|__mocks__|__snapshots__|\.snap$|\.md$|\.mdx$|\.css$|\.scss$|\.sass$|\.less$|\.svg$|\.png$|\.jpe?g$|\.gif$|\.ico$|\.lock$|lock\.json$|\.lockb$|readme|changelog|license|\.editorconfig|\.gitignore|\.prettierrc|\.eslintrc|locales?\/|i18n\/|translations?\/)/i

// Classify the set of files a turn touched. Never throws; empty input is "low".
// Execution-granting destinations (via classifySensitiveWrite) and security-area
// paths win immediately; otherwise the turn is "low" only if every file is a
// doc/test/style/lockfile, and "medium" for ordinary production code.
export function classifyTurnRisk(files: readonly string[]): TurnRisk {
  if (files.length === 0) return "low"
  let allLow = true
  for (const raw of files) {
    const path = raw.replace(/\\/g, "/")
    if (classifySensitiveWrite(path)) return "high"
    if (HIGH_RE.test(path)) return "high"
    if (!LOW_RE.test(path)) allLow = false
  }
  return allLow ? "low" : "medium"
}
