// MCP OAuth credential storage — round-trip + URL pinning + expiry logic.
// Backs the Tauri fs layer (src/lib/storage) with an in-memory store so the
// suite stays pure-logic (node env, no Tauri).
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
  getAuth,
  getAuthForUrl,
  setAuth,
  removeAuth,
  updateTokens,
  updateOAuthState,
  getOAuthState,
  clearOAuthState,
  updateCodeVerifier,
  clearCodeVerifier,
  isTokenExpired,
} from "@/lib/mcp-auth"

const URL_A = "https://a.example.com/mcp"
const URL_B = "https://b.example.com/mcp"

beforeEach(() => {
  for (const k of Object.keys(store)) delete store[k]
})

describe("mcp-auth storage", () => {
  it("setAuth + getAuth round-trip", async () => {
    await setAuth("srv", { tokens: { accessToken: "tok" } }, URL_A)
    const entry = await getAuth("srv")
    expect(entry?.tokens?.accessToken).toBe("tok")
    expect(entry?.serverUrl).toBe(URL_A)
  })

  it("getAuthForUrl pins to the issuing URL", async () => {
    await setAuth("srv", { tokens: { accessToken: "tok" } }, URL_A)
    expect(await getAuthForUrl("srv", URL_A)).toBeDefined()
    // Different URL → never replay credentials.
    expect(await getAuthForUrl("srv", URL_B)).toBeUndefined()
  })

  it("getAuthForUrl undefined when no serverUrl recorded", async () => {
    await setAuth("srv", { tokens: { accessToken: "tok" } })
    expect(await getAuthForUrl("srv", URL_A)).toBeUndefined()
  })

  it("updateTokens merges into an existing entry", async () => {
    await updateCodeVerifier("srv", "verifier")
    await updateTokens("srv", { accessToken: "t2", refreshToken: "r2" }, URL_A)
    const entry = await getAuth("srv")
    expect(entry?.codeVerifier).toBe("verifier")
    expect(entry?.tokens).toEqual({ accessToken: "t2", refreshToken: "r2" })
  })

  it("oauth state set / get / clear", async () => {
    await updateOAuthState("srv", "state-123")
    expect(await getOAuthState("srv")).toBe("state-123")
    await clearOAuthState("srv")
    expect(await getOAuthState("srv")).toBeUndefined()
  })

  it("clearCodeVerifier removes only the verifier", async () => {
    await updateTokens("srv", { accessToken: "t" })
    await updateCodeVerifier("srv", "v")
    await clearCodeVerifier("srv")
    const entry = await getAuth("srv")
    expect(entry?.codeVerifier).toBeUndefined()
    expect(entry?.tokens?.accessToken).toBe("t")
  })

  it("removeAuth deletes the entry", async () => {
    await setAuth("srv", { tokens: { accessToken: "t" } })
    await removeAuth("srv")
    expect(await getAuth("srv")).toBeUndefined()
  })

  it("isTokenExpired: null when no tokens", async () => {
    expect(await isTokenExpired("srv")).toBeNull()
  })

  it("isTokenExpired: false when no expiry set", async () => {
    await updateTokens("srv", { accessToken: "t" })
    expect(await isTokenExpired("srv")).toBe(false)
  })

  it("isTokenExpired: false for a future expiry, true for a past one", async () => {
    const now = Date.now() / 1000
    await updateTokens("srv", { accessToken: "t", expiresAt: now + 3600 })
    expect(await isTokenExpired("srv")).toBe(false)
    await updateTokens("srv", { accessToken: "t", expiresAt: now - 10 })
    expect(await isTokenExpired("srv")).toBe(true)
  })
})
