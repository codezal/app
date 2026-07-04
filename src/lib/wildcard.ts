//

// userAgent ("Windows NT" daima mevcut).
function detectWindows(): boolean {
  if (typeof navigator === "undefined") return false
  const uaData = (navigator as { userAgentData?: { platform?: string } }).userAgentData
  if (uaData?.platform) return /win/i.test(uaData.platform)
  if (navigator.platform) return /win/i.test(navigator.platform)
  return /windows/i.test(navigator.userAgent || "")
}
const IS_WINDOWS = detectWindows()

// input, pattern glob'una uyuyor mu?
export function wildcardMatch(input: string, pattern: string): boolean {
  const normalized = input.replaceAll("\\", "/")
  let escaped = pattern
    .replaceAll("\\", "/")
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*")
    .replace(/\?/g, ".")

  if (escaped.endsWith(" .*")) escaped = escaped.slice(0, -3) + "( .*)?"

  return new RegExp("^" + escaped + "$", IS_WINDOWS ? "si" : "s").test(normalized)
}

export function hasGlob(pattern: string): boolean {
  return pattern.includes("*") || pattern.includes("?")
}
