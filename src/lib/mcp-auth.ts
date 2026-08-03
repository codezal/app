// MCP OAuth credential storage — OS keychain, keyed by server name.
//
// Tokens, dynamic-client secrets, the PKCE code verifier and the CSRF state are
// long-lived credentials, so they must NOT sit in a plaintext JSON file the way
// provider keys used to. Each server's whole McpAuthEntry is stored as one
// keychain entry (`mcp.<name>`) via the same secret-store primitives the
// provider layer uses. `serverUrl` pins an entry to one URL so stored
// credentials are never replayed against a different server.
//
// Legacy plaintext entries (AppData/mcp-auth.json) are migrated into the
// keychain on first access and the file is emptied.
import { readJson, writeJson } from "./storage"
import { keychainGet, keychainSet, keychainDelete } from "./providers/secret-store"

export type McpTokens = {
  accessToken: string
  refreshToken?: string
  // Absolute unix epoch seconds when the access token expires.
  expiresAt?: number
  scope?: string
}

export type McpClientInfo = {
  clientId: string
  clientSecret?: string
  clientIdIssuedAt?: number
  clientSecretExpiresAt?: number
}

export type McpAuthEntry = {
  tokens?: McpTokens
  clientInfo?: McpClientInfo
  codeVerifier?: string
  oauthState?: string
  serverUrl?: string
}

const LEGACY_FILE = "mcp-auth.json"
const account = (name: string): string => `mcp.${name}`

async function kcRead(name: string): Promise<McpAuthEntry | undefined> {
  const raw = await keychainGet(account(name))
  if (!raw) return undefined
  try {
    const parsed = JSON.parse(raw) as McpAuthEntry
    return parsed && typeof parsed === "object" ? parsed : undefined
  } catch {
    return undefined
  }
}

// Idempotent migration of pre-keychain plaintext entries. Runs on every access
// (the legacy read was already per-call before keychain) but is a no-op once
// the file holds no entries. Failures are logged and never block the hot path.
async function ensureMigrated(): Promise<void> {
  try {
    const legacy = await readJson<Record<string, unknown>>(LEGACY_FILE, {})
    const names = Object.keys(legacy)
    if (names.length === 0) return
    for (const name of names) {
      const entry = legacy[name]
      if (entry && typeof entry === "object") {
        await keychainSet(account(name), JSON.stringify(entry))
      }
    }
    await writeJson(LEGACY_FILE, {})
    console.info(`[mcp-auth] ${names.length} legacy entry keychain'e taşındı`)
  } catch (e) {
    console.warn("[mcp-auth] legacy migration failed:", e)
  }
}

export async function getAuth(name: string): Promise<McpAuthEntry | undefined> {
  await ensureMigrated()
  return kcRead(name)
}

// Return the entry only if it was issued for `serverUrl` — prevents replaying
// credentials after the user repoints a server at a different host.
export async function getAuthForUrl(
  name: string,
  serverUrl: string,
): Promise<McpAuthEntry | undefined> {
  await ensureMigrated()
  const entry = await kcRead(name)
  if (!entry || !entry.serverUrl || entry.serverUrl !== serverUrl) return undefined
  return entry
}

export async function setAuth(
  name: string,
  entry: McpAuthEntry,
  serverUrl?: string,
): Promise<void> {
  await ensureMigrated()
  if (serverUrl) entry.serverUrl = serverUrl
  await keychainSet(account(name), JSON.stringify(entry))
}

export async function removeAuth(name: string): Promise<void> {
  await ensureMigrated()
  await keychainDelete(account(name))
}

// Merge a single field into the entry (creating it if absent), then persist.
async function updateField<K extends keyof McpAuthEntry>(
  name: string,
  field: K,
  value: NonNullable<McpAuthEntry[K]>,
  serverUrl?: string,
): Promise<void> {
  const entry = (await getAuth(name)) ?? {}
  entry[field] = value
  await setAuth(name, entry, serverUrl)
}

async function clearField(name: string, field: keyof McpAuthEntry): Promise<void> {
  const entry = await getAuth(name)
  if (!entry) return
  delete entry[field]
  await setAuth(name, entry)
}

export const updateTokens = (name: string, tokens: McpTokens, serverUrl?: string) =>
  updateField(name, "tokens", tokens, serverUrl)

export const updateClientInfo = (name: string, info: McpClientInfo, serverUrl?: string) =>
  updateField(name, "clientInfo", info, serverUrl)

export const updateCodeVerifier = (name: string, codeVerifier: string, serverUrl?: string) =>
  updateField(name, "codeVerifier", codeVerifier, serverUrl)

export const clearCodeVerifier = (name: string) => clearField(name, "codeVerifier")

export const updateOAuthState = (name: string, state: string, serverUrl?: string) =>
  updateField(name, "oauthState", state, serverUrl)

export async function getOAuthState(name: string): Promise<string | undefined> {
  return (await getAuth(name))?.oauthState
}

export const clearOAuthState = (name: string) => clearField(name, "oauthState")

// null = no tokens stored; false = valid; true = expired.
export async function isTokenExpired(name: string): Promise<boolean | null> {
  const entry = await getAuth(name)
  if (!entry?.tokens) return null
  if (!entry.tokens.expiresAt) return false
  return entry.tokens.expiresAt < Date.now() / 1000
}
