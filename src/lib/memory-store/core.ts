import {
  type MemoryEntry,
  type MemoryConfig,
  type MemoryLayer,
  DEFAULT_MEMORY_CONFIG,
} from "./types"

const DAY_MS = 86_400_000

const LAYER_WEIGHT: Record<MemoryLayer, number> = { identity: 1, pinned: 0.9, episode: 0.6 }

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

export function recency(e: MemoryEntry, now: number, cfg: MemoryConfig): number {
  if (e.layer !== "episode") return 1
  const ageDays = Math.max(0, (now - e.lastUsedAt) / DAY_MS)
  return Math.pow(0.5, ageDays / cfg.halfLifeDays)
}

export function salience(e: MemoryEntry, now: number, cfg: MemoryConfig = DEFAULT_MEMORY_CONFIG): number {
  const rec = recency(e, now, cfg)
  const usage = 1 + Math.log1p(e.useCount) * 0.15
  return LAYER_WEIGHT[e.layer] * e.baseSalience * (0.4 + 0.6 * rec) * usage
}

function tokenSet(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^a-zçğıöşü0-9_]+/i)
      .filter((w) => w.length >= 2),
  )
}

export function jaccard(a: string, b: string): number {
  const sa = tokenSet(a)
  const sb = tokenSet(b)
  if (sa.size === 0 || sb.size === 0) return 0
  let inter = 0
  for (const t of sa) if (sb.has(t)) inter++
  return inter / (sa.size + sb.size - inter)
}

export function relevance(e: MemoryEntry, query: string): number {
  const q = tokenSet(query)
  if (q.size === 0) return 0
  const t = tokenSet(e.text + " " + (e.category ?? ""))
  let hit = 0
  for (const w of q) if (t.has(w)) hit++
  return hit / q.size
}

export function selectForContext(
  entries: MemoryEntry[],
  opts: { now: number; query?: string; budgetTokens?: number; cfg?: MemoryConfig },
): MemoryEntry[] {
  const cfg = opts.cfg ?? DEFAULT_MEMORY_CONFIG
  const budget = opts.budgetTokens ?? cfg.budgetTokens
  const q = opts.query?.trim()

  const ranked = entries
    .map((e) => {
      const sal = salience(e, opts.now, cfg)
      const rel = q ? relevance(e, q) : 0
      const score = e.layer === "episode" ? sal * (0.5 + rel) : sal + rel * 0.25
      return { e, score }
    })
    .sort((a, b) => {
      const lw = LAYER_WEIGHT[b.e.layer] - LAYER_WEIGHT[a.e.layer]
      if (lw !== 0) return lw
      return b.score - a.score
    })

  const out: MemoryEntry[] = []
  let used = 0
  for (const { e } of ranked) {
    const cost = estimateTokens(e.text) + 2
    if (used + cost > budget && out.length > 0) {
      if (e.layer === "episode") continue
    }
    out.push(e)
    used += cost
    if (used >= budget) break
  }
  return out
}

export function renderMemoryBlock(entries: MemoryEntry[]): string {
  if (entries.length === 0) return ""
  const byLayer = (l: MemoryLayer) => entries.filter((e) => e.layer === l)
  const sections: string[] = []
  const id = byLayer("identity")
  const pin = byLayer("pinned")
  const ep = byLayer("episode")
  if (id.length) sections.push("Identity / durable preferences:\n" + id.map((e) => `- ${e.text}`).join("\n"))
  if (pin.length) sections.push("Pinned facts:\n" + pin.map((e) => `- ${e.text}`).join("\n"))
  if (ep.length) sections.push("Relevant past observations:\n" + ep.map((e) => `- ${e.text}`).join("\n"))
  return [
    "# Learned Memory",
    "These entries come from Codezal's learned-memory database. Use them as durable guidance. If they conflict with the current user message or current files, the current context wins.",
    "",
    sections.join("\n\n"),
  ].join("\n")
}

export interface ConsolidateResult {
  entries: MemoryEntry[]
  merged: number
  promoted: number
  evicted: number
}

export function consolidate(
  input: MemoryEntry[],
  now: number,
  cfg: MemoryConfig = DEFAULT_MEMORY_CONFIG,
): ConsolidateResult {
  let merged = 0
  let promoted = 0
  let evicted = 0

  // 1) Merge — benzer metinli entry'leri tek entry'e indir (en erken createdAt'i
  const kept: MemoryEntry[] = []
  for (const e of input) {
    const dup = kept.find((k) => k.scope === e.scope && jaccard(k.text, e.text) >= cfg.mergeSimilarity)
    if (dup) {
      merged++
      dup.useCount += e.useCount
      dup.baseSalience = Math.max(dup.baseSalience, e.baseSalience)
      dup.lastUsedAt = Math.max(dup.lastUsedAt, e.lastUsedAt)
      dup.createdAt = Math.min(dup.createdAt, e.createdAt)
      if (rank(e.layer) > rank(dup.layer)) dup.layer = e.layer
      continue
    }
    kept.push({ ...e })
  }

  for (const e of kept) {
    if (e.layer === "episode" && e.useCount >= cfg.promoteAfterUses) {
      e.layer = "pinned"
      promoted++
    }
  }

  const survivors = kept.filter((e) => {
    if (e.layer !== "episode") return true
    const ageDays = (now - e.createdAt) / DAY_MS
    if (ageDays >= cfg.minEvictAgeDays && salience(e, now, cfg) < cfg.evictBelowSalience) {
      evicted++
      return false
    }
    return true
  })

  const episodes = survivors.filter((e) => e.layer === "episode")
  if (episodes.length > cfg.maxEpisodes) {
    const sortedEp = [...episodes].sort((a, b) => salience(b, now, cfg) - salience(a, now, cfg))
    const drop = new Set(sortedEp.slice(cfg.maxEpisodes).map((e) => e.id))
    evicted += drop.size
    return {
      entries: survivors.filter((e) => !drop.has(e.id)),
      merged,
      promoted,
      evicted,
    }
  }

  return { entries: survivors, merged, promoted, evicted }
}

function rank(l: MemoryLayer): number {
  return l === "identity" ? 3 : l === "pinned" ? 2 : 1
}
