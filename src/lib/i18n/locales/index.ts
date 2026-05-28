// Single source of truth for locale files. To add a new language:
// 1. Create locales/<code>.ts (default export = Messages)
// 2. Add a loader entry below (lazy import)
// 3. Add metadata to LOCALES in types.ts
//
// EN is the base language — missing keys fall back to it (see i18n/index.ts).
// Other languages may be partial; the type system requires every key to be
// present in every locale file (use the EN value as a placeholder when starting).

import type { Locale } from "../types"
import type { Messages } from "../types-messages"
import en from "./en"

// Lazy loaders — chunk split: inactive languages should not enter the bundle.
const LOADERS: Record<Locale, () => Promise<{ default: Messages }>> = {
  en: () => Promise.resolve({ default: en }),
  tr: () => import("./tr"),
  "zh-CN": () => import("./zh-CN"),
  "zh-TW": () => import("./zh-TW"),
  ko: () => import("./ko"),
  de: () => import("./de"),
  es: () => import("./es"),
  fr: () => import("./fr"),
  da: () => import("./da"),
  ja: () => import("./ja"),
  pl: () => import("./pl"),
  ru: () => import("./ru"),
  uk: () => import("./uk"),
  bs: () => import("./bs"),
  ar: () => import("./ar"),
  no: () => import("./no"),
  "pt-BR": () => import("./pt-BR"),
  th: () => import("./th"),
}

export async function loadLocaleMessages(code: Locale): Promise<Messages> {
  try {
    const mod = await LOADERS[code]()
    return mod.default
  } catch (e) {
    console.warn(`[i18n] failed to load locale '${code}', falling back to EN:`, e)
    return en
  }
}

// Synchronous EN — used for the very first render at app start; other locales load async.
export const BASE_MESSAGES: Messages = en
