import { DatabaseSync } from "node:sqlite"
import type { Db } from "@/lib/db/driver"

export function nodeDb(path = ":memory:"): Db & { close(): void } {
  const sqlite = new DatabaseSync(path)
  sqlite.exec("PRAGMA foreign_keys = ON")
  const db: Db & { close(): void } = {
    async exec(sql: string, params?: unknown[]): Promise<void> {
      // Parametresiz (DDL dahil) → exec; parametreli → prepare+run.
      if (!params || params.length === 0) {
        sqlite.exec(sql)
        return
      }
      sqlite.prepare(sql).run(...(params as never[]))
    },
    async select<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]> {
      return sqlite.prepare(sql).all(...((params ?? []) as never[])) as T[]
    },
    async tx<T>(fn: (db: Db) => Promise<T>): Promise<T> {
      sqlite.exec("BEGIN")
      try {
        const result = await fn(db)
        sqlite.exec("COMMIT")
        return result
      } catch (e) {
        sqlite.exec("ROLLBACK")
        throw e
      }
    },
    close(): void {
      sqlite.close()
    },
  }
  return db
}
