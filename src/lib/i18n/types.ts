// i18n tip tanımları — desteklenen dillerin tek-doğru kaynağı.
// Yeni dil eklerken: LOCALES dizisine ekle, locales/<code>.ts oluştur, locales/index.ts'e kaydet.

export type Locale =
  | "en"
  | "tr"
  | "zh-CN"
  | "zh-TW"
  | "ko"
  | "de"
  | "es"
  | "fr"
  | "da"
  | "ja"
  | "pl"
  | "ru"
  | "uk"
  | "bs"
  | "ar"
  | "no"
  | "pt-BR"
  | "th"

export type LocaleMeta = {
  code: Locale
  // Native ad — Settings'te bu görünür (örn "Türkçe", "Deutsch")
  nativeName: string
  // RTL diller: <html dir="rtl"> uygulanır
  rtl?: boolean
}

// Görüntü sırası (Settings dropdown). İngilizce + ana ASCII diller önce, sonra alfabe.
export const LOCALES: readonly LocaleMeta[] = [
  { code: "en", nativeName: "English" },
  { code: "zh-CN", nativeName: "简体中文" },
  { code: "zh-TW", nativeName: "繁體中文" },
  { code: "ko", nativeName: "한국어" },
  { code: "de", nativeName: "Deutsch" },
  { code: "es", nativeName: "Español" },
  { code: "fr", nativeName: "Français" },
  { code: "da", nativeName: "Dansk" },
  { code: "ja", nativeName: "日本語" },
  { code: "pl", nativeName: "Polski" },
  { code: "ru", nativeName: "Русский" },
  { code: "uk", nativeName: "Українська" },
  { code: "bs", nativeName: "Bosanski" },
  { code: "ar", nativeName: "العربية", rtl: true },
  { code: "no", nativeName: "Norsk" },
  { code: "pt-BR", nativeName: "Português (Brasil)" },
  { code: "th", nativeName: "ไทย" },
  { code: "tr", nativeName: "Türkçe" },
] as const

export const DEFAULT_LOCALE: Locale = "tr"

export function isLocale(v: unknown): v is Locale {
  return typeof v === "string" && LOCALES.some((l) => l.code === v)
}

export function getLocaleMeta(code: Locale): LocaleMeta {
  return LOCALES.find((l) => l.code === code) ?? LOCALES[0]
}
