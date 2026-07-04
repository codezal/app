import { invoke } from "@tauri-apps/api/core"

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
