import { invoke } from "@tauri-apps/api/core"

export async function queryExternalSqlite<T = Record<string, unknown>>(
  path: string,
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  return invoke<T[]>("db_select_external", { path, sql, params })
}
