
export type MemoryLayer =
  | "identity"
  | "pinned"
  | "episode"

export type MemoryScope = "project" | "global"

export interface MemoryEntry {
  id: string
  text: string
  layer: MemoryLayer
  scope: MemoryScope
  category?: string
  createdAt: number // epoch ms
  lastUsedAt: number
  useCount: number
  baseSalience: number
}

export interface MemoryStoreFile {
  version: number
  entries: MemoryEntry[]
}

export const STORE_VERSION = 1

export interface MemoryConfig {
  halfLifeDays: number
  budgetTokens: number
  maxEpisodes: number
  promoteAfterUses: number
  evictBelowSalience: number
  minEvictAgeDays: number
  mergeSimilarity: number
}

export const DEFAULT_MEMORY_CONFIG: MemoryConfig = {
  halfLifeDays: 14,
  budgetTokens: 800,
  maxEpisodes: 200,
  promoteAfterUses: 4,
  evictBelowSalience: 0.12,
  minEvictAgeDays: 7,
  mergeSimilarity: 0.82,
}
