import { create } from "zustand"
import { loadSettingsFile, saveSettingsFile } from "@/lib/storage"
import { PROVIDERS } from "@/lib/providers"
import { DEFAULT_LOCALE, useI18nStore } from "@/lib/i18n"
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
    // autoCompact alanı eski dosyalarda eksik olabilir — nested merge
    const merged: Settings = {
      ...DEFAULT,
      ...loaded,
      autoCompact: { ...DEFAULT.autoCompact, ...(loaded.autoCompact ?? {}) },
    }
    set({ settings: merged, loaded: true })
    // i18n: kaydedilmiş locale'i uygula (yoksa default tr)
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
