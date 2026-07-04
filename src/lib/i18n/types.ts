
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
  nativeName: string
  rtl?: boolean
}

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

export const DEFAULT_LOCALE: Locale = "en"

export function isLocale(v: unknown): v is Locale {
  return typeof v === "string" && LOCALES.some((l) => l.code === v)
}

export function getLocaleMeta(code: Locale): LocaleMeta {
  return LOCALES.find((l) => l.code === code) ?? LOCALES[0]
}

export const LOCALE_ENGLISH_NAME: Record<Locale, string> = {
  en: "English",
  tr: "Turkish",
  "zh-CN": "Simplified Chinese",
  "zh-TW": "Traditional Chinese",
  ko: "Korean",
  de: "German",
  es: "Spanish",
  fr: "French",
  da: "Danish",
  ja: "Japanese",
  pl: "Polish",
  ru: "Russian",
  uk: "Ukrainian",
  bs: "Bosnian",
  ar: "Arabic",
  no: "Norwegian",
  "pt-BR": "Brazilian Portuguese",
  th: "Thai",
}

export function languageName(code: Locale): string {
  return LOCALE_ENGLISH_NAME[code] ?? "English"
}

export function localeFromTag(tag: string): Locale | null {
  const t = tag.trim().toLowerCase().replace(/_/g, "-")
  if (!t) return null
  const codes = LOCALES.map((l) => l.code)
  const exact = codes.find((c) => c.toLowerCase() === t)
  if (exact) return exact
  const base = t.split("-")[0]
  if (base === "zh") return /(^|-)(tw|hk|mo|hant)(-|$)/.test(t) ? "zh-TW" : "zh-CN"
  if (base === "pt") return "pt-BR"
  const byBase = codes.find((c) => c.toLowerCase() === base)
  return byBase ?? null
}
