// Detect the "kind" of a shell command from its raw text so the correct
// compaction filter can be selected. Conservative — when in doubt return
// "generic" (lossless dedupe + ANSI strip).
//
// We look at the first non-empty token and, when relevant, the immediate
// subcommand. Composed commands (`a && b` or `a; b`) are detected by the FIRST
// segment — chained command output is mixed and compacting on the head is the
// pragmatic compromise.

export type CommandKind =
  | "git"
  | "test"
  | "build"
  | "lint"
  | "grep"
  | "pkg"
  | "generic"

const TEST_RUNNERS = /^(vitest|jest|mocha|playwright|cypress|pytest|rspec|cargo\s+test|go\s+test|rake\s+test)\b/
const BUILD_TOOLS = /^(tsc|next\s+build|vite\s+build|webpack|rollup|cargo\s+build|cargo\s+check|cargo\s+clippy|go\s+build|gradle\s+build|mvn\s+package)\b/
const LINT_TOOLS = /^(eslint|biome|prettier|ruff|black|stylelint|clippy)\b/
const PKG_TOOLS = /^(npm\s+(install|i|ci|update|outdated|list|ls)|pnpm\s+(install|i|update|outdated|list|ls)|yarn\s+(install|add|upgrade|outdated|list)|npx\s+|bunx\s+|pip\s+install|cargo\s+install|brew\s+(install|upgrade|outdated))\b/
const GREP_TOOLS = /^(grep|rg|ripgrep|ag|ack)\b/

export function detect(command: string): CommandKind {
  // Take the head of the command — first segment before "&&", ";", "|", or
  // line break. Strip leading "rtk " wrapper if present (works either way).
  const head = command
    .replace(/^\s*rtk\s+/, "")
    .split(/&&|;|\|\||\|(?!\|)|\n/)[0]
    ?.trim()
  if (!head) return "generic"

  // git is special because subcommand drives behavior — but all git output
  // shares the same filter, so we only care that it's git.
  if (/^git(\s|$)/.test(head)) return "git"
  if (TEST_RUNNERS.test(head)) return "test"
  if (BUILD_TOOLS.test(head)) return "build"
  if (LINT_TOOLS.test(head)) return "lint"
  if (GREP_TOOLS.test(head)) return "grep"
  if (PKG_TOOLS.test(head)) return "pkg"
  return "generic"
}
