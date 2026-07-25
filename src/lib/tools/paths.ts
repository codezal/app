
import { normalizeNativeFsPath } from "@/lib/fs-path"
import { isWindows } from "@/lib/platform"

export class WorkspaceError extends Error {}

export function isAbsolutePath(p: string): boolean {
  return p.startsWith("/") || /^[a-zA-Z]:[\\/]/.test(p) || /^\\\\/.test(p)
}

function normalize(p: string): string {
  const parts = p.replace(/\\/g, "/").split("/")
  const out: string[] = []
  for (const seg of parts) {
    if (seg === "" || seg === ".") continue
    if (seg === "..") {
      if (out.length === 0 || out[out.length - 1] === "..") {
        out.push("..")
      } else {
        out.pop()
      }
      continue
    }
    out.push(seg)
  }
  const lead = p.startsWith("/") ? "/" : ""
  return lead + out.join("/")
}

function comparable(path: string, windows: boolean): string {
  return windows ? path.toLowerCase() : path
}

// Like resolveInWorkspace but WITHOUT the workspace boundary: used by tools that
// present a file to the user (e.g. open_path) where the artifact may legitimately
// live outside the workspace (a build output dir, ~/Downloads, …). Absolute paths
// are normalised as-is; relative paths are joined to the workspace. The actual
// open/reveal is always user-triggered in the UI, so allowing out-of-workspace
// paths here does not let the model launch anything on its own.
export function resolveAny(
  workspace: string,
  p: string,
  windows = isWindows(),
): string {
  if (isAbsolutePath(p)) return normalize(normalizeNativeFsPath(p, windows))
  if (!workspace) throw new WorkspaceError("Çalışma klasörü bağlı değil")
  return normalize(normalizeNativeFsPath(workspace + "/" + p, windows))
}

export function resolveInWorkspace(
  workspace: string,
  rel: string,
  windows = isWindows(),
): string {
  if (!workspace) throw new WorkspaceError("Çalışma klasörü bağlı değil")
  const ws = normalize(normalizeNativeFsPath(workspace, windows))
  const wsComparable = comparable(ws, windows)
  if (isAbsolutePath(rel)) {
    const norm = normalize(normalizeNativeFsPath(rel, windows))
    const normComparable = comparable(norm, windows)
    if (normComparable === wsComparable || normComparable.startsWith(wsComparable + "/")) {
      return norm
    }
    throw new WorkspaceError(`Path workspace dışında: ${rel}`)
  }
  const joined = normalize(ws + "/" + rel)
  const joinedComparable = comparable(joined, windows)
  if (joinedComparable !== wsComparable && !joinedComparable.startsWith(wsComparable + "/")) {
    throw new WorkspaceError(`Path workspace dışına çıkıyor: ${rel}`)
  }
  return joined
}
