//
import type { FileEvent } from "./file-watcher"

export type InvalidateOps = {
  normalize: (path: string) => string
  invalidate: (path: string) => void
  isOpen: (path: string) => boolean
  reload: (path: string) => void
  isDirLoaded?: (path: string) => boolean
  refreshDir?: (path: string) => void
}

function parentDir(path: string): string {
  const i = path.lastIndexOf("/")
  return i > 0 ? path.slice(0, i) : ""
}

export function invalidateFromFileEvent(event: FileEvent, ops: InvalidateOps): void {
  const path = ops.normalize(event.path)
  if (!path) return
  if (path.split("/").some((seg) => seg === ".git")) return

  if (event.kind === "modify" || event.kind === "remove") {
    ops.invalidate(path)
    if (ops.isOpen(path)) ops.reload(path)
  }

  if (event.kind === "create" || event.kind === "remove") {
    const parent = parentDir(path)
    if (ops.isDirLoaded?.(parent)) ops.refreshDir?.(parent)
  }
}
