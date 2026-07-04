// Transient-retry wrapper for OAuth token endpoints.
//
// Token refresh and the Copilot token exchange used to be single-shot: one
// network blip (DNS hiccup, captive-portal redirect, a 503 from the IdP) and
// refresh() returned null, bouncing the user back to a full re-login. These
// calls are idempotent, so a few bounded retries on transient failures turn a
// flaky network into a brief pause instead of a logout.
//
// We retry only on signals that a retry could plausibly fix: a thrown fetch
// (network down) or a 5xx / 429 from the server. 4xx (bad code, revoked token)
// is returned immediately — retrying can't help and only delays the error.
//
// Requests go through tauriFetch (plugin-http / native HTTP), not the webview's
// global fetch — OAuth IdP endpoints don't send CORS headers for the app origin,
// so a global fetch would fail with "Load failed" before any retry could help.
import { tauriFetch } from "../tauri-fetch"

const DEFAULT_TRIES = 3
const BASE_DELAY_MS = 500

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

function isTransientStatus(status: number): boolean {
  return status === 429 || status >= 500
}

// fetch() with bounded retries on transient failures. Returns the final
// Response (which may still be non-ok for a non-transient status); throws only
// if every attempt threw at the network layer.
export async function fetchWithRetry(
  input: string,
  init?: RequestInit,
  tries: number = DEFAULT_TRIES,
): Promise<Response> {
  let lastError: unknown
  for (let attempt = 0; attempt < tries; attempt++) {
    if (attempt > 0) await sleep(BASE_DELAY_MS * 2 ** (attempt - 1))
    try {
      const res = await tauriFetch(input, init)
      // Retry transient server states; return anything else (incl. 4xx) as-is.
      if (isTransientStatus(res.status) && attempt < tries - 1) continue
      return res
    } catch (e) {
      // Network-layer failure — remember it and retry until tries exhausted.
      lastError = e
    }
  }
  throw lastError ?? new Error("fetchWithRetry: request failed")
}
