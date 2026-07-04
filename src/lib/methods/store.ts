// Methods I/O — persistence (project + global JSON), capture (save_method tool),
import { exists, readTextFile, writeTextFile, mkdir } from "@tauri-apps/plugin-fs"
import { homeDir } from "@tauri-apps/api/path"
import { createId } from "@/lib/id"
import {
  type Method,
  type MethodScope,
  type MethodStoreFile,
  METHODS_VERSION,
  DEFAULT_METHODS_CONFIG,
} from "./types"
import { selectMethods, renderMethodsCatalog, upsertMethod } from "./core"

function joinPath(...parts: string[]): string {
  return parts
    .map((p, i) => (i === 0 ? p.replace(/[\\/]+$/, "") : p.replace(/^[\\/]+|[\\/]+$/g, "")))
    .filter(Boolean)
    .join("/")
}
function dirOf(p: string): string {
  const s = p.replace(/\\/g, "/").replace(/\/+$/, "")
  const i = s.lastIndexOf("/")
  return i <= 0 ? s : s.slice(0, i)
}

async function methodsPath(scope: MethodScope, workspace?: string): Promise<string | null> {
  if (scope === "project") {
    if (!workspace) return null
    return joinPath(workspace, ".codezal", "methods.json")
  }
  try {
    return joinPath(await homeDir(), ".codezal", "methods.json")
  } catch {
    return null
  }
}

async function loadFile(path: string): Promise<Method[]> {
  try {
    if (!(await exists(path))) return []
    const parsed = JSON.parse(await readTextFile(path)) as MethodStoreFile
    if (!parsed || !Array.isArray(parsed.methods)) return []
    return parsed.methods.filter(isValid)
  } catch {
    return []
  }
}

async function saveFile(path: string, methods: Method[]): Promise<void> {
  try {
    await mkdir(dirOf(path), { recursive: true })
  } catch {
    // Intentionally ignored.
  }
  const body: MethodStoreFile = { version: METHODS_VERSION, methods }
  await writeTextFile(path, JSON.stringify(body, null, 2))
}

function isValid(m: unknown): m is Method {
  const o = m as Method
  return !!o && typeof o.name === "string" && typeof o.description === "string" && Array.isArray(o.steps)
}

const queues = new Map<string, Promise<unknown>>()
function enqueue<T>(key: string, task: () => Promise<T>): Promise<T> {
  const prev = queues.get(key) ?? Promise.resolve()
  const run = prev.then(task, task)
  queues.set(key, run.then(() => undefined, () => undefined))
  return run
}

// ---- capture (save_method tool) -------------------------------------------

export interface SaveMethodInput {
  scope: MethodScope
  name: string
  description: string
  steps: string[]
  triggers?: string[]
  workspace?: string
}

export async function saveMethod(input: SaveMethodInput): Promise<string> {
  const name = input.name.trim()
  if (!name) throw new Error("Method adı boş olamaz")
  const path = await methodsPath(input.scope, input.workspace)
  if (!path) {
    throw new Error(
      input.scope === "project" ? "Proje method'u için workspace gerekli" : "Global method yolu (~/.codezal) çözülemedi",
    )
  }
  return enqueue(path, async () => {
    const methods = await loadFile(path)
    const now = Date.now()
    const next: Method = {
      id: createId("memory"),
      name,
      description: input.description.trim(),
      steps: input.steps.map((s) => s.trim()).filter(Boolean),
      triggers: input.triggers?.map((t) => t.trim()).filter(Boolean),
      scope: input.scope,
      createdAt: now,
      lastUsedAt: now,
      useCount: 0,
    }
    await saveFile(path, upsertMethod(methods, next))
    return path
  })
}

// ---- per-request RAG -------------------------------------------------------

export async function loadMethodsCatalog(opts: {
  workspace?: string
  query?: string
  now?: number
  topK?: number
}): Promise<string> {
  const now = opts.now ?? Date.now()
  const [projPath, globPath] = await Promise.all([methodsPath("project", opts.workspace), methodsPath("global")])
  const [proj, glob] = await Promise.all([
    projPath ? loadFile(projPath) : Promise.resolve([]),
    globPath ? loadFile(globPath) : Promise.resolve([]),
  ])
  const all = [...proj, ...glob]
  if (all.length === 0) return ""

  const selected = selectMethods(all, { query: opts.query, now, topK: opts.topK ?? DEFAULT_METHODS_CONFIG.topK })
  if (selected.length === 0) return ""

  const ids = new Set(selected.map((m) => m.id))
  void refreshUsage(projPath, ids, now)
  void refreshUsage(globPath, ids, now)
  return renderMethodsCatalog(selected)
}

async function refreshUsage(path: string | null, ids: Set<string>, now: number): Promise<void> {
  if (!path) return
  await enqueue(path, async () => {
    const methods = await loadFile(path)
    let changed = false
    for (const m of methods) {
      if (ids.has(m.id)) {
        m.useCount += 1
        m.lastUsedAt = now
        changed = true
      }
    }
    if (changed) await saveFile(path, methods).catch(() => undefined)
  })
}
