// Persisted per-routine last-fire timestamps (epoch ms), keyed by routine path.
// Lets the scheduler detect recurring fires missed while the app was closed and
// run a single catch-up on next launch. File: ~/.codezal/.autopilot-fired.json.
// Best-effort — any failure degrades to in-memory only (no catch-up), never
// throws to the caller (mirrors routines.ts resilience).
import { exists, readTextFile, writeTextFile, mkdir } from "@tauri-apps/plugin-fs"
import { homeDir } from "@tauri-apps/api/path"

export type FiredMap = Record<string, number>

async function stateDir(): Promise<string> {
  const h = await homeDir()
  return h.replace(/[\\/]+$/, "") + "/.codezal"
}

async function stateFile(): Promise<string> {
  return (await stateDir()) + "/.autopilot-fired.json"
}

export async function loadFired(): Promise<FiredMap> {
  try {
    const p = await stateFile()
    if (!(await exists(p))) return {}
    const obj = JSON.parse(await readTextFile(p))
    return obj && typeof obj === "object" ? (obj as FiredMap) : {}
  } catch {
    return {}
  }
}

export async function saveFired(map: FiredMap): Promise<void> {
  try {
    const dir = await stateDir()
    if (!(await exists(dir))) await mkdir(dir, { recursive: true })
    await writeTextFile(await stateFile(), JSON.stringify(map))
  } catch (e) {
    console.warn("[autopilot] fired-state yazılamadı:", e)
  }
}
