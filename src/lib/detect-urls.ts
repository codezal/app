// Dev-server URL detection from terminal output.
//
// Scans raw PTY chunks (ANSI-stripped) for localhost / 127.0.0.1 / 0.0.0.0 URLs
// printed by dev servers — Vite ("Local:   http://localhost:5173/"), Next.js,
// CRA, etc. Surfaced to the browser-preview panel so the user can one-click open
// the running server. Pure + side-effect-free → unit-tested in node env.

// CSI escape sequences (colors, cursor moves) — strip before matching so a URL
// wrapped in color codes still matches.
// eslint-disable-next-line no-control-regex
const ANSI_RE = /\x1b\[[0-9;?]*[ -/]*[@-~]/g

export function stripAnsi(s: string): string {
  return s.replace(ANSI_RE, "")
}

export type DetectedUrl = { url: string; port: number }

// localhost / loopback URLs with an optional port and path. Port 2–5 digits.
const URL_RE =
  /https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0)(?::\d{2,5})?(?:\/[^\s"'`<>)\]]*)?/gi

function portOf(url: string): number {
  try {
    const u = new URL(url)
    if (u.port) return Number(u.port)
    return u.protocol === "https:" ? 443 : 80
  } catch {
    return 0
  }
}

// Normalize a matched URL: 0.0.0.0 → localhost (iframe can't load 0.0.0.0),
// strip trailing punctuation that logs often append, drop a lone trailing slash
// so "http://localhost:5173/" and "http://localhost:5173" dedupe.
function normalize(raw: string): string | null {
  let url = raw.replace(/[.,;:!?)\]]+$/, "")
  url = url.replace(/0\.0\.0\.0/gi, "localhost")
  try {
    const u = new URL(url)
    let out = u.origin
    if (u.pathname && u.pathname !== "/") out += u.pathname
    return out
  } catch {
    return null
  }
}

// Extract distinct dev-server URLs from a blob of terminal text.
export function detectUrls(text: string): DetectedUrl[] {
  const clean = stripAnsi(text)
  const out: DetectedUrl[] = []
  const seen = new Set<string>()
  for (const m of clean.matchAll(URL_RE)) {
    const url = normalize(m[0])
    if (!url || seen.has(url)) continue
    seen.add(url)
    out.push({ url, port: portOf(url) })
  }
  return out
}
