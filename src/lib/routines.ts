// Routines — tekrar eden / hızlı erişilen prompt tanımları.
// ~/.codezal/routines/<name>.md (global) ve <ws>/.codezal/routines/<name>.md (proje).
// Frontmatter: name, description, model?, provider?, schedule? (cron, henüz scheduler yok).
// Body: prompt (kullanıcı çalıştırınca yeni session açılır ve bu prompt gönderilir).
import { exists, readDir, readTextFile } from "@tauri-apps/plugin-fs"
import { homeDir } from "@tauri-apps/api/path"
import type { ProviderId } from "./providers"

export type RoutineScope = "project" | "global"

export type Routine = {
  name: string
  description: string
  provider?: ProviderId
  model?: string
  schedule?: string // cron (TODO: scheduler)
  path: string
  scope: RoutineScope
  prompt: string
}

const MAX_BODY = 32_000

export async function readWorkspaceRoutines(workspace: string | undefined): Promise<Routine[]> {
  if (!workspace) return []
  const root = workspace.replace(/[\\/]+$/, "") + "/.codezal/routines"
  return readRoutinesDir(root, "project")
}

export async function readUserRoutines(): Promise<Routine[]> {
  try {
    const home = await homeDir()
    const root = home.replace(/[\\/]+$/, "") + "/.codezal/routines"
    return readRoutinesDir(root, "global")
  } catch {
    return []
  }
}

async function readRoutinesDir(root: string, scope: RoutineScope): Promise<Routine[]> {
  try {
    if (!(await exists(root))) return []
  } catch {
    return []
  }
  let entries
  try {
    entries = await readDir(root)
  } catch {
    return []
  }
  const out: Routine[] = []
  for (const e of entries) {
    if (!e.name.endsWith(".md")) continue
    const path = root + "/" + e.name
    try {
      const raw = await readTextFile(path)
      const parsed = parseRoutineFile(raw, e.name.replace(/\.md$/, ""))
      out.push({ ...parsed, path, scope })
    } catch {
      // sessiz geç
    }
  }
  return out
}

function parseRoutineFile(raw: string, fallbackName: string): Omit<Routine, "path" | "scope"> {
  const m = raw.match(/^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/)
  if (!m) {
    return { name: fallbackName, description: "", prompt: raw.slice(0, MAX_BODY) }
  }
  const fm = m[1]
  const body = m[2].slice(0, MAX_BODY)
  const obj: Record<string, unknown> = {}
  for (const line of fm.split("\n")) {
    const km = line.match(/^([a-zA-Z_-]+)\s*:\s*(.*)$/)
    if (!km) continue
    const key = km[1].trim()
    const val = km[2].trim().replace(/^["']|["']$/g, "")
    obj[key] = val
  }
  return {
    name: String(obj.name ?? fallbackName),
    description: String(obj.description ?? ""),
    provider: obj.provider as ProviderId | undefined,
    model: obj.model as string | undefined,
    schedule: obj.schedule as string | undefined,
    prompt: body,
  }
}
