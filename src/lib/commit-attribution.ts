// Single source of truth for the commit attribution trailer Codezal appends to
// commits, plus a normalizer that strips any stray / wrong / duplicated
// Co-Authored-By lines (for example a model hallucinating noreply@anthropic.com)
// and leaves exactly one correct trailer.

export const COMMIT_ATTRIBUTION_TRAILER = "Co-Authored-By: Codezal <noreply@codezal.com>"

// Any Co-Authored-By trailer line, regardless of email, domain or letter case.
// Matched per line so a stray trailer anywhere in the message is removed.
const ATTRIBUTION_LINE = /^[ \t]*Co-Authored-By:[^\n]*\r?\n?/gim

/**
 * Normalize the Co-Authored-By attribution of a commit message.
 *
 * Removes every existing `Co-Authored-By:` line — wrong emails such as
 * `noreply@anthropic.com`, duplicates, or misplaced lines — and, when
 * attribution is enabled, appends exactly one correct trailer. When no real
 * body is left after stripping (for example an amend with an empty message
 * box) the trailer is NOT appended, so we never produce a subject-less commit.
 */
export function normalizeCommitAttribution(message: string, enabled: boolean): string {
  const stripped = message.replace(ATTRIBUTION_LINE, "").replace(/[ \t\r\n]+$/, "")
  if (!enabled) return stripped
  if (stripped.trim().length === 0) return stripped
  return `${stripped}\n\n${COMMIT_ATTRIBUTION_TRAILER}`
}
