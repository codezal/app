// file:// URI ↔ path helpers (cross-platform: POSIX + Windows drive letters).

export function uriToPath(uri: string): string {
  if (!uri.startsWith("file:")) return uri
  let p = uri.replace(/^file:\/\//, "")
  // Windows: /C:/... → C:/...
  p = p.replace(/^\/([A-Za-z]:)/, "$1")
  try {
    p = decodeURIComponent(p)
  } catch {
    // Intentionally ignored.
  }
  return p
}

function norm(value: string): string {
  let s = uriToPath(value).replace(/\\/g, "/").replace(/\/+$/, "")
  if (/^[A-Za-z]:/.test(s)) s = s.toLowerCase()
  return s
}

export function uriMatchesPath(uri: string, path: string): boolean {
  return norm(uri) === norm(path)
}
