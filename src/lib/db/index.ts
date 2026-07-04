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
    booted = (async () => {
      await applySchema(db)
      await migrateJsonToSqlite(db, jsonSource)
    })()
  }
  return booted
}

export type { Db } from "./driver"
export * from "./sessions-db"
export * from "./memory-db"
