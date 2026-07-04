import { watch, watchImmediate, type UnwatchFn } from "@tauri-apps/plugin-fs"
import { IGNORE_DIRS } from "./ignore"
import { emitGitChanged } from "./git-events"

export type FileEventKind = "create" | "modify" | "remove"

export type FileEvent = {
  kind: FileEventKind
  path: string
}

export type FileWatchCallback = (event: FileEvent) => void

function isGitMetaPath(path: string): boolean {
  const p = path.replace(/\\/g, "/")
  const i = p.indexOf("/.git/")
  if (i < 0) return false
  const rest = p.slice(i + "/.git/".length)
  if (rest.startsWith("objects/")) return false
  return (
    rest === "index" ||
    rest === "HEAD" ||
    rest === "ORIG_HEAD" ||
    rest === "MERGE_HEAD" ||
    rest.startsWith("refs/") ||
    rest.startsWith("logs/")
  )
}

let gitMetaTimer: ReturnType<typeof setTimeout> | undefined
function signalGitChange(): void {
  if (gitMetaTimer) clearTimeout(gitMetaTimer)
  gitMetaTimer = setTimeout(() => emitGitChanged(), 150)
}

function shouldIgnore(path: string): boolean {
  const parts = path.replace(/\\/g, "/").split("/")
  return parts.some((p) => IGNORE_DIRS.has(p))
}

// Tauri WatchEventKind (discriminated union) → basit kind.
function resolveKind(type: unknown): FileEventKind | null {
  if (typeof type === "string") return "modify"
  if (type === null || typeof type !== "object") return null
  if ("create" in type) return "create"
  if ("modify" in type) return "modify"
  if ("remove" in type) return "remove"
  return null
}

export async function watchWorkspace(
  workspace: string,
  cb: FileWatchCallback,
): Promise<UnwatchFn> {
  const unwatch = await watchImmediate(
    workspace,
    (event) => {
      const kind = resolveKind(event.type)
      if (!kind) return
      for (const path of event.paths) {
        if (isGitMetaPath(path)) {
          signalGitChange()
          continue
        }
        if (shouldIgnore(path)) continue
        cb({ kind, path })
      }
    },
    { recursive: true },
  )
  return unwatch
}

function parentOf(filePath: string): string {
  const i = Math.max(filePath.lastIndexOf("/"), filePath.lastIndexOf("\\"))
  return i >= 0 ? filePath.slice(0, i) : filePath
}

export async function watchFile(
  filePath: string,
  cb: FileWatchCallback,
): Promise<UnwatchFn> {
  const unwatch = await watch(
    parentOf(filePath),
    (event) => {
      const kind = resolveKind(event.type)
      if (!kind) return
      for (const path of event.paths) {
        if (shouldIgnore(path)) continue
        cb({ kind, path })
      }
    },
    { delayMs: 150, recursive: false },
  )
  return unwatch
}
