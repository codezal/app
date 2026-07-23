//
// Algoritma deepseekgui Token Economy (compressProse) portu:
//   1) Teknik segmentleri (kod, yol, URL, identifier, semver) KORU → placeholder
//

const FILLERS_RE =
  /\b(?:just|really|basically|actually|simply|quite|very|essentially|literally|generally)\b/gi
const PLEASANTRIES_RE =
  /\b(?:please|kindly|thank you|thanks|sure|certainly|of course|happy to|i'?d be happy)\b[,.]?\s*/gi
const HEDGES_RE =
  /\b(?:perhaps|maybe|might|could potentially|would like to|i think|in my opinion|it seems|it appears)\b\s*/gi
const LEADERS_RE =
  /^(?:i'?ll|i will|i can|i'?d|you can|we will|we can|let me|let'?s)\s+/gim
// Articles are NOT stripped: they save ~1-2 tokens per description but cause
// semantic ambiguity ("edit file" vs "edit the file") that confuses smaller
// models and degrades tool-calling accuracy. The token savings are negligible
// compared to the other compression passes.

const PROTECTED_SEGMENT_PREFIX = "__CZ_PROTECTED_"
const PROTECTED_SEGMENT_SUFFIX = "__"

// inline kod, URL, yol, CONST_CASE, dotted.call(), fn(args), semver.
const PROTECTED_PATTERNS = [
  /```[\s\S]*?```/g,
  /`[^`\n]+`/g,
  /\bhttps?:\/\/\S+/gi,
  /\b[\w.-]*[/\\][\w./\\-]+/g,
  /\b[A-Z][A-Za-z0-9]*(?:_[A-Z][A-Za-z0-9]*)+\b/g,
  /\b\w+\.\w+(?:\.\w+)*\(\)?/g,
  /[A-Za-z_][A-Za-z0-9_]*\s*\([^)]*\)/g,
  /\b\d+\.\d+\.\d+\b/g,
]

function withProtectedSegments(text: string, transform: (text: string) => string): string {
  const segments: string[] = []
  let working = text
  for (const pattern of PROTECTED_PATTERNS) {
    working = working.replace(pattern, (match) => {
      const index = segments.length
      segments.push(match)
      return `${PROTECTED_SEGMENT_PREFIX}${index}${PROTECTED_SEGMENT_SUFFIX}`
    })
  }
  const markerRe = new RegExp(`${PROTECTED_SEGMENT_PREFIX}(\\d+)${PROTECTED_SEGMENT_SUFFIX}`, "g")
  return transform(working).replace(markerRe, (_match, index: string) => segments[Number(index)] ?? "")
}

export function compressProse(text: string): string {
  if (!text.trim()) return text
  return withProtectedSegments(text, (value) => {
    let out = value
    out = out.replace(LEADERS_RE, "")
    out = out.replace(PLEASANTRIES_RE, "")
    out = out.replace(HEDGES_RE, "")
    out = out.replace(FILLERS_RE, "")
    out = out.replace(/[ \t]{2,}/g, " ")
    out = out.replace(/\s+([,.;:!?])/g, "$1")
    out = out.replace(/\n{3,}/g, "\n\n")
    return out.trim()
  })
}
