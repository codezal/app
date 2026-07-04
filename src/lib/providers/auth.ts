// Auth chain resolver — apiKey → env var → oauth.
import type { Settings } from "@/store/types"
import type { ProviderInfo, ResolvedAuth, OAuthCredential } from "./types"
import { readEnvVar } from "./env-reader"
import { resolveSecret } from "@/lib/config/variable"
import { refreshCredentialIfNeeded } from "./oauth/refresh"

export async function resolveAuth(
  provider: ProviderInfo,
  settings: Settings,
): Promise<ResolvedAuth> {
  for (const method of provider.authMethods) {
    if (method === "apiKey") {
      const stored = settings.apiKeys?.[provider.id]
      if (stored && stored.trim()) {
        // The stored value may be a {env:VAR} / {file:path} token rather than a
        // literal key — resolve it here (in-memory only; the file keeps the token).
        const key = await resolveSecret(stored.trim())
        if (key && key.trim()) {
          return { kind: "apiKey", value: key.trim(), source: "user" }
        }
      }
    }
    if (method === "env") {
      if (!settings.envFallback) continue
      for (const varName of provider.envVars) {
        const val = await readEnvVar(varName)
        if (val && val.trim()) {
          return { kind: "apiKey", value: val.trim(), source: "env" }
        }
      }
    }
    if (method === "oauth") {
      const cred = settings.credentials?.[provider.id] as OAuthCredential | undefined
      if (cred && cred.accessToken) {
        // Renew if within the eager window (single source of truth in
        // oauth/refresh.ts); refresh is single-flighted across callers. A null
        // result means the token was unusable and could not be renewed — fall
        // through to the next auth method.
        const fresh = await refreshCredentialIfNeeded(provider.id, provider.oauthName, cred)
        if (fresh && fresh.accessToken) {
          return {
            kind: "oauth",
            accessToken: fresh.accessToken,
            refreshToken: fresh.refreshToken,
            expiresAt: fresh.expiresAt,
          }
        }
      }
    }
  }
  return { kind: "none" }
}

export function isConnectedSync(
  provider: ProviderInfo,
  settings: Settings,
  envHits?: Record<string, boolean>,
): boolean {
  if (provider.keyless) return true
  if (provider.custom) return true
  if (settings.apiKeys?.[provider.id]) return true
  // Only honour an OAuth credential if the provider still offers OAuth — a
  // leftover credential (e.g. Anthropic after OAuth was dropped) must not show
  // as connected once the auth method is gone.
  if (provider.authMethods.includes("oauth")) {
    const cred = settings.credentials?.[provider.id]
    if (cred && cred.accessToken) return true
  }
  if (settings.envFallback && envHits && provider.envVars.some((v) => envHits[v])) {
    return true
  }
  return false
}

export function activeAuthLabel(
  provider: ProviderInfo,
  settings: Settings,
  envHits: Record<string, boolean>,
): "apiKey" | "oauth" | "env" | null {
  if (settings.apiKeys?.[provider.id]) return "apiKey"
  if (provider.authMethods.includes("oauth")) {
    const cred = settings.credentials?.[provider.id]
    if (cred && cred.accessToken) return "oauth"
  }
  if (settings.envFallback && provider.envVars.some((v) => envHits[v])) return "env"
  return null
}
