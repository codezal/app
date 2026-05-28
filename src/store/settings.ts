import { create } from "zustand"
import { loadSettingsFile, saveSettingsFile } from "@/lib/storage"
import { PROVIDERS } from "@/lib/providers"
import { DEFAULT_LOCALE, useI18nStore } from "@/lib/i18n"
import { DEFAULT_APPEARANCE, type Appearance } from "@/lib/theme"
import { DEFAULT_TOKEN_SAVERS } from "@/lib/token-savers/types"
import type { Settings } from "./types"

const DEFAULT: Settings = {
  apiKeys: {},
  defaultProvider: "openai",
  defaultModel: PROVIDERS.openai.defaultModel,
  theme: "system",
  fontScale: "m",
  language: DEFAULT_LOCALE,
  approvalMode: "bypass",
  approvalRules: [],
  mcpServers: [],
  autoCompact: {
    enabled: true,
    triggerPct: 90,
    targetPct: 40,
    keepLast: 10,
  },
  hooks: [],
  semantic: {
    enabled: false,
    provider: "ollama",
    baseUrl: "",
    model: "nomic-embed-text",
    apiKey: "",
    topK: 5,
  },
  appearance: DEFAULT_APPEARANCE,
  tokenSavers: DEFAULT_TOKEN_SAVERS,
}

type SettingsState = {
  settings: Settings
  loaded: boolean
  load: () => Promise<void>
  update: (patch: Partial<Settings>) => Promise<void>
  setApiKey: (provider: keyof Settings["apiKeys"], key: string) => Promise<void>
  // models.dev'den katalog çek + kaydet
  refreshProviderCatalog: () => Promise<void>
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  settings: DEFAULT,
  loaded: false,

  load: async () => {
    const loaded = await loadSettingsFile<Settings>(DEFAULT)
    // Nested merge — older settings files may lack newer blocks.
    const persistedAppearance = loaded.appearance ?? ({} as Partial<Appearance>)
    const mergedAppearance: Appearance = {
      ...DEFAULT_APPEARANCE,
      ...persistedAppearance,
      // Migrate legacy `theme` field into appearance.mode if appearance was absent.
      mode: persistedAppearance.mode ?? loaded.theme ?? DEFAULT_APPEARANCE.mode,
    }
    // One-time migration: legacy customLight/customDark → customsByPreset keyed by
    // the active light/dark preset. Drop the legacy fields once copied.
    const lightId = mergedAppearance.lightPreset
    const darkId = mergedAppearance.darkPreset
    const byPreset: Record<string, Partial<NonNullable<Appearance["customsByPreset"]>>[string]> = {
      ...(mergedAppearance.customsByPreset ?? {}),
    }
    if (mergedAppearance.customLight && !byPreset[lightId]) {
      byPreset[lightId] = mergedAppearance.customLight
    }
    if (mergedAppearance.customDark && !byPreset[darkId]) {
      byPreset[darkId] = mergedAppearance.customDark
    }
    mergedAppearance.customsByPreset = byPreset
    delete mergedAppearance.customLight
    delete mergedAppearance.customDark
    // Nested merge for tokenSavers so adding new sub-features in future
    // releases doesn't blow away the user's existing toggles.
    const loadedTokens = loaded.tokenSavers ?? ({} as Partial<NonNullable<Settings["tokenSavers"]>>)
    const mergedTokens: NonNullable<Settings["tokenSavers"]> = {
      briefMode: { ...DEFAULT_TOKEN_SAVERS.briefMode, ...(loadedTokens.briefMode ?? {}) },
      compactOutput: {
        ...DEFAULT_TOKEN_SAVERS.compactOutput,
        ...(loadedTokens.compactOutput ?? {}),
        filters: {
          ...DEFAULT_TOKEN_SAVERS.compactOutput.filters,
          ...(loadedTokens.compactOutput?.filters ?? {}),
        },
      },
      codeMap: { ...DEFAULT_TOKEN_SAVERS.codeMap, ...(loadedTokens.codeMap ?? {}) },
    }
    const merged: Settings = {
      ...DEFAULT,
      ...loaded,
      autoCompact: { ...DEFAULT.autoCompact, ...(loaded.autoCompact ?? {}) },
      appearance: mergedAppearance,
      tokenSavers: mergedTokens,
      // Keep `theme` in sync with appearance.mode so legacy readers continue to work.
      theme: mergedAppearance.mode,
    }
    set({ settings: merged, loaded: true })
    // i18n: apply persisted locale (falls back to DEFAULT_LOCALE if absent)
    void useI18nStore.getState().setLocale(merged.language ?? DEFAULT_LOCALE)
  },

  update: async (patch) => {
    const prev = get().settings
    const next = { ...prev, ...patch }
    set({ settings: next })
    await saveSettingsFile(next)
    // Dil değişti mi → i18n store'a uygula
    if (patch.language && patch.language !== prev.language) {
      void useI18nStore.getState().setLocale(patch.language)
    }
  },

  setApiKey: async (provider, key) => {
    const next: Settings = {
      ...get().settings,
      apiKeys: { ...get().settings.apiKeys, [provider]: key },
    }
    set({ settings: next })
    await saveSettingsFile(next)
  },

  refreshProviderCatalog: async () => {
    // Dinamik import — fetch ediliği yere kadar bundle'a girmesin
    const { fetchProviderCatalog } = await import("@/lib/providers-catalog")
    try {
      const data = await fetchProviderCatalog()
      const next: Settings = {
        ...get().settings,
        providerCatalog: { data, fetchedAt: Date.now() },
      }
      set({ settings: next })
      await saveSettingsFile(next)
    } catch (e) {
      console.warn("[providers-catalog] fetch başarısız:", e)
      throw e
    }
  },
}))

// Yükleme sonrası: cache yoksa veya 24 saatten eski ise sessizce arka planda yenile.
// İlk start'ta yine offline ise hardcoded fallback kullanılır.
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
      // sessiz geç — hardcoded fallback iş görür
    }
  })()
})
