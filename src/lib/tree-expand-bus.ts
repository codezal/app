//
import { normalizeFsPath } from "./file-content-cache"

type Listener = () => void

const subs = new Map<string, Set<Listener>>()

export function subscribeExpand(dir: string, cb: Listener): () => void {
  const key = normalizeFsPath(dir)
  let set = subs.get(key)
  if (!set) {
    set = new Set()
    subs.set(key, set)
  }
  set.add(cb)
  return () => {
    const s = subs.get(key)
    if (!s) return
    s.delete(cb)
    if (s.size === 0) subs.delete(key)
  }
}

export function emitExpand(dir: string): void {
  const set = subs.get(normalizeFsPath(dir))
  if (!set) return
  for (const cb of [...set]) cb()
}

// Test izolasyonu.
export function clearExpandBus(): void {
  subs.clear()
}
