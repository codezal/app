// Loader for the project-level config file: `<workspace>/.codezal/config.json`.
//
// The file is hand-edited, so it goes through the full pipeline: variable
// substitution ({env:}/{file:}) → JSONC parse (comments + trailing commas) →
// lenient schema validation. Results are cached per workspace path; the cache
// is warmed imperatively (e.g. before a send) and read synchronously by hot
// paths such as the pre-tool hook check.

import { exists, readTextFile } from "@tauri-apps/plugin-fs"
import { parseJsonc } from "./parse"
import { substituteText } from "./variable"
import { parseProjectConfig, type ProjectConfig } from "./schema"

const PROJECT_CONFIG_REL = ".codezal/config.json"

// wsPath → resolved project config (or null when absent/invalid).
const cache = new Map<string, ProjectConfig | null>()

function configPath(wsPath: string): string {
  return wsPath.replace(/[\\/]+$/, "") + "/" + PROJECT_CONFIG_REL
}

// Load (and cache) the project config for a workspace. Returns null when the
// workspace has no config file, the path is undefined, or the file is invalid.
export async function loadProjectConfig(
  wsPath: string | undefined,
  opts: { force?: boolean } = {},
): Promise<ProjectConfig | null> {
  if (!wsPath) return null
  if (!opts.force && cache.has(wsPath)) return cache.get(wsPath) ?? null

  let result: ProjectConfig | null = null
  try {
    const p = configPath(wsPath)
    if (await exists(p)) {
      const raw = await readTextFile(p)
      const dir = p.slice(0, p.lastIndexOf("/"))
      // Project config is untrusted (ships with the workspace) → restrict
      // {file:}/{env:} substitution to safe workspace-relative file reads.
      const substituted = await substituteText(raw, { missing: "empty", dir, untrusted: true })
      const parsed = parseJsonc(substituted, p)
      result = parseProjectConfig(parsed)
    }
  } catch (e) {
    console.warn("[config] failed to load project config:", e)
    result = null
  }

  cache.set(wsPath, result)
  return result
}

// Synchronous read of the cached config — for hot paths that already ran a
// load(). Returns null if the workspace was never warmed.
export function getCachedProjectConfig(wsPath: string | undefined): ProjectConfig | null {
  if (!wsPath) return null
  return cache.get(wsPath) ?? null
}

// Drop a cached entry (or the whole cache) so the next load() re-reads from disk.
export function invalidateProjectConfig(wsPath?: string): void {
  if (wsPath) cache.delete(wsPath)
  else cache.clear()
}
