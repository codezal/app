// Locale dosyalarının tek-doğru kayıt yeri. Yeni dil eklerken:
// 1. locales/<code>.ts oluştur (varsayılan export Messages)
// 2. Aşağıya satır ekle (lazy import)
// 3. types.ts → LOCALES dizisine meta ekle
//
// TR base — eksik anahtar fallback olarak buradan okunur (bk. i18n/index.ts).
// Diğer diller henüz tam çevrilmediyse partial olabilir; tip sistemi tam Messages
// beklediği için her dil dosyasında bütün anahtarlar dolu olmalı (TR placeholder olarak başla).

import type { Locale } from "../types"
import type { Messages } from "../types-messages"
import tr from "./tr"

// Lazy yükleyiciler — chunk split: aktif olmayan diller bundle'a girmesin.
const LOADERS: Record<Locale, () => Promise<{ default: Messages }>> = {
  tr: () => Promise.resolve({ default: tr }),
  en: () => import("./en"),
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
    console.warn(`[i18n] '${code}' locale yüklenemedi, TR fallback:`, e)
    return tr
  }
}

// Senkron TR — uygulama açılışında ilk render için (diğer diller async yüklenir)
export const BASE_MESSAGES: Messages = tr
