import { loadSession as fsLoad } from "@/lib/storage"
import type { Session } from "@/store/types"
import { tauriDb } from "./driver.tauri"
import { applySchema } from "./schema"
import { migrateJsonToSqlite, type JsonIndex, type JsonSource } from "./migrate-json"
import type { Db } from "./driver"

export const db: Db = tauriDb

const jsonSource: JsonSource = {
  loadIndex: () => fsLoad<JsonIndex>("_index", {}),
  loadSession: (id) => fsLoad<Session | null>(id, null),
}

let booted: Promise<void> | null = null
export function bootstrapDb(): Promise<void> {
  if (!booted) {
    const p = (async () => {
      await applySchema(db)
      await migrateJsonToSqlite(db, jsonSource)
    })()
    // M20: a failed boot must not be cached forever — reset so the next caller
    // retries instead of re-receiving the same permanent rejection.
    void p.catch(() => {
      if (booted === p) booted = null
    })
    booted = p
  }
  return booted
}

export type { Db } from "./driver"
export * from "./sessions-db"
export * from "./memory-db"
