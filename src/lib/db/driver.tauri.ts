import { invoke } from "@tauri-apps/api/core"
import type { Db } from "./driver"

export const tauriDb: Db = {
  async exec(sql: string, params: unknown[] = []): Promise<void> {
    await invoke("db_execute", { sql, params })
  },
  async select<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
    return invoke<T[]>("db_select", { sql, params })
  },
  async tx<T>(fn: (db: Db) => Promise<T>): Promise<T> {
    const batch: { sql: string; params: unknown[] }[] = []
    const collector: Db = {
      async exec(sql: string, params: unknown[] = []): Promise<void> {
        batch.push({ sql, params })
      },
      async select(): Promise<never[]> {
        throw new Error("tx içinde select desteklenmiyor (collector batch'e yazar)")
      },
      tx(): never {
        throw new Error("iç içe tx desteklenmiyor")
      },
    }
    const result = await fn(collector)
    await invoke("db_batch", { statements: batch })
    return result
  },
}
