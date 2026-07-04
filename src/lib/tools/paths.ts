
export class WorkspaceError extends Error {}

function isAbsolutePath(p: string): boolean {
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

export function resolveInWorkspace(workspace: string, rel: string): string {
  if (!workspace) throw new WorkspaceError("Çalışma klasörü bağlı değil")
  const ws = normalize(workspace)
  if (isAbsolutePath(rel)) {
    const norm = normalize(rel)
    if (norm === ws || norm.startsWith(ws + "/")) return norm
    throw new WorkspaceError(`Path workspace dışında: ${rel}`)
  }
  const joined = normalize(ws + "/" + rel)
  if (joined !== ws && !joined.startsWith(ws + "/")) {
    throw new WorkspaceError(`Path workspace dışına çıkıyor: ${rel}`)
  }
  return joined
}
