
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
