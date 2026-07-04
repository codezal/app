//
// opencode packages/app/src/context/global-sync/session-cache.ts

export const MAX_HYDRATED_SESSIONS = 12

export type EvictInput = {
  order: string[]
  keep: string | null
  preserve: Iterable<string>
  limit: number
}

export function pickIdleSessionEvictions(input: EvictInput): string[] {
  const guarded = new Set<string>(input.preserve)
  if (input.keep) guarded.add(input.keep)

  const stale: string[] = []
  for (const id of input.order) {
    if (input.order.length - stale.length <= input.limit) break
    if (guarded.has(id)) continue
    stale.push(id)
  }
  return stale
}

export function reconcileSeen(seenOrder: string[], poolKeys: string[]): string[] {
  const pool = new Set(poolKeys)
  const out: string[] = []
  for (const id of seenOrder) if (pool.has(id)) out.push(id)
  const have = new Set(out)
  for (const id of poolKeys) if (!have.has(id)) out.push(id)
  return out
}

export type EvictionPlanInput = {
  poolKeys: string[]
  seenOrder: string[]
  activeId: string | null
  streamingIds: string[]
  pinnedIds: string[]
  isDraft: boolean
  limit: number
  // Index'te (sidebar) bulunan = commit'li session id'leri. Verilirse, pool'da
  indexIds?: string[]
}

export function planSessionEviction(input: EvictionPlanInput): { order: string[]; stale: string[] } {
  const order = reconcileSeen(input.seenOrder, input.poolKeys)
  const preserve = [...input.streamingIds, ...input.pinnedIds]
  if (input.isDraft && input.activeId) preserve.push(input.activeId)
  if (input.indexIds) {
    const committed = new Set(input.indexIds)
    for (const id of input.poolKeys) if (!committed.has(id)) preserve.push(id)
  }
  const stale = pickIdleSessionEvictions({ order, keep: input.activeId, preserve, limit: input.limit })
  return { order, stale }
}
