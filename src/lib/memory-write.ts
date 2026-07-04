// Learned-memory write helper.
//
// User-authored rule files stay as markdown sources. Learned facts from
// `remember`, Composer #-capture, and auto-learn go to SQLite so recall,
// consolidation, and undo share one source of truth.
import { exists, readTextFile, writeTextFile } from "@tauri-apps/plugin-fs"
import { homeDir } from "@tauri-apps/api/path"
import { invalidateMemoryCache } from "./memory"
import { captureMemory, forgetMemory } from "@/lib/memory-store"
import type { MemoryEntrySource } from "@/lib/db/memory-db"

export type MemoryScope = "project" | "global"

let writeQueue: Promise<unknown> = Promise.resolve()
function enqueueWrite<T>(task: () => Promise<T>): Promise<T> {
  const run = writeQueue.then(task, task)
  writeQueue = run.then(
    () => undefined,
    () => undefined,
  )
  return run
}

function sanitizeNote(text: string): string {
  return text.trim().replace(/\s*[\r\n]+\s*/g, " ")
}

function joinPath(...parts: string[]): string {
  return parts
    .map((p, i) => (i === 0 ? p.replace(/[\\/]+$/, "") : p.replace(/^[\\/]+|[\\/]+$/g, "")))
    .filter(Boolean)
    .join("/")
}

export async function memoryTargetPath(
  scope: MemoryScope,
  workspace?: string,
): Promise<string | null> {
  if (scope === "project") {
    if (!workspace) return null
    return joinPath(workspace, ".codezal/memory.md")
  }
  let home: string
  try {
    home = await homeDir()
  } catch {
    return null
  }
  return joinPath(home, ".codezal/MEMORY.md")
}

export function appendMemory(
  scope: MemoryScope,
  text: string,
  workspace?: string,
  category?: string,
  source: MemoryEntrySource = "manual",
): Promise<string> {
  const body = sanitizeNote(text)
  if (!body) return Promise.reject(new Error("Boş bellek notu yazılamaz"))
  return enqueueWrite(() => appendMemoryInner(scope, body, workspace, category, source))
}

async function appendMemoryInner(
  scope: MemoryScope,
  body: string,
  workspace: string | undefined,
  category: string | undefined,
  source: MemoryEntrySource,
): Promise<string> {
  if (scope === "project" && !workspace) {
    throw new Error(
      "Proje belleği için açık bir workspace gerekli",
    )
  }

  const cleanCategory = category?.trim().replace(/[\r\n]+/g, " ").replace(/^#+\s*/, "").trim()
  await captureMemory({ scope, text: body, workspace, category: cleanCategory, source })
  return scope === "project" ? "project memory database" : "global memory database"
}

export function removeMemoryNote(
  scope: MemoryScope,
  text: string,
  workspace?: string,
): Promise<void> {
  const body = sanitizeNote(text)
  if (!body) return Promise.resolve()
  return enqueueWrite(() => removeMemoryNoteInner(scope, body, workspace))
}

async function removeMemoryNoteInner(
  scope: MemoryScope,
  body: string,
  workspace: string | undefined,
): Promise<void> {
  await forgetMemory({ scope, text: body, workspace })

  // Legacy cleanup: older versions wrote learned notes to memory.md. Remove a
  // matching markdown bullet as best-effort so undo also cleans pre-DB notes.
  const target = await memoryTargetPath(scope, workspace)
  if (!target) return

  let existing: string
  try {
    if (!(await exists(target))) return
    existing = (await readTextFile(target)).replace(/\r\n/g, "\n")
  } catch {
    return
  }

  const lines = existing.split("\n")
  const idx = lines.findIndex((l) => /^\s*-\s/.test(l) && l.includes(body))
  if (idx === -1) return
  lines.splice(idx, 1)
  const cleaned = lines.join("\n").replace(/\n{3,}/g, "\n\n")
  await writeTextFile(target, cleaned)
  invalidateMemoryCache(target)
}
