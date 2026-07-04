// Client version probe — resolves the latest published version of
// official coding-agent CLIs from the npm registry, so we can ship a
// realistic User-Agent header for the gated providers that whitelist
// those clients (Kimi For Coding, Z.AI Coding Plan, Zhipu Coding Plan).
//
// Caching: module-level promise. The fetch runs at most once per
// process; on app restart we ask the registry again. That's good enough —
// these versions change every few weeks and the failure mode (falling
// back to a hardcoded version) is harmless.
//
// Network errors fall back to a known-recent version. We do not throw,
// because UA tagging is a best-effort signal; the actual auth still goes
// through the API key.
import { tauriFetch } from "./tauri-fetch"

// Last-known-good versions used when npm registry is unreachable.
// Update opportunistically when touching nearby code.
const FALLBACK_VERSIONS = {
  claudeCli: "2.0.0",
} as const

const cache = new Map<string, Promise<string>>()

// Hit the npm registry's /<pkg>/latest endpoint. Returns `version` from
// the response, or the supplied fallback on any error.
function fetchLatestVersion(pkg: string, fallback: string): Promise<string> {
  const cached = cache.get(pkg)
  if (cached) return cached
  const p = (async () => {
    try {
      const url = `https://registry.npmjs.org/${encodeURIComponent(pkg)}/latest`
      const res = await tauriFetch(url, {
        headers: { Accept: "application/json" },
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = (await res.json()) as { version?: unknown }
      if (typeof data.version === "string" && data.version.length > 0) {
        return data.version
      }
      throw new Error("no version field in npm response")
    } catch (e) {
      console.warn(`[client-versions] ${pkg} fetch failed, using fallback`, e)
      return fallback
    }
  })()
  cache.set(pkg, p)
  return p
}

// Latest version of @anthropic-ai/claude-code (the Claude Code CLI).
// Used to assemble a `claude-cli/<version>` User-Agent for providers
// that whitelist Claude Code.
export function getClaudeCliVersion(): Promise<string> {
  return fetchLatestVersion("@anthropic-ai/claude-code", FALLBACK_VERSIONS.claudeCli)
}
