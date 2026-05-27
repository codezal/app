// Path güvenliği — tüm tool path'leri workspace kökü altında zorla.
// Symlink/escape saldırılarına karşı normalize edip prefix kontrolü yap.

export class WorkspaceError extends Error {}

// Path normalize: ./, ../, çift slash sadeleştir. Cross-platform basit.
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

// Workspace kökü altında bir absolute path döner. Dışına çıkış denemesinde fırlatır.
export function resolveInWorkspace(workspace: string, rel: string): string {
  if (!workspace) throw new WorkspaceError("Çalışma klasörü bağlı değil")
  const ws = normalize(workspace)
  // Eğer kullanıcı absolute verdiyse + ws içindeyse kabul; değilse reddet
  if (rel.startsWith("/")) {
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
