//

// Case-insensitive matching applies on every platform (see wildcardMatch) —
// the platform detector is no longer needed.
export function wildcardMatch(input: string, pattern: string): boolean {
  const normalized = input.replaceAll("\\", "/")
  let escaped = pattern
    .replaceAll("\\", "/")
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*")
    .replace(/\?/g, ".")

  if (escaped.endsWith(" .*")) escaped = escaped.slice(0, -3) + "( .*)?"

  // M76: case-insensitive on Windows (and on macOS's default APFS volumes,
  // which are case-insensitive too) so a permission/allowlist pattern matches
  // regardless of case on every major desktop FS. Explicit case-sensitive
  // matching is not available; the permission engine's deny rules only ever
  // get WIDER with case-insensitivity (safer, not leakier).
  return new RegExp("^" + escaped + "$", "si").test(normalized)
}

export function hasGlob(pattern: string): boolean {
  return pattern.includes("*") || pattern.includes("?")
}
