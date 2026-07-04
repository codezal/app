// Pure string helpers (zero deps — safe to import from any module).

// Truncate a string to at most `maxChars` UTF-16 code units WITHOUT splitting a
// surrogate pair. A naive `text.slice(0, n)` can cut between the high and low
// surrogate of an astral char (most emoji, e.g. 😀 = U+1F600), leaving a lone
// high surrogate. That lone surrogate serializes to an invalid UTF-8 sequence and
// some APIs reject the request (HTTP 400 "no low surrogate in string"). We slice
// normally, then drop a trailing lone high surrogate (0xD800–0xDBFF) — O(1), no
// full code-point walk, so it stays cheap even on very large strings.
export function sliceCharsSafe(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text
  let end = maxChars
  const last = text.charCodeAt(end - 1)
  // High surrogate with no following low surrogate (the low one is at index `end`,
  // which we're cutting off) → drop it so we never emit an unpaired surrogate.
  if (last >= 0xd800 && last <= 0xdbff) end -= 1
  return text.slice(0, end)
}
