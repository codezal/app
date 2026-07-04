// User themes from disk: $HOME/.codezal/themes/*.json
// Each file = a single ThemePreset JSON.
import { BaseDirectory, exists, mkdir, readDir, readTextFile, writeTextFile } from "@tauri-apps/plugin-fs"
import { TOKEN_TO_CSS_VAR, type ThemePreset, type ThemeTokens } from "./theme-presets"

const DIR = ".codezal/themes"
const BASE = BaseDirectory.Home

function isStr(v: unknown): v is string {
  return typeof v === "string" && v.length > 0
}

function validatePreset(raw: unknown, fallbackId: string): ThemePreset | null {
  if (!raw || typeof raw !== "object") return null
  const r = raw as Record<string, unknown>
  if (!isStr(r.name)) return null
  if (r.mode !== "light" && r.mode !== "dark") return null
  if (!r.tokens || typeof r.tokens !== "object") return null
  const tokens = r.tokens as Record<string, unknown>
  // every TokenKey must have a non-empty string. We don't enforce HSL format here —
  // applyAppearance is tolerant and will pass invalid values through to CSS, which
  // is acceptable for v1 (browser ignores bad values).
  for (const key of Object.keys(TOKEN_TO_CSS_VAR) as (keyof ThemeTokens)[]) {
    if (!isStr(tokens[key])) return null
  }
  const id = isStr(r.id) ? r.id : fallbackId
  return {
    id,
    name: r.name,
    mode: r.mode,
    tokens: tokens as unknown as ThemeTokens,
    builtin: false,
  }
}

async function ensureDir(): Promise<void> {
  const has = await exists(DIR, { baseDir: BASE })
  if (!has) await mkdir(DIR, { baseDir: BASE, recursive: true })
}

export async function loadUserThemes(): Promise<ThemePreset[]> {
  try {
    await ensureDir()
    const entries = await readDir(DIR, { baseDir: BASE })
    const out: ThemePreset[] = []
    for (const e of entries) {
      if (!e.isFile || !e.name?.endsWith(".json")) continue
      const path = `${DIR}/${e.name}`
      try {
        const raw = await readTextFile(path, { baseDir: BASE })
        const json = JSON.parse(raw) as unknown
        const validated = validatePreset(json, e.name.replace(/\.json$/, ""))
        if (validated) out.push(validated)
        else console.warn(`[theme-loader] skipped invalid preset: ${path}`)
      } catch (err) {
        console.warn(`[theme-loader] failed to read ${path}:`, err)
      }
    }
    return out
  } catch (e) {
    console.warn("[theme-loader] loadUserThemes failed:", e)
    return []
  }
}

export async function saveUserTheme(preset: ThemePreset): Promise<void> {
  await ensureDir()
  const filename = `${preset.id.replace(/[^a-zA-Z0-9_-]/g, "-")}.json`
  const path = `${DIR}/${filename}`
  const body: ThemePreset = { ...preset, builtin: false }
  await writeTextFile(path, JSON.stringify(body, null, 2), { baseDir: BASE })
}

export function presetToJson(preset: ThemePreset): string {
  return JSON.stringify(preset, null, 2)
}

export function jsonToPreset(json: string, fallbackId: string): ThemePreset | null {
  try {
    return validatePreset(JSON.parse(json), fallbackId)
  } catch {
    return null
  }
}
