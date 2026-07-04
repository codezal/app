// Uygulama @tauri-apps/plugin-sql (Rust sqlx) ile, testler node:sqlite ile bu
export interface Db {
  exec(sql: string, params?: unknown[]): Promise<void>
  select<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>
  tx<T>(fn: (db: Db) => Promise<T>): Promise<T>
}
