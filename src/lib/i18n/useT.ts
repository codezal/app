//
import { useCallback } from "react"
import { useI18nStore } from "./index"
import { BASE_MESSAGES } from "./locales"
import { fmtKbd } from "@/lib/platform"
import type { MessageKey } from "./types-messages"

type Vars = Record<string, string | number>

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

export function useT(): (key: MessageKey, vars?: Vars) => string {
  const messages = useI18nStore((s) => s.messages)
  return useCallback(
    (key: MessageKey, vars?: Vars) => {
      const found = pathLookup(messages, key) ?? pathLookup(BASE_MESSAGES, key)
      if (found === undefined) {
        if (import.meta.env.DEV) console.warn(`[i18n] eksik anahtar: '${key}'`)
        return key
      }
      return fmtKbd(interpolate(found, vars))
    },
    [messages],
  )
}

export function useLocale() {
  return useI18nStore((s) => s.locale)
}

export function useSetLocale() {
  return useI18nStore((s) => s.setLocale)
}
