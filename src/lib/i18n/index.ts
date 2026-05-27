// i18n motoru — zustand store + t() lookup + interpolasyon + RTL apply.
// Kullanım:
//   import { useT } from "@/lib/i18n/useT"
//   const t = useT()
//   <button>{t("composer.send")}</button>
//   t("toast.workspaceConnected", { folder: "…" })   // {folder} substitusyonu
//
// Anahtar yoksa: 1) TR base fallback, 2) o da yoksa anahtarın kendisi döner (devel'da görünür).
import { create } from "zustand"
import { BASE_MESSAGES, loadLocaleMessages } from "./locales"
import { DEFAULT_LOCALE, getLocaleMeta, isLocale, type Locale } from "./types"
import type { MessageKey, Messages } from "./types-messages"

type Vars = Record<string, string | number>

type I18nState = {
  locale: Locale
  messages: Messages
  loading: boolean
  // Locale değiştir + dosyayı yükle + <html lang> ve dir uygula
  setLocale: (next: Locale) => Promise<void>
}

export const useI18nStore = create<I18nState>((set) => ({
  locale: DEFAULT_LOCALE,
  messages: BASE_MESSAGES,
  loading: false,

  setLocale: async (next) => {
    if (!isLocale(next)) return
    set({ loading: true })
    try {
      const msgs = await loadLocaleMessages(next)
      set({ locale: next, messages: msgs, loading: false })
      applyHtmlLocale(next)
    } catch (e) {
      console.warn(`[i18n] setLocale '${next}' başarısız:`, e)
      set({ loading: false })
    }
  },
}))

// Path lookup — "settings.general.language" → messages.settings.general.language
// Tip-güvenli MessageKey ile string anahtar bekler. Bulunamazsa BASE_MESSAGES (TR) fallback.
function pathLookup(obj: unknown, path: string): string | undefined {
  const parts = path.split(".")
  let cur: unknown = obj
  for (const p of parts) {
    if (cur && typeof cur === "object" && p in (cur as Record<string, unknown>)) {
      cur = (cur as Record<string, unknown>)[p]
    } else {
      return undefined
    }
  }
  return typeof cur === "string" ? cur : undefined
}

function interpolate(str: string, vars?: Vars): string {
  if (!vars) return str
  return str.replace(/\{(\w+)\}/g, (_, k: string) =>
    k in vars ? String(vars[k]) : `{${k}}`,
  )
}

// Düz çağrı API — React dışında (ör. lib/utils, toast) kullanılır.
// React component'lerinde useT() hook'unu tercih et — re-render garantili.
export function t(key: MessageKey, vars?: Vars): string {
  const { messages } = useI18nStore.getState()
  const found = pathLookup(messages, key) ?? pathLookup(BASE_MESSAGES, key)
  if (found === undefined) {
    if (import.meta.env.DEV) console.warn(`[i18n] eksik anahtar: '${key}'`)
    return key
  }
  return interpolate(found, vars)
}

// HTML <html lang="…" dir="…"> uygula — Tauri webview'inde de geçerli
function applyHtmlLocale(code: Locale): void {
  if (typeof document === "undefined") return
  const meta = getLocaleMeta(code)
  document.documentElement.lang = code
  document.documentElement.dir = meta.rtl ? "rtl" : "ltr"
}

// Settings yüklendiğinde App.tsx çağırır — settings.language varsa onu, yoksa default.
export async function initI18n(initial?: Locale): Promise<void> {
  const code = isLocale(initial) ? initial : DEFAULT_LOCALE
  await useI18nStore.getState().setLocale(code)
}

export type { Locale, Messages, MessageKey }
export { DEFAULT_LOCALE, getLocaleMeta, isLocale }
export { LOCALES } from "./types"
