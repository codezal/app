//
// etmez.

const MAX_ENTRIES = 40
const MAX_BYTES = 20 * 1024 * 1024

type Entry = { text: string; bytes: number }

const lru = new Map<string, Entry>()
let totalBytes = 0

// dir-refresh event'leri kaybolur.
export function normalizeFsPath(p: string): string {
  const s = p.replace(/\\/g, "/").replace(/\/+$/, "")
  if (s === "" && p.startsWith("/")) return "/"
  if (/^[A-Za-z]:$/.test(s)) return s + "/"
  return s
}

function approxBytes(text: string): number {
  return text.length * 2
}

function evict(): void {
  while ((lru.size > MAX_ENTRIES || totalBytes > MAX_BYTES) && lru.size > 1) {
    const oldest = lru.keys().next().value
    if (oldest === undefined) return
    const entry = lru.get(oldest)
    if (entry) totalBytes -= entry.bytes
    lru.delete(oldest)
  }
}

export function getFileContent(path: string): string | undefined {
  const key = normalizeFsPath(path)
  const entry = lru.get(key)
  if (entry === undefined) return undefined
  lru.delete(key)
  lru.set(key, entry)
  return entry.text
}

export function setFileContent(path: string, text: string): void {
  const key = normalizeFsPath(path)
  const prev = lru.get(key)
  if (prev) totalBytes -= prev.bytes
  lru.delete(key)
  const bytes = approxBytes(text)
  lru.set(key, { text, bytes })
  totalBytes += bytes
  evict()
}

export function invalidateFileContent(path: string): void {
  const key = normalizeFsPath(path)
  const entry = lru.get(key)
  if (entry === undefined) return
  totalBytes -= entry.bytes
  lru.delete(key)
}

export function clearFileContentCache(): void {
  lru.clear()
  totalBytes = 0
}

export function fileContentCacheStats(): { entries: number; bytes: number } {
  return { entries: lru.size, bytes: totalBytes }
}
