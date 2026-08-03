// file:// URI ↔ path helpers (cross-platform: POSIX + Windows drive letters).

export function uriToPath(uri: string): string {
  if (!uri.startsWith("file:")) return uri
  const rest = uri.slice("file:".length)
  let p: string
  if (rest.startsWith("//")) {
    // Authority component: file://host/share, file://localhost/…, file:///path.
    const after = rest.slice(2)
    const slash = after.indexOf("/")
    const host = slash === -1 ? after : after.slice(0, slash)
    const pathPart = slash === -1 ? "" : after.slice(slash)
    if (host === "" || host === "localhost") {
      p = pathPart || "/"
    } else {
      // UNC share (file://server/share) — keep the host; dropping it yields a
      // bogus relative path on Windows (M33).
      p = "//" + host + pathPart
    }
  } else {
    p = rest
  }
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
  // UNC share hosts are case-insensitive on Windows too.
  if (s.startsWith("//")) s = s.toLowerCase()
  return s
}

export function uriMatchesPath(uri: string, path: string): boolean {
  return norm(uri) === norm(path)
}
