// Auth chain resolver — apiKey → env var → oauth.
// Provider'ın authMethods listesi sırayla kontrol edilir; ilk dolu olan döner.
// OAuth tokenleri settings.credentials'tan; env varlar Tauri komut üzerinden okunur.
import type { Settings } from "@/store/types"
import type { ProviderInfo, ResolvedAuth, OAuthCredential } from "./types"
import { readEnvVar } from "./env-reader"

// Bir provider için credential çöz. authMethods sırasıyla denenir.
// async — env okuma Tauri IPC üzerinden gider.
export async function resolveAuth(
  provider: ProviderInfo,
  settings: Settings,
): Promise<ResolvedAuth> {
  for (const method of provider.authMethods) {
    if (method === "apiKey") {
      const key = settings.apiKeys?.[provider.id]
      if (key && key.trim()) {
        return { kind: "apiKey", value: key.trim(), source: "user" }
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
        // Refresh window: 60s buffer
        const stillValid = !cred.expiresAt || Date.now() < cred.expiresAt - 60_000
        if (stillValid) {
          return {
            kind: "oauth",
            accessToken: cred.accessToken,
            refreshToken: cred.refreshToken,
            expiresAt: cred.expiresAt,
          }
        }
        // expired — caller refresh akışını tetikler (oauth/<provider>.ts içinde)
      }
    }
  }
  return { kind: "none" }
}

// Provider'ın "bağlı" olup olmadığını sync olarak hızlıca bil (UI badge için).
// Env fallback bu kontrolde dahil değildir (async gerek); env durumu ayrı
// `checkEnvStatus(provider)` ile alınır.
export function isConnectedSync(provider: ProviderInfo, settings: Settings): boolean {
  if (settings.apiKeys?.[provider.id]) return true
  const cred = settings.credentials?.[provider.id]
  if (cred && cred.accessToken) return true
  return false
}

// UI için: provider için aktif auth metodu (badge metni).
export function activeAuthLabel(
  provider: ProviderInfo,
  settings: Settings,
  envHits: Record<string, boolean>,
): "apiKey" | "oauth" | "env" | null {
  if (settings.apiKeys?.[provider.id]) return "apiKey"
  const cred = settings.credentials?.[provider.id]
  if (cred && cred.accessToken) return "oauth"
  if (settings.envFallback && provider.envVars.some((v) => envHits[v])) return "env"
  return null
}
