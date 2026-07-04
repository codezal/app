import { loadLocaleMessages } from "../src/lib/i18n/locales"
type Flat = Record<string, string>
function flatten(o: unknown, p = "", out: Flat = {}): Flat {
  if (o && typeof o === "object")
    for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
      const key = p ? `${p}.${k}` : k
      if (typeof v === "string") out[key] = v
      else flatten(v, key, out)
    }
  return out
}
const en = flatten(await loadLocaleMessages("en"))
const enKeys = Object.keys(en)
const de = flatten(await loadLocaleMessages("de"))
const sec = (k: string) => k.split(".")[0]
const missingBySec: Record<string, number> = {}
const identBySec: Record<string, number> = {}
for (const k of enKeys) {
  if (!(k in de)) missingBySec[sec(k)] = (missingBySec[sec(k)] || 0) + 1
  else if (de[k] === en[k] && en[k].trim() !== "") identBySec[sec(k)] = (identBySec[sec(k)] || 0) + 1
}
console.log("=== EKSİK key (de, tüm dillerde benzer) — section başına ===")
Object.entries(missingBySec).sort((a,b)=>b[1]-a[1]).forEach(([s,n])=>console.log(`${n.toString().padStart(4)}  ${s}`))
console.log("\n=== ÇEVRİLMEMİŞ (=EN) — section başına (de) ===")
Object.entries(identBySec).sort((a,b)=>b[1]-a[1]).slice(0,15).forEach(([s,n])=>console.log(`${n.toString().padStart(4)}  ${s}`))
