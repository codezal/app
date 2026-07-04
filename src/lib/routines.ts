// ~/.codezal/routines/<name>.md (global) ve <ws>/.codezal/routines/<name>.md (proje).
import { exists, readDir, readTextFile, writeTextFile, mkdir, remove } from "@tauri-apps/plugin-fs"
import { homeDir } from "@tauri-apps/api/path"
import type { ProviderId, ReasoningEffort } from "./providers"

export type RoutineScope = "project" | "global"

export type Routine = {
  name: string
  description: string
  provider?: ProviderId
  model?: string
  reasoningEffort?: ReasoningEffort
  schedule?: string // cron
  once?: boolean
  fireAt?: string
  disabled?: boolean
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
      // Intentionally ignored.
    }
  }
  return out
}

export function parseRoutineFile(raw: string, fallbackName: string): Omit<Routine, "path" | "scope"> {
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
    reasoningEffort: obj.reasoningEffort as ReasoningEffort | undefined,
    schedule: obj.schedule as string | undefined,
    once: obj.once === "true" || obj.once === true,
    fireAt: typeof obj.fireAt === "string" && obj.fireAt ? obj.fireAt : undefined,
    disabled: obj.disabled === "true" || obj.disabled === true,
    prompt: body,
  }
}


export type RoutineInput = {
  name: string
  description?: string
  prompt: string
  schedule?: string
  once?: boolean
  fireAt?: string
  disabled?: boolean
  provider?: ProviderId
  model?: string
  reasoningEffort?: ReasoningEffort
}

export function serializeRoutine(r: RoutineInput): string {
  const fm: string[] = ["---", `name: ${r.name}`]
  if (r.description) fm.push(`description: ${r.description}`)
  if (r.provider) fm.push(`provider: ${r.provider}`)
  if (r.model) fm.push(`model: ${r.model}`)
  if (r.reasoningEffort) fm.push(`reasoningEffort: ${r.reasoningEffort}`)
  if (r.schedule) fm.push(`schedule: ${r.schedule}`)
  if (r.once) fm.push(`once: true`)
  if (r.fireAt) fm.push(`fireAt: ${r.fireAt}`)
  if (r.disabled) fm.push(`disabled: true`)
  fm.push("---")
  return fm.join("\n") + "\n" + (r.prompt ?? "")
}

async function routinesRoot(scope: RoutineScope, workspace: string | undefined): Promise<string> {
  if (scope === "project") {
    if (!workspace) throw new Error("Project routine için bağlı bir workspace gerekli")
    return workspace.replace(/[\\/]+$/, "") + "/.codezal/routines"
  }
  const home = await homeDir()
  return home.replace(/[\\/]+$/, "") + "/.codezal/routines"
}

export async function writeRoutine(
  scope: RoutineScope,
  input: RoutineInput,
  workspace: string | undefined,
): Promise<string> {
  const root = await routinesRoot(scope, workspace)
  if (!(await exists(root))) await mkdir(root, { recursive: true })
  const safe = input.name.replace(/[^a-zA-Z0-9._-]/g, "-").replace(/^-+|-+$/g, "") || "routine"
  const path = root + "/" + safe + ".md"
  await writeTextFile(path, serializeRoutine(input))
  return path
}

export async function deleteRoutine(path: string): Promise<void> {
  await remove(path)
}
