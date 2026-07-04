// Network egress allowlist — host matching for plugins that declare
// `network.fetch`.
//
// Why: `network.fetch` alone says "this plugin talks to the internet" but not
// to whom. A malicious plugin granted that permission could POST the user's
// source / API keys to an attacker host. The manifest's `network.allowedHosts`
// turns the open permission into a declared, enforceable destination set that
// the install dialog shows and the runtime enforces.
//
// Enforcement points
// ------------------
// 1. `PluginAPI.fetch` (sandbox.ts) — the fetch we hand plugins is wrapped to
//    reject non-allowlisted hosts. Cooperative: a plugin could still reach for
//    a strong default, not an airtight boundary.
// 2. MCP http/sse server URLs (loader.ts + sandbox.ts) — when a plugin declares
//    `network.allowedHosts`, any http/sse MCP endpoint it registers must match.
//
// Matching rules
// --------------
// - Exact host: "api.openai.com" matches only that host.
// - Wildcard subdomain: "*.openai.com" matches "openai.com" AND any subdomain
//   ("api.openai.com", "a.b.openai.com").
// - "*" matches everything — discouraged, surfaced as a loud warning in the UI.
// - Case-insensitive. Port + path are ignored (host only).
// - Empty / absent allowlist = deny all (fail-closed).

// Normalize: lowercase, strip surrounding whitespace.
function norm(s: string): string {
  return s.trim().toLowerCase()
}

// Is `host` permitted by the `allowed` patterns? See matching rules above.
export function hostAllowed(host: string, allowed: string[] | undefined): boolean {
  if (!host || !allowed || allowed.length === 0) return false
  const h = norm(host)
  for (const raw of allowed) {
    const p = norm(raw)
    if (!p) continue
    if (p === "*") return true
    if (p.startsWith("*.")) {
      const apex = p.slice(2)
      if (apex && (h === apex || h.endsWith("." + apex))) return true
    } else if (h === p) {
      return true
    }
  }
  return false
}

// Extract the host from a URL string; null if unparseable.
export function hostFromUrl(url: string): string | null {
  try {
    return new URL(url).hostname
  } catch {
    return null
  }
}

// Assert a URL's host is allowlisted. Returns null if allowed, an error string
// if denied (so callers can log / audit without try-catch noise).
export function checkUrlAllowed(url: string, allowed: string[] | undefined): string | null {
  const host = hostFromUrl(url)
  if (!host) return `geçersiz URL: "${url}"`
  if (!hostAllowed(host, allowed)) {
    return `host allowlist dışı: "${host}" (izinli: ${(allowed ?? []).join(", ") || "yok"})`
  }
  return null
}
