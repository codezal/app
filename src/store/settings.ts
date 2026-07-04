import { create } from "zustand"
import { loadSettingsFile, saveSettingsFile, ensureSettingsSchemaSidecar } from "@/lib/storage"
import { DEFAULT_LOCALE, detectOsLocale, useI18nStore } from "@/lib/i18n"
// Import the pure config submodules directly (not the @/lib/config barrel) to
// avoid a cycle: the barrel re-exports ./effective, which imports this store.
import { migrateSettings } from "@/lib/config/migrate"
import { parseSettings } from "@/lib/config/schema"
import { syncInferenceServer } from "@/lib/inference-server"
// Canonical defaults live in a pure module so the JSON Schema generator can
// read them without pulling in this store's runtime graph.
import { DEFAULT_SETTINGS as DEFAULT } from "@/lib/config/defaults"
import {
  loadAllSecrets,
  setApiKeySecret,
  setCredentialSecret,
  setHeadersSecret,
  removeProviderSecrets,
} from "@/lib/providers/secret-store"
import { _syncCustomProviders } from "@/lib/providers"
import type { CustomProvider, OAuthCredential, ProviderConfig, ProviderId } from "@/lib/providers"
import type { Settings } from "./types"

// kirletmesin diye); load'da webSearch.apiKey / firecrawl.apiKey'e hydrate edilir.
const TOOL_WEBSEARCH_SECRET = "tool:websearch"
const TOOL_FIRECRAWL_SECRET = "tool:firecrawl"
const TOOL_IMAGEGEN_SECRET = "tool:imagegen"

// Secrets (apiKeys + OAuth credentials + custom-provider headers) live in the OS
// keychain, never on disk. Strip them before any settings.json write so no
// plaintext secret is persisted; the in-memory Settings object keeps the real
// values for the running session. Custom-provider header values may carry bearer
// tokens, so they are stripped from each customProviders entry too.
function stripSecrets(s: Settings): Settings {
  const customProviders = s.customProviders?.map((c) => {
    if (!c.headers) return c
    const copy = { ...c }
    delete copy.headers
    return copy
  })
  const webSearch = s.webSearch ? { ...s.webSearch, apiKey: undefined } : undefined
  // imageGeneration: only apiKey is a secret — keep the rest of the config on disk,
  // strip just the key (custom-mode key; preset mode reuses a provider key elsewhere).
  const imageGeneration = s.imageGeneration
    ? { ...s.imageGeneration, apiKey: undefined }
    : undefined
  return {
    ...s,
    apiKeys: {},
    credentials: {},
    customProviders,
    webSearch,
    firecrawl: undefined,
    imageGeneration,
  }
}

type SettingsState = {
  settings: Settings
  loaded: boolean
  load: () => Promise<void>
  update: (patch: Partial<Settings>) => Promise<void>
  setApiKey: (provider: keyof Settings["apiKeys"], key: string) => Promise<void>
  setToolSecret: (tool: "websearch" | "firecrawl" | "imagegen", key: string) => Promise<void>
  // OAuth / extended credentials.
  setCredential: (provider: ProviderId, cred: OAuthCredential | null) => Promise<void>
  // Per-provider config (baseURL, headers, custom options).
  setProviderConfig: (provider: ProviderId, config: ProviderConfig | null) => Promise<void>
  saveCustomProvider: (cp: CustomProvider, apiKey?: string) => Promise<void>
  removeCustomProvider: (id: string) => Promise<void>
  // Single-model enable/disable.
  setModelEnabled: (provider: ProviderId, modelId: string, enabled: boolean) => Promise<void>
  // Bulk model status replace.
  setProviderModelStatus: (provider: ProviderId, status: Record<string, boolean>) => Promise<void>
  // Disconnect provider — clears apiKey + credential + providerConfig.
  disconnectProvider: (provider: ProviderId) => Promise<void>
  setSkillEnabled: (name: string, enabled: boolean) => Promise<void>
  refreshProviderCatalog: () => Promise<void>
}

