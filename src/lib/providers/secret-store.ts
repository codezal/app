// OS keychain secret store — provider API keys + OAuth credentials.
//
// Secrets used to live in plaintext inside settings.json. They now live in the
// OS keychain (macOS Keychain / Windows Credential Manager) via the Rust
// `secret_get/set/delete` commands. settings.json keeps only non-secret config.
//
// Schema: one keychain entry per secret so we never exceed the Windows
// Credential Manager per-blob limit (~2.5 KB) by concatenating tokens:
//   account `apiKey.<providerId>`     → the raw key string
//   account `oauth.<providerId>`      → JSON.stringify(OAuthCredential)
//   account `headers.<providerId>`    → JSON.stringify(Record<string,string>)
//                                       (custom-provider HTTP headers — may carry
//                                       bearer tokens, so never persisted to disk)
//   account `__index__`               → JSON { apiKeys, oauth, headers: string[] }
//
// The index lets load() enumerate which providers have secrets without probing
// every known provider id (keyring 3.x has no native "list entries" API).
import { invoke } from "@tauri-apps/api/core"
import type { OAuthCredential, ProviderId } from "./types"

// Keychain service name — the namespace under which all entries are grouped.
const SERVICE = "codezal"
const INDEX_ACCOUNT = "__index__"

const apiKeyAccount = (id: string): string => `apiKey.${id}`
const oauthAccount = (id: ProviderId): string => `oauth.${id}`
const headersAccount = (id: ProviderId): string => `headers.${id}`

type SecretIndex = { apiKeys: string[]; oauth: string[]; headers: string[] }

export type LoadedSecrets = {
  apiKeys: Record<string, string>
  credentials: Record<string, OAuthCredential>
  // Custom-provider headers — id → header map. Secrets, so keychain-only.
  headers: Record<string, Record<string, string>>
}

// ----- low-level keychain IPC (graceful when Tauri is absent, e.g. tests) ---

async function kcGet(account: string): Promise<string | null> {
  try {
    const v = await invoke<string | null>("secret_get", { service: SERVICE, account })
    return v ?? null
  } catch (e) {
    console.warn(`[secret-store] get('${account}') failed:`, e)
    return null
  }
}

async function kcSet(account: string, value: string): Promise<void> {
  await invoke("secret_set", { service: SERVICE, account, value })
}

async function kcDelete(account: string): Promise<void> {
  try {
    await invoke("secret_delete", { service: SERVICE, account })
  } catch (e) {
    console.warn(`[secret-store] delete('${account}') failed:`, e)
  }
}

// ----- index helpers --------------------------------------------------------

async function readIndex(): Promise<SecretIndex> {
  const raw = await kcGet(INDEX_ACCOUNT)
  if (!raw) return { apiKeys: [], oauth: [], headers: [] }
  try {
    const parsed = JSON.parse(raw) as Partial<SecretIndex>
    return {
      apiKeys: Array.isArray(parsed.apiKeys) ? parsed.apiKeys : [],
      oauth: Array.isArray(parsed.oauth) ? parsed.oauth : [],
      headers: Array.isArray(parsed.headers) ? parsed.headers : [],
    }
  } catch {
    return { apiKeys: [], oauth: [], headers: [] }
  }
}

async function writeIndex(index: SecretIndex): Promise<void> {
  await kcSet(INDEX_ACCOUNT, JSON.stringify(index))
}

function addId(list: string[], id: string): string[] {
  return list.includes(id) ? list : [...list, id]
}

function removeId(list: string[], id: string): string[] {
  return list.filter((x) => x !== id)
}

// ----- public API -----------------------------------------------------------

// Load every stored secret in one pass: read the index, then fetch each
// referenced entry. Missing/corrupt entries are skipped so a partially-written
// keychain never blocks startup.
export async function loadAllSecrets(): Promise<LoadedSecrets> {
  const index = await readIndex()
  const apiKeys: Record<string, string> = {}
  const credentials: Record<string, OAuthCredential> = {}
  const headers: Record<string, Record<string, string>> = {}

  await Promise.all([
    ...index.apiKeys.map(async (id) => {
      const v = await kcGet(apiKeyAccount(id))
      if (v && v.trim()) apiKeys[id] = v
    }),
    ...index.oauth.map(async (id) => {
      const raw = await kcGet(oauthAccount(id))
      if (!raw) return
      try {
        const cred = JSON.parse(raw) as OAuthCredential
        if (cred && typeof cred.accessToken === "string") credentials[id] = cred
      } catch {
        // skip corrupt credential entry
      }
    }),
    ...index.headers.map(async (id) => {
      const raw = await kcGet(headersAccount(id))
      if (!raw) return
      try {
        const h = JSON.parse(raw) as Record<string, string>
        if (h && typeof h === "object") headers[id] = h
      } catch {
        // skip corrupt headers entry
      }
    }),
  ])

  return { apiKeys, credentials, headers }
}

// Store (or, with null/empty, clear) a provider's API key. Keeps the index in
// sync so a later load() finds it.
export async function setApiKeySecret(id: string, key: string | null): Promise<void> {
  const index = await readIndex()
  if (key && key.trim()) {
    await kcSet(apiKeyAccount(id), key.trim())
    await writeIndex({ ...index, apiKeys: addId(index.apiKeys, id) })
  } else {
    await kcDelete(apiKeyAccount(id))
    await writeIndex({ ...index, apiKeys: removeId(index.apiKeys, id) })
  }
}

// Store (or, with null, clear) a provider's OAuth credential.
export async function setCredentialSecret(
  id: ProviderId,
  cred: OAuthCredential | null,
): Promise<void> {
  const index = await readIndex()
  if (cred) {
    await kcSet(oauthAccount(id), JSON.stringify(cred))
    await writeIndex({ ...index, oauth: addId(index.oauth, id) })
  } else {
    await kcDelete(oauthAccount(id))
    await writeIndex({ ...index, oauth: removeId(index.oauth, id) })
  }
}

// Store (or, with null/empty, clear) a custom provider's HTTP headers. Kept in
// the keychain rather than settings.json because header values may carry
// long-lived secrets (e.g. `Authorization: Bearer …`).
export async function setHeadersSecret(
  id: ProviderId,
  headers: Record<string, string> | null,
): Promise<void> {
  const index = await readIndex()
  if (headers && Object.keys(headers).length > 0) {
    await kcSet(headersAccount(id), JSON.stringify(headers))
    await writeIndex({ ...index, headers: addId(index.headers, id) })
  } else {
    await kcDelete(headersAccount(id))
    await writeIndex({ ...index, headers: removeId(index.headers, id) })
  }
}

// Clear every secret kind for a provider (used by disconnect / custom remove).
export async function removeProviderSecrets(id: ProviderId): Promise<void> {
  const index = await readIndex()
  await kcDelete(apiKeyAccount(id))
  await kcDelete(oauthAccount(id))
  await kcDelete(headersAccount(id))
  await writeIndex({
    apiKeys: removeId(index.apiKeys, id),
    oauth: removeId(index.oauth, id),
    headers: removeId(index.headers, id),
  })
}
