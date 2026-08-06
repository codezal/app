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

function shouldIgnore(path: string): boolean {
  const parts = path.replace(/\\/g, "/").split("/")
  // Only DIRECTORY segments: the last segment is the entry the event is about,
  // and a FILE merely named "dist"/"build"/"target"/"out" must not be dropped
  // (LOW file-watcher.ts:36). Events about the ignored dirs themselves (e.g.
  // "dist created") pass through — harmless noise vs. losing real files.
  return parts.slice(0, -1).some((p) => IGNORE_DIRS.has(p))
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
  // Per-watcher debounce timer: cleared when THIS watcher is torn down, so an
  // unwatched workspace cannot fire a late emitGitChanged (LOW file-watcher.ts:30).
  let gitMetaTimer: ReturnType<typeof setTimeout> | undefined
  const signalGitChange = (): void => {
    if (gitMetaTimer) clearTimeout(gitMetaTimer)
    gitMetaTimer = setTimeout(() => emitGitChanged(), 150)
  }
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
  return () => {
    if (gitMetaTimer) clearTimeout(gitMetaTimer)
    gitMetaTimer = undefined
    unwatch()
  }
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
