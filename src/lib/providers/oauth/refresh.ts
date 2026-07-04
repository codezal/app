// OAuth credential freshness + refresh — single source of truth for "is this
// token still good, and if not, renew it" across every provider.
//
// Two problems this solves:
//   1. Dead refresh path. resolveAuth used to drop an expired OAuth credential
//      and return `none`, so the flow's refresh() was never called — an expired
//      Claude Pro / Copilot session silently forced a re-login. We now renew.
//   2. Refresh stampede. Codezal fans work out across parallel orchestra
//      runners; with an expired token they would all hit the refresh endpoint at
//      once. Anthropic rotates the refresh_token on each call, so concurrent
//      refreshes race and all but one 401. A per-provider in-flight map collapses
//      concurrent refreshes into a single request whose result everyone awaits.
import { getOAuthFlow } from "./index"
import type { OAuthCredential, ProviderId } from "../types"

// Renew this far ahead of the hard expiry so a request never goes out with a
// token that lapses mid-flight. 5 min mirrors OpenCode's eager window and
// replaces the old 60s buffer that was duplicated across call sites.
export const EAGER_REFRESH_MS = 5 * 60 * 1000

// A credential is "fresh" when it has no expiry, or its expiry is more than the
// eager window away. Exported so UI / connection checks share the same notion.
export function isCredentialFresh(cred: OAuthCredential, now: number = Date.now()): boolean {
  return !cred.expiresAt || now < cred.expiresAt - EAGER_REFRESH_MS
}

// Per-provider in-flight refresh. Keyed by providerId so two providers refresh
// independently but one provider never refreshes twice concurrently.
const inflight = new Map<ProviderId, Promise<OAuthCredential | null>>()

// Return a usable credential for this provider, refreshing first if it is within
// the eager window (or already expired). Returns null when the credential is
// unusable and could not be renewed (caller then falls back to the next auth
// method, or surfaces "no credentials").
export async function refreshCredentialIfNeeded(
  providerId: ProviderId,
  oauthName: string | undefined,
  cred: OAuthCredential,
): Promise<OAuthCredential | null> {
  if (isCredentialFresh(cred)) return cred

  const existing = inflight.get(providerId)
  if (existing) return existing

  const task = doRefresh(providerId, oauthName, cred).finally(() => {
    inflight.delete(providerId)
  })
  inflight.set(providerId, task)
  return task
}

async function doRefresh(
  providerId: ProviderId,
  oauthName: string | undefined,
  cred: OAuthCredential,
): Promise<OAuthCredential | null> {
  const flow = oauthName ? getOAuthFlow(oauthName) : undefined
  // No refresh capability: keep using the token until its hard expiry, then
  // treat it as unusable.
  if (!flow?.refresh) {
    return cred.expiresAt && Date.now() >= cred.expiresAt ? null : cred
  }

  let next: OAuthCredential | null
  try {
    next = await flow.refresh(cred)
  } catch {
    next = null
  }

  // Persist the outcome through the settings store (keychain + in-memory mirror
  // + stripped disk write). Dynamic import keeps providers/ free of a static
  // dependency on the store, avoiding an import cycle. On a failed refresh we
  // clear the credential so the UI shows the provider as disconnected rather
  // than wedged on a dead token.
  try {
    const { useSettingsStore } = await import("@/store/settings")
    await useSettingsStore.getState().setCredential(providerId, next ?? null)
  } catch {
    // Persist failure is non-fatal — the returned cred still serves this call.
  }

  return next
}
