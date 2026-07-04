//
import { normalizeFsPath } from "./file-content-cache"

export type ScrollPos = { top: number; left: number }

const MAX_ENTRIES = 500

const cache = new Map<string, ScrollPos>()

export function getFileScroll(path: string): ScrollPos | undefined {
  return cache.get(normalizeFsPath(path))
}

export function setFileScroll(path: string, pos: ScrollPos): void {
  const key = normalizeFsPath(path)
  cache.delete(key)
  cache.set(key, { top: pos.top, left: pos.left })
  while (cache.size > MAX_ENTRIES) {
    const oldest = cache.keys().next().value
    if (oldest === undefined) break
    cache.delete(oldest)
  }
}

export function clearFileScrollCache(): void {
  cache.clear()
}

export function fileScrollCacheSize(): number {
  return cache.size
}
