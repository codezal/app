import { unzipSync, strFromU8 } from "fflate"

export function unzip(bytes: Uint8Array): Record<string, Uint8Array> {
  return unzipSync(bytes)
}

export function entryText(entries: Record<string, Uint8Array>, name: string): string {
  const u8 = entries[name]
  return u8 ? strFromU8(u8) : ""
}

export function entriesUnder(entries: Record<string, Uint8Array>, prefix: string, suffix = ".xml"): string[] {
  return Object.keys(entries)
    .filter((n) => n.startsWith(prefix) && n.endsWith(suffix))
    .sort(naturalCompare)
}

export function naturalCompare(a: string, b: string): number {
  const re = /(\d+)|(\D+)/g
  const ax = a.match(re) ?? []
  const bx = b.match(re) ?? []
  const n = Math.min(ax.length, bx.length)
  for (let i = 0; i < n; i++) {
    const an = Number(ax[i])
    const bn = Number(bx[i])
    if (!Number.isNaN(an) && !Number.isNaN(bn)) {
      if (an !== bn) return an - bn
    } else if (ax[i] !== bx[i]) {
      return ax[i] < bx[i] ? -1 : 1
    }
  }
  return ax.length - bx.length
}

export function decodeXmlEntities(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&amp;/g, "&")
}

export function extractTagTexts(xml: string, tag: string): string[] {
  const re = new RegExp(`<${escapeTag(tag)}(?:\\s[^>]*)?>([\\s\\S]*?)</${escapeTag(tag)}>`, "g")
  const out: string[] = []
  let m: RegExpExecArray | null
  while ((m = re.exec(xml)) !== null) out.push(decodeXmlEntities(m[1]))
  return out
}

function escapeTag(tag: string): string {
  return tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}