// Persist settings, but drop the ephemeral offline catalog seed first. The seed
// (providerCatalog with fetchedAt: 0, set in load()) always reloads from the
// bundle, so writing its ~2 MB into settings.json would only bloat the file. A
// live catalog fetched from models.dev (fetchedAt > 0) is kept as before.
// Secrets are stripped too — they live in the OS keychain, written via their
// own setters, and must never be persisted to disk.
async function persistSettings(next: Settings): Promise<void> {
  const safe = stripSecrets(next)
  if (safe.providerCatalog?.fetchedAt === 0) {
    const rest = { ...safe }
    delete rest.providerCatalog
    await saveSettingsFile(rest)
    return
  }
  await saveSettingsFile(safe)
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  settings: DEFAULT,
  loaded: false,

  load: async () => {
    // Raw file → versioned migration (legacy-shape transforms) → schema
    // validation (lenient: fills defaults, repairs bad fields, never throws).
    // This replaces the previous hand-rolled nested-merge; appearance and
    // tokenSavers default-fill + the theme/customsByPreset migrations now live
    // in src/lib/config (schema.ts + migrate.ts).
    const raw = await loadSettingsFile<Record<string, unknown>>({})
    const migrated = migrateSettings(raw)
    const merged = parseSettings(migrated, DEFAULT)
    // Seed the offline catalog snapshot when there is no cached catalog yet, so
    // catalog-derived providers and model lists work on first run / offline.
    // Marked stale (fetchedAt: 0) so the background refresh below replaces it
    // with live models.dev data as soon as the app is online. persistSettings()
    // strips this seed on save, so it never bloats settings.json — it reloads
    // from the bundle on every launch.
    if (!merged.providerCatalog?.data) {
      const { CATALOG_SNAPSHOT } = await import("@/lib/catalog-snapshot")
      merged.providerCatalog = { data: CATALOG_SNAPSHOT, fetchedAt: 0 }
    }

    // Secrets come from the OS keychain, not settings.json. Legacy installs
    // still carry plaintext apiKeys/credentials in the file — migrate those
    // into the keychain on first load, then rewrite the file stripped below.
    const kc = await loadAllSecrets()
    const diskApiKeys = merged.apiKeys ?? {}
    const diskCreds = merged.credentials ?? {}
    let hadDiskSecrets = false
    for (const [id, key] of Object.entries(diskApiKeys)) {
      if (typeof key === "string" && key.trim()) {
        hadDiskSecrets = true
        if (!kc.apiKeys[id]) {
          await setApiKeySecret(id, key)
          kc.apiKeys[id] = key
        }
      }
    }
    for (const [id, cred] of Object.entries(diskCreds)) {
      if (cred) {
        hadDiskSecrets = true
        if (!kc.credentials[id]) {
          await setCredentialSecret(id, cred as OAuthCredential)
          kc.credentials[id] = cred as OAuthCredential
        }
      }
    }
    // Custom-provider headers are secrets too. Hydrate each entry from the
    // keychain; migrate any header map a legacy/hand-edited file still carries
    // in plaintext, then rely on the stripped rewrite below to scrub the file.
    for (const cp of merged.customProviders ?? []) {
      const kcHeaders = kc.headers[cp.id]
      if (kcHeaders) {
        cp.headers = kcHeaders
      } else if (cp.headers && Object.keys(cp.headers).length > 0) {
        hadDiskSecrets = true
        await setHeadersSecret(cp.id, cp.headers)
        kc.headers[cp.id] = cp.headers
      } else {
        cp.headers = undefined
      }
    }

    const wsDiskKey = merged.webSearch?.apiKey
    if (wsDiskKey && wsDiskKey.trim() && !kc.apiKeys[TOOL_WEBSEARCH_SECRET]) {
      hadDiskSecrets = true
      await setApiKeySecret(TOOL_WEBSEARCH_SECRET, wsDiskKey)
      kc.apiKeys[TOOL_WEBSEARCH_SECRET] = wsDiskKey
    }
    const fcDiskKey = merged.firecrawl?.apiKey
    if (fcDiskKey && fcDiskKey.trim() && !kc.apiKeys[TOOL_FIRECRAWL_SECRET]) {
      hadDiskSecrets = true
      await setApiKeySecret(TOOL_FIRECRAWL_SECRET, fcDiskKey)
      kc.apiKeys[TOOL_FIRECRAWL_SECRET] = fcDiskKey
    }
    const igDiskKey = merged.imageGeneration?.apiKey
    if (igDiskKey && igDiskKey.trim() && !kc.apiKeys[TOOL_IMAGEGEN_SECRET]) {
      hadDiskSecrets = true
      await setApiKeySecret(TOOL_IMAGEGEN_SECRET, igDiskKey)
      kc.apiKeys[TOOL_IMAGEGEN_SECRET] = igDiskKey
    }
    if (merged.webSearch && kc.apiKeys[TOOL_WEBSEARCH_SECRET]) {
      merged.webSearch.apiKey = kc.apiKeys[TOOL_WEBSEARCH_SECRET]
    }
    if (kc.apiKeys[TOOL_FIRECRAWL_SECRET]) {
      merged.firecrawl = { apiKey: kc.apiKeys[TOOL_FIRECRAWL_SECRET] }
    }
    // imageGeneration: multi-field config, only apiKey is keychain-backed → hydrate
    // the key onto the existing config (don't replace the whole block like firecrawl).
    if (merged.imageGeneration && kc.apiKeys[TOOL_IMAGEGEN_SECRET]) {
      merged.imageGeneration.apiKey = kc.apiKeys[TOOL_IMAGEGEN_SECRET]
    }
    delete kc.apiKeys[TOOL_WEBSEARCH_SECRET]
    delete kc.apiKeys[TOOL_FIRECRAWL_SECRET]
    delete kc.apiKeys[TOOL_IMAGEGEN_SECRET]

    merged.apiKeys = kc.apiKeys
    merged.credentials = kc.credentials

    _syncCustomProviders(merged.customProviders)

    set({ settings: merged, loaded: true })
    void syncInferenceServer(merged.inferenceServer)
    // If the file still held plaintext secrets, rewrite it stripped so they
    // don't linger on disk after the keychain migration.
    if (hadDiskSecrets) await persistSettings(merged)
    // Mirror the JSON Schema next to settings.json so hand-editing gets
    // autocomplete (best-effort, non-blocking).
    void ensureSettingsSchemaSidecar()
    let locale = merged.language
    if (!locale) {
      locale = (await detectOsLocale()) ?? DEFAULT_LOCALE
      set((s) => ({ settings: { ...s.settings, language: locale } }))
      void persistSettings({ ...merged, language: locale })
    }
    void useI18nStore.getState().setLocale(locale)
  },

  update: async (patch) => {
    const prev = get().settings
    const next = { ...prev, ...patch }
    set({ settings: next })
    await persistSettings(next)
    if (patch.language && patch.language !== prev.language) {
      void useI18nStore.getState().setLocale(patch.language)
    }
  },

  setApiKey: async (provider, key) => {
    // Secret → keychain first, then mirror in memory. Empty key clears it.
    await setApiKeySecret(provider, key)
    const apiKeys = { ...get().settings.apiKeys }
    if (key && key.trim()) apiKeys[provider] = key
    else delete apiKeys[provider]
    const next: Settings = { ...get().settings, apiKeys }
    set({ settings: next })
    await persistSettings(next)
  },

  setToolSecret: async (tool, key) => {
    const id =
      tool === "websearch"
        ? TOOL_WEBSEARCH_SECRET
        : tool === "firecrawl"
          ? TOOL_FIRECRAWL_SECRET
          : TOOL_IMAGEGEN_SECRET
    await setApiKeySecret(id, key)
    const cur = get().settings
    const trimmed = key.trim()
    let next: Settings
    if (tool === "websearch") {
      next = {
        ...cur,
        webSearch: {
          provider: cur.webSearch?.provider ?? "duckduckgo",
          apiKey: trimmed || undefined,
        },
      }
    } else if (tool === "firecrawl") {
      next = { ...cur, firecrawl: trimmed ? { apiKey: trimmed } : undefined }
    } else {
      // imageGeneration: multi-field config — preserve the rest, set only the key.
      // The other fields are written via update() from the settings UI; here we
      // just mirror the keychain value onto whatever config currently exists.
      const ig = cur.imageGeneration ?? {
        enabled: false,
        providerId: "",
        model: "",
      }
      next = { ...cur, imageGeneration: { ...ig, apiKey: trimmed || undefined } }
    }
    set({ settings: next })
    await persistSettings(next)
  },

  setCredential: async (provider, cred) => {
    // Secret → keychain first, then mirror in memory.
    await setCredentialSecret(provider, cred)
    const prev = get().settings.credentials ?? {}
    const credentials = { ...prev }
    if (cred) credentials[provider] = cred
    else delete credentials[provider]
    const next: Settings = { ...get().settings, credentials }
    set({ settings: next })
    await persistSettings(next)
  },

  setProviderConfig: async (provider, config) => {
    const prev = get().settings.providerConfigs ?? {}
    const providerConfigs = { ...prev }
    if (config) providerConfigs[provider] = config
    else delete providerConfigs[provider]
    const next: Settings = { ...get().settings, providerConfigs }
    set({ settings: next })
    await persistSettings(next)
  },

  saveCustomProvider: async (cp, apiKey) => {
    if (apiKey !== undefined) {
      await setApiKeySecret(cp.id, apiKey)
    }
    await setHeadersSecret(cp.id, cp.headers && Object.keys(cp.headers).length > 0 ? cp.headers : null)
    const s = get().settings
    const list = [...(s.customProviders ?? [])]
    const idx = list.findIndex((c) => c.id === cp.id)
    if (idx >= 0) list[idx] = cp
    else list.push(cp)
    const apiKeys = { ...s.apiKeys }
    if (apiKey !== undefined) {
      if (apiKey.trim()) apiKeys[cp.id] = apiKey
      else delete apiKeys[cp.id]
    }
    const next: Settings = { ...s, customProviders: list, apiKeys }
    _syncCustomProviders(list)
    set({ settings: next })
    await persistSettings(next)
  },

  removeCustomProvider: async (id) => {
    await removeProviderSecrets(id)
    const s = get().settings
    const list = (s.customProviders ?? []).filter((c) => c.id !== id)
    const apiKeys = { ...s.apiKeys }
    delete apiKeys[id]
    const credentials = { ...(s.credentials ?? {}) }
    delete credentials[id]
    const providerConfigs = { ...(s.providerConfigs ?? {}) }
    delete providerConfigs[id]
    const modelStatus = { ...(s.modelStatus ?? {}) }
    delete modelStatus[id]
    const next: Settings = {
      ...s,
      customProviders: list,
      apiKeys,
      credentials,
      providerConfigs,
      modelStatus,
    }
    if (s.defaultProvider === id) {
      next.defaultProvider = DEFAULT.defaultProvider
      next.defaultModel = DEFAULT.defaultModel
    }
    _syncCustomProviders(list)
    set({ settings: next })
    await persistSettings(next)
  },

  setModelEnabled: async (provider, modelId, enabled) => {
    const prev = get().settings.modelStatus ?? {}
    const perProvider = { ...(prev[provider] ?? {}) }
    perProvider[modelId] = enabled
    const modelStatus = { ...prev, [provider]: perProvider }
    const next: Settings = { ...get().settings, modelStatus }
    set({ settings: next })
    await persistSettings(next)
  },

  setProviderModelStatus: async (provider, status) => {
    const prev = get().settings.modelStatus ?? {}
    const modelStatus = { ...prev, [provider]: status }
    const next: Settings = { ...get().settings, modelStatus }
    set({ settings: next })
    await persistSettings(next)
  },

  disconnectProvider: async (provider) => {
    // Drop both secret kinds from the keychain, then clear the mirrors.
    await removeProviderSecrets(provider)
    const s = get().settings
    const apiKeys = { ...s.apiKeys }
    delete apiKeys[provider]
    const credentials = { ...(s.credentials ?? {}) }
    delete credentials[provider]
    const providerConfigs = { ...(s.providerConfigs ?? {}) }
    delete providerConfigs[provider]
    const next: Settings = { ...s, apiKeys, credentials, providerConfigs }
    set({ settings: next })
    await persistSettings(next)
  },

  setSkillEnabled: async (name, enabled) => {
    const cur = get().settings.disabledSkills ?? []
    const bag = new Set(cur)
    if (enabled) bag.delete(name)
    else bag.add(name)
    const next: Settings = { ...get().settings, disabledSkills: [...bag] }
    set({ settings: next })
    await persistSettings(next)
  },

  refreshProviderCatalog: async () => {
    const { fetchProviderCatalog } = await import("@/lib/providers-catalog")
    try {
      const data = await fetchProviderCatalog()
      const next: Settings = {
        ...get().settings,
        providerCatalog: { data, fetchedAt: Date.now() },
      }
      set({ settings: next })
      await persistSettings(next)
    } catch (e) {
      console.warn("[providers-catalog] fetch başarısız:", e)
      throw e
    }
  },
}))

useSettingsStore.subscribe((state, prev) => {
  if (!state.loaded || prev.loaded) return
  void (async () => {
    try {
      const { isCatalogStale } = await import("@/lib/providers-catalog")
      const stale = isCatalogStale(
        state.settings.providerCatalog as
          | import("@/lib/providers-catalog").CachedCatalog
          | undefined,
      )
      if (stale) await state.refreshProviderCatalog()
    } catch {
      // Intentionally ignored.
    }
  })()
})
