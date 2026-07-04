//
//
import { fetch as tauriHttpFetch } from "@tauri-apps/plugin-http"

type FetchLike = typeof fetch

function isTauri(): boolean {
  if (typeof window === "undefined") return false
  // Tauri 2 webview global'i: __TAURI_INTERNALS__
  return Boolean((window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__)
}

export const tauriFetch: FetchLike = ((...args: Parameters<FetchLike>) => {
  if (isTauri()) {
    return (tauriHttpFetch as unknown as FetchLike)(...args)
  }
  return fetch(...args)
}) as FetchLike
