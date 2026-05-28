// Anthropic OAuth — Claude Pro/Max sign-in (Authorization Code + PKCE).
// Akış:
//   1. start() → claude.ai/oauth/authorize URL'i + PKCE verifier'ı döner.
//      Caller browser'da açar, kullanıcı izin verdikten sonra Anthropic
//      console redirect sayfasında authorization_code görür ve kopyalar.
//   2. completeAuthCode({ callbackUrl, state }) → kullanıcı yapıştırdığı URL'i
//      veya code#state formunu içerir; verifier ile token endpoint'e gönderir.
// Local HTTP server şart değildir (manual paste pattern).
import { generatePkcePair, generateState } from "./pkce"
import type { OAuthFlow, OAuthStartResult } from "./types"
import type { OAuthCredential } from "../types"

// Public client id — Claude Code CLI ile aynı, secret yok (PKCE).
const CLIENT_ID = "9d1c250a-e61b-44d9-88ed-5944d1962f5e"
const AUTHORIZE_URL = "https://claude.ai/oauth/authorize"
const TOKEN_URL = "https://console.anthropic.com/v1/oauth/token"
const REDIRECT_URI = "https://console.anthropic.com/oauth/code/callback"
const SCOPES = ["org:create_api_key", "user:profile", "user:inference"]

// Verifier'ı tarayıcı belleğinde tutmaya gerek yok — caller (UI) saklar ve
// complete çağrısında geri verir. Burada in-memory map sadece convenience.
const verifiers = new Map<string, string>()

export const anthropicOAuth: OAuthFlow = {
  name: "anthropic",

  async start(): Promise<OAuthStartResult> {
    const { verifier, challenge, method } = await generatePkcePair()
    const state = generateState()
    verifiers.set(state, verifier)
    const params = new URLSearchParams({
      code: "true",
      client_id: CLIENT_ID,
      response_type: "code",
      redirect_uri: REDIRECT_URI,
      scope: SCOPES.join(" "),
      code_challenge: challenge,
      code_challenge_method: method,
      state,
    })
    return {
      kind: "authCodePkce",
      authorizeUrl: `${AUTHORIZE_URL}?${params.toString()}`,
      state,
    }
  },

  async completeAuthCode({ callbackUrl, state }): Promise<OAuthCredential> {
    const verifier = verifiers.get(state)
    if (!verifier) throw new Error("OAuth state mismatch — please retry sign-in")
    verifiers.delete(state)

    const { code, returnedState } = parseCallback(callbackUrl)
    if (returnedState && returnedState !== state) {
      throw new Error("OAuth state mismatch — please retry sign-in")
    }
    if (!code) throw new Error("OAuth: missing authorization code in callback")

    const res = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        code,
        state,
        grant_type: "authorization_code",
        client_id: CLIENT_ID,
        redirect_uri: REDIRECT_URI,
        code_verifier: verifier,
      }),
    })
    if (!res.ok) {
      const body = await res.text()
      throw new Error(`Anthropic OAuth token exchange failed: HTTP ${res.status} ${body}`)
    }
    const json = (await res.json()) as {
      access_token: string
      refresh_token?: string
      expires_in?: number
    }
    return {
      accessToken: json.access_token,
      refreshToken: json.refresh_token,
      expiresAt: json.expires_in ? Date.now() + json.expires_in * 1000 : undefined,
      meta: { flow: "anthropic" },
    }
  },

  async refresh(cred): Promise<OAuthCredential | null> {
    if (!cred.refreshToken) return null
    const res = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        grant_type: "refresh_token",
        refresh_token: cred.refreshToken,
        client_id: CLIENT_ID,
      }),
    })
    if (!res.ok) return null
    const json = (await res.json()) as {
      access_token: string
      refresh_token?: string
      expires_in?: number
    }
    return {
      accessToken: json.access_token,
      refreshToken: json.refresh_token ?? cred.refreshToken,
      expiresAt: json.expires_in ? Date.now() + json.expires_in * 1000 : undefined,
      meta: cred.meta,
    }
  },
}

// Callback URL can be the full redirect URL ("https://…/callback?code=…&state=…")
// or a bare "code#state" / "code" pasted from Anthropic's console page.
function parseCallback(input: string): { code: string | null; returnedState: string | null } {
  const trimmed = input.trim()
  // Full URL form
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    try {
      const u = new URL(trimmed)
      return {
        code: u.searchParams.get("code"),
        returnedState: u.searchParams.get("state"),
      }
    } catch {
      return { code: null, returnedState: null }
    }
  }
  // "code#state" form
  if (trimmed.includes("#")) {
    const [code, returnedState] = trimmed.split("#", 2)
    return { code: code ?? null, returnedState: returnedState ?? null }
  }
  // Bare code
  return { code: trimmed || null, returnedState: null }
}
