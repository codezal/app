import { BaseDirectory, exists, readTextFile, rename, writeTextFile } from "@tauri-apps/plugin-fs"
import settingsSchema from "./config/settings.schema.json"

const SESSIONS_DIR = "sessions"
const SETTINGS_FILE = "settings.json"
const SETTINGS_SCHEMA_FILE = "settings.schema.json"
const BASE = BaseDirectory.AppData

export async function readJson<T>(path: string, fallback: T): Promise<T> {
  try {
    const has = await exists(path, { baseDir: BASE })
    if (!has) return fallback
    const raw = await readTextFile(path, { baseDir: BASE })
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

let tmpCounter = 0
function tmpName(path: string): string {
  const uid =
    globalThis.crypto?.randomUUID?.() ??
    `${Date.now()}-${Math.random().toString(36).slice(2)}-${tmpCounter++}`
  return `${path}.${uid}.tmp`
}
export async function writeJson(path: string, data: unknown): Promise<void> {
  const tmp = tmpName(path)
  await writeTextFile(tmp, JSON.stringify(data, null, 2), { baseDir: BASE })
  await rename(tmp, path, { oldPathBaseDir: BASE, newPathBaseDir: BASE })
}

export async function loadSettingsFile<T>(fallback: T): Promise<T> {
  return readJson(SETTINGS_FILE, fallback)
}

export async function saveSettingsFile(data: unknown): Promise<void> {
  await writeJson(SETTINGS_FILE, data)
}

// Mirror the bundled settings JSON Schema into AppData next to settings.json so
// an editor opening the user's settings.json resolves its
// `"$schema": "./settings.schema.json"` reference and offers autocomplete +
// validation. Idempotent (rewrites only when the bundled schema changed, e.g.
// after an app update) and best-effort: the sidecar is a convenience, so fs
// errors are swallowed rather than allowed to break startup.
export async function ensureSettingsSchemaSidecar(): Promise<void> {
  const want = JSON.stringify(settingsSchema, null, 2)
  try {
    if (await exists(SETTINGS_SCHEMA_FILE, { baseDir: BASE })) {
      const cur = await readTextFile(SETTINGS_SCHEMA_FILE, { baseDir: BASE })
      if (cur === want) return
    }
    await writeJson(SETTINGS_SCHEMA_FILE, settingsSchema)
  } catch {
    // best-effort — autocomplete is non-critical
  }
}

export async function loadSession<T>(id: string, fallback: T): Promise<T> {
  return readJson(`${SESSIONS_DIR}/${id}.json`, fallback)
}
