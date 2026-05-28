// Process env var okuyucu — Tauri komut üzerinden Rust tarafından alır.
// Browser dışı erişim çünkü `process.env` sadece Node tarafında, Tauri webview
// bunu görmez; Rust `std::env::var` cevap verir.
import { invoke } from "@tauri-apps/api/core"

// In-memory cache — aynı env var defalarca okunur (provider list refresh vs.)
const cache = new Map<string, string | null>()

export async function readEnvVar(name: string): Promise<string | null> {
  if (cache.has(name)) return cache.get(name) ?? null
  try {
    const v = await invoke<string | null>("read_env_var", { name })
    cache.set(name, v ?? null)
    return v ?? null
  } catch (e) {
    console.warn(`[env-reader] read_env_var('${name}') failed:`, e)
    cache.set(name, null)
    return null
  }
}

export function clearEnvCache(): void {
  cache.clear()
}

// UI için: provider'ın env varlarından hangileri set edilmiş (boolean map).
// envFallback ayarına bakmaz — UI badge için ham bilgi.
export async function probeEnvVars(names: readonly string[]): Promise<Record<string, boolean>> {
  const out: Record<string, boolean> = {}
  await Promise.all(
    names.map(async (n) => {
      const v = await readEnvVar(n)
      out[n] = Boolean(v && v.trim())
    }),
  )
  return out
}
