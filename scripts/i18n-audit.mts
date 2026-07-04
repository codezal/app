import { LOCALES } from "../src/lib/i18n/types"
import { loadLocaleMessages } from "../src/lib/i18n/locales"

type Flat = Record<string, string>

function flatten(obj: unknown, prefix = "", out: Flat = {}): Flat {
  if (obj && typeof obj === "object") {
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      const key = prefix ? `${prefix}.${k}` : k
      if (typeof v === "string") out[key] = v
      else flatten(v, key, out)
    }
  }
  return out
}

const en = flatten(await loadLocaleMessages("en"))
const enKeys = Object.keys(en)
console.log(`EN toplam string key: ${enKeys.length}\n`)

const rows: { code: string; missing: number; identical: number; pct: number }[] = []

for (const meta of LOCALES) {
  if (meta.code === "en") continue
  const loc = flatten(await loadLocaleMessages(meta.code))
  let missing = 0
  let identical = 0
  for (const k of enKeys) {
    if (!(k in loc)) {
      missing++
    } else if (loc[k] === en[k] && en[k].trim() !== "") {
      identical++
    }
  }
  const translated = enKeys.length - missing - identical
  const pct = Math.round((translated / enKeys.length) * 100)
  rows.push({ code: meta.code, missing, identical, pct })
}

rows.sort((a, b) => a.pct - b.pct)
console.log("locale  | çevrilmemiş(=EN) | eksik | tam% ")
console.log("--------|------------------|-------|------")
for (const r of rows) {
  console.log(
    `${r.code.padEnd(7)} | ${String(r.identical).padStart(16)} | ${String(r.missing).padStart(5)} | ${String(r.pct).padStart(3)}%`,
  )
}
