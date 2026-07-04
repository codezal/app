// GitHub Copilot OAuth — Device Code Flow (RFC 8628).
import { fetchWithRetry } from "./http"
import { tauriFetch } from "../tauri-fetch"
import type { OAuthFlow, OAuthStartResult } from "./types"
import type { OAuthCredential } from "../types"

const CLIENT_ID = "Iv1.b507a08c87ecfe98"
const DEVICE_CODE_URL = "https://github.com/login/device/code"
const TOKEN_URL = "https://github.com/login/oauth/access_token"
const COPILOT_TOKEN_URL = "https://api.github.com/copilot_internal/v2/token"
const SCOPES = "read:user"

export const copilotOAuth: OAuthFlow = {
  name: "github-copilot",

  async start(): Promise<OAuthStartResult> {
    // Native HTTP (plugin-http) — webview fetch is CORS-blocked on github.com.
    const res = await tauriFetch(DEVICE_CODE_URL, {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({ client_id: CLIENT_ID, scope: SCOPES }),
    })
    if (!res.ok) throw new Error(`GitHub device code request failed: HTTP ${res.status}`)
    const json = (await res.json()) as {
      device_code: string
      user_code: string
      verification_uri: string
      expires_in: number
      interval: number
    }
    return {
      kind: "deviceCode",
      verificationUri: json.verification_uri,
      userCode: json.user_code,
      deviceCode: json.device_code,
      expiresAt: Date.now() + json.expires_in * 1000,
      interval: Math.max(5, json.interval),
    }
  },

  async pollDeviceCode({ deviceCode, interval, expiresAt }): Promise<OAuthCredential> {
    let waitMs = interval * 1000
    while (Date.now() < expiresAt) {
      await sleep(waitMs)
      const res = await tauriFetch(TOKEN_URL, {
        method: "POST",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify({
          client_id: CLIENT_ID,
          device_code: deviceCode,
          grant_type: "urn:ietf:params:oauth:grant-type:device_code",
        }),
      })
      const body = (await res.json()) as {
        access_token?: string
        error?: string
        interval?: number
      }
      if (body.access_token) {
        // Exchange GitHub token for Copilot API session token.
        const copilot = await fetchCopilotToken(body.access_token)
        return {
          accessToken: copilot.token,
          refreshToken: body.access_token,
          expiresAt: copilot.expiresAt,
          meta: { flow: "github-copilot", endpoint: copilot.endpoint },
        }
      }
      if (body.error === "authorization_pending") {
        continue
      }
      if (body.error === "slow_down") {
        waitMs += 5000
        continue
      }
      throw new Error(`GitHub OAuth error: ${body.error ?? "unknown"}`)
    }
    throw new Error("GitHub device code expired — please retry")
  },

  async refresh(cred): Promise<OAuthCredential | null> {
    if (!cred.refreshToken) return null
    try {
      const copilot = await fetchCopilotToken(cred.refreshToken)
      return {
        accessToken: copilot.token,
        refreshToken: cred.refreshToken,
        expiresAt: copilot.expiresAt,
        meta: { ...(cred.meta ?? {}), endpoint: copilot.endpoint },
      }
    } catch {
      return null
    }
  },
}

async function fetchCopilotToken(githubToken: string): Promise<{
  token: string
  expiresAt: number
  endpoint: string
}> {
  // Retry transient failures — used by both initial poll and refresh, and the
  // Copilot token is short-lived (~25 min) so this runs often.
  const res = await fetchWithRetry(COPILOT_TOKEN_URL, {
    headers: {
      Authorization: `token ${githubToken}`,
      "User-Agent": "Codezal/1.0",
      "Editor-Version": "Codezal/1.0",
    },
  })
  if (!res.ok) throw new Error(`Copilot token exchange failed: HTTP ${res.status}`)
  const json = (await res.json()) as {
    token: string
    expires_at?: number
    refresh_in?: number
    endpoints?: { api: string }
  }
  const expiresAt = json.expires_at
    ? json.expires_at * 1000
    : Date.now() + (json.refresh_in ?? 1500) * 1000
  return {
    token: json.token,
    expiresAt,
    endpoint: json.endpoints?.api ?? "https://api.githubcopilot.com",
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}
