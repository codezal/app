// Code Map queries — pure functions over a loaded CodeMap. Return plain
// data arrays so the tool layer can format them as text for the model.

import type { CodeMap, CodeSymbol } from "./schema"

export function searchSymbols(map: CodeMap, query: string, limit = 20): CodeSymbol[] {
  const q = query.trim().toLowerCase()
  if (!q) return []
  const exact = map.byName[q]
  const out: CodeSymbol[] = []
  const seen = new Set<string>()
  if (exact) {
    for (const id of exact) {
      const sym = findById(map, id)
      if (sym && !seen.has(id)) {
        out.push(sym)
        seen.add(id)
        if (out.length >= limit) return out
      }
    }
  }
  // Partial match — scan once. Acceptable on indexes up to ~20k symbols.
  for (const sym of map.symbols) {
    if (seen.has(sym.id)) continue
    if (sym.name.toLowerCase().includes(q)) {
      out.push(sym)
      seen.add(sym.id)
      if (out.length >= limit) return out
    }
  }
  return out
}

export function findById(map: CodeMap, id: string): CodeSymbol | null {
  return map.symbols.find((s) => s.id === id) ?? null
}

// Resolve a user-typed identifier (no id suffix) to candidate symbols.
// If multiple definitions share the name, all are returned.
export function resolveByName(map: CodeMap, name: string): CodeSymbol[] {
  const ids = map.byName[name.toLowerCase()] ?? []
  return ids.map((id) => findById(map, id)).filter((s): s is CodeSymbol => s !== null)
}

export function callers(map: CodeMap, id: string, limit = 30): CodeSymbol[] {
  const seen = new Set<string>()
  const out: CodeSymbol[] = []
  for (const e of map.edges) {
    if (e.to !== id) continue
    if (seen.has(e.from)) continue
    const s = findById(map, e.from)
    if (!s) continue
    out.push(s)
    seen.add(e.from)
    if (out.length >= limit) return out
  }
  return out
}

export function callees(map: CodeMap, id: string, limit = 30): CodeSymbol[] {
  const seen = new Set<string>()
  const out: CodeSymbol[] = []
  for (const e of map.edges) {
    if (e.from !== id) continue
    if (seen.has(e.to)) continue
    const s = findById(map, e.to)
    if (!s) continue
    out.push(s)
    seen.add(e.to)
    if (out.length >= limit) return out
  }
  return out
}

// BFS shortest path in the calls graph. Returns the ordered chain
// [from, ..., to] inclusive on both ends, or [] when unreachable.
export function trace(map: CodeMap, fromId: string, toId: string, maxDepth = 8): CodeSymbol[] {
  if (fromId === toId) {
    const s = findById(map, fromId)
    return s ? [s] : []
  }
  // Adjacency map cached per call (cheap on small graphs).
  const adj = new Map<string, string[]>()
  for (const e of map.edges) {
    const arr = adj.get(e.from) ?? []
    arr.push(e.to)
    adj.set(e.from, arr)
  }
  const prev = new Map<string, string>()
  const queue: string[] = [fromId]
  const seen = new Set<string>([fromId])
  let depth = 0
  let frontier = 1
  let nextFrontier = 0
  let found = false
  while (queue.length > 0) {
    const cur = queue.shift()!
    const neighbors = adj.get(cur) ?? []
    for (const n of neighbors) {
      if (seen.has(n)) continue
      seen.add(n)
      prev.set(n, cur)
      if (n === toId) {
        found = true
        break
      }
      queue.push(n)
      nextFrontier++
    }
    if (found) break
    if (--frontier === 0) {
      depth++
      if (depth > maxDepth) break
      frontier = nextFrontier
      nextFrontier = 0
    }
  }
  if (!found) return []
  const chain: string[] = [toId]
  let cur: string | undefined = toId
  while (cur && cur !== fromId) {
    cur = prev.get(cur)
    if (cur) chain.unshift(cur)
  }
  return chain.map((id) => findById(map, id)).filter((s): s is CodeSymbol => s !== null)
}

// Transitive callers within `depth` hops. Useful as "blast radius" for a
// rename or signature change.
export function impact(map: CodeMap, id: string, depth = 2, limit = 60): CodeSymbol[] {
  const reverseAdj = new Map<string, string[]>()
  for (const e of map.edges) {
    const arr = reverseAdj.get(e.to) ?? []
    arr.push(e.from)
    reverseAdj.set(e.to, arr)
  }
  const seen = new Set<string>([id])
  const out: CodeSymbol[] = []
  let frontier: string[] = [id]
  for (let d = 0; d < depth && frontier.length > 0; d++) {
    const next: string[] = []
    for (const cur of frontier) {
      for (const pre of reverseAdj.get(cur) ?? []) {
        if (seen.has(pre)) continue
        seen.add(pre)
        const s = findById(map, pre)
        if (s) {
          out.push(s)
          if (out.length >= limit) return out
        }
        next.push(pre)
      }
    }
    frontier = next
  }
  return out
}

export function formatSymbol(s: CodeSymbol): string {
  return `${s.file}:${s.line} ${s.kind} ${s.name}${s.sig ? ` — ${s.sig}` : ""}`
}
