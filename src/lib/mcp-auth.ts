// MCP OAuth credential storage — AppData/mcp-auth.json, keyed by server name.
// Plain-TS counterpart of the storage layer the MCP SDK OAuthClientProvider
// reads/writes during PKCE + dynamic client registration + token refresh.
// Persists: tokens, dynamically-registered client info, the in-flight PKCE
// code verifier, and the CSRF state. `serverUrl` pins an entry to one URL so
// stored credentials are never replayed against a different server.
import { readJson, writeJson } from "./storage"

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

type AuthData = Record<string, McpAuthEntry>

const FILE = "mcp-auth.json"

async function readAll(): Promise<AuthData> {
  return readJson<AuthData>(FILE, {})
}

export async function getAuth(name: string): Promise<McpAuthEntry | undefined> {
  return (await readAll())[name]
}

// Return the entry only if it was issued for `serverUrl` — prevents replaying
// credentials after the user repoints a server at a different host.
export async function getAuthForUrl(
  name: string,
  serverUrl: string,
): Promise<McpAuthEntry | undefined> {
  const entry = (await readAll())[name]
  if (!entry || !entry.serverUrl || entry.serverUrl !== serverUrl) return undefined
  return entry
}

export async function setAuth(
  name: string,
  entry: McpAuthEntry,
  serverUrl?: string,
): Promise<void> {
  const data = await readAll()
  if (serverUrl) entry.serverUrl = serverUrl
  await writeJson(FILE, { ...data, [name]: entry })
}

export async function removeAuth(name: string): Promise<void> {
  const data = await readAll()
  delete data[name]
  await writeJson(FILE, data)
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

export const updateCodeVerifier = (name: string, codeVerifier: string) =>
  updateField(name, "codeVerifier", codeVerifier)

export const clearCodeVerifier = (name: string) => clearField(name, "codeVerifier")

export const updateOAuthState = (name: string, state: string) =>
  updateField(name, "oauthState", state)

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
