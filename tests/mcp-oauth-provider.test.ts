// CodezalMcpOAuthProvider — the SDK OAuthClientProvider contract: token and
// client-info round-trips, server-URL pinning, PKCE verifier, CSRF state.
// Storage is mocked in-memory (pure-logic, node env).
import { describe, it, expect, beforeEach, vi } from "vitest"

const { store } = vi.hoisted(() => ({ store: {} as Record<string, unknown> }))

vi.mock("@/lib/storage", () => ({
  readJson: async (path: string, fallback: unknown) =>
    path in store ? store[path] : fallback,
  writeJson: async (path: string, data: unknown) => {
    store[path] = data
  },
}))

import {
  CodezalMcpOAuthProvider,
  OAUTH_CALLBACK_PORT,
  type McpOAuthOptions,
} from "@/lib/mcp-oauth-provider"

const SRV = "https://mcp.example.com/v1/mcp"

function makeProvider(name = "srv", url = SRV, opts: McpOAuthOptions = {}) {
  return new CodezalMcpOAuthProvider(name, url, opts, { onRedirect: () => {} })
}

beforeEach(() => {
  for (const k of Object.keys(store)) delete store[k]
})

describe("CodezalMcpOAuthProvider", () => {
  it("redirectUrl defaults to the loopback callback", () => {
    expect(makeProvider().redirectUrl).toBe(
      `http://127.0.0.1:${OAUTH_CALLBACK_PORT}/mcp/oauth/callback`,
    )
  })

  it("redirectUrl honours explicit override and callbackPort", () => {
    expect(makeProvider("s", SRV, { redirectUri: "https://x/cb" }).redirectUrl).toBe("https://x/cb")
    expect(makeProvider("s", SRV, { callbackPort: 5000 }).redirectUrl).toBe(
      "http://127.0.0.1:5000/mcp/oauth/callback",
    )
  })

  it("clientMetadata auth method depends on client secret", () => {
    expect(makeProvider().clientMetadata.token_endpoint_auth_method).toBe("none")
    expect(
      makeProvider("s", SRV, { clientSecret: "sec" }).clientMetadata.token_endpoint_auth_method,
    ).toBe("client_secret_post")
  })

  it("clientMetadata includes scope only when set", () => {
    expect(makeProvider().clientMetadata.scope).toBeUndefined()
    expect(makeProvider("s", SRV, { scope: "read write" }).clientMetadata.scope).toBe("read write")
  })

  it("clientInformation returns the pre-registered client from config", async () => {
    const info = await makeProvider("s", SRV, { clientId: "cid", clientSecret: "sec" }).clientInformation()
    expect(info).toEqual({ client_id: "cid", client_secret: "sec" })
  })

  it("clientInformation undefined when nothing registered (triggers DCR)", async () => {
    expect(await makeProvider().clientInformation()).toBeUndefined()
  })

  it("saveTokens → tokens round-trip with computed expiry", async () => {
    const p = makeProvider()
    await p.saveTokens({ access_token: "AT", token_type: "Bearer", refresh_token: "RT", expires_in: 3600 })
    const t = await p.tokens()
    expect(t?.access_token).toBe("AT")
    expect(t?.refresh_token).toBe("RT")
    expect(t?.expires_in).toBeGreaterThan(3500)
    expect(t?.expires_in).toBeLessThanOrEqual(3600)
  })

  it("tokens() is pinned to the server URL", async () => {
    await makeProvider("srv", SRV).saveTokens({ access_token: "AT", token_type: "Bearer" })
    // Same name, different URL → tokens must not be replayed.
    expect(await makeProvider("srv", "https://other.example.com").tokens()).toBeUndefined()
  })

  it("saveClientInformation → clientInformation round-trip", async () => {
    const p = makeProvider()
    await p.saveClientInformation({
      client_id: "dyn-id",
      client_secret: "dyn-sec",
      redirect_uris: [p.redirectUrl],
    } as Parameters<typeof p.saveClientInformation>[0])
    expect(await p.clientInformation()).toEqual({ client_id: "dyn-id", client_secret: "dyn-sec" })
  })

  it("state() generates, persists and stays stable", async () => {
    const p = makeProvider()
    const first = await p.state()
    expect(first).toMatch(/^[0-9a-f]{64}$/)
    expect(await p.state()).toBe(first)
  })

  it("saveCodeVerifier → codeVerifier round-trip; throws when absent", async () => {
    const p = makeProvider()
    await expect(p.codeVerifier()).rejects.toThrow()
    await p.saveCodeVerifier("pkce-verifier")
    expect(await p.codeVerifier()).toBe("pkce-verifier")
  })

  it("invalidateCredentials('tokens') drops tokens but keeps client info", async () => {
    const p = makeProvider()
    await p.saveClientInformation({
      client_id: "cid",
      redirect_uris: [p.redirectUrl],
    } as Parameters<typeof p.saveClientInformation>[0])
    await p.saveTokens({ access_token: "AT", token_type: "Bearer" })
    await p.invalidateCredentials("tokens")
    expect(await p.tokens()).toBeUndefined()
    expect(await p.clientInformation()).toEqual({ client_id: "cid", client_secret: undefined })
  })
})
