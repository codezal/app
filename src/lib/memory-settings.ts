
export type MemorySettings = {
  dynamicAttach: boolean
  autonomousRemember: boolean
  autoLearn: boolean
  autoLearnSkipToolChats: boolean
  // (bkz. config/merge.ts sanitizasyonu).
  instructions: string[]
  maxFileBytes: number
  totalBudgetBytes: number
  memoryStoreEnabled: boolean
  memoryStoreBudgetTokens: number
}

export const DEFAULT_MEMORY: MemorySettings = {
  dynamicAttach: true,
  autonomousRemember: true,
  autoLearn: true,
  autoLearnSkipToolChats: false,
  instructions: [],
  maxFileBytes: 32_000,
  totalBudgetBytes: 96_000,
  memoryStoreEnabled: true,
  memoryStoreBudgetTokens: 800,
}
