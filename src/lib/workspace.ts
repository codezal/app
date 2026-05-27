// Workspace helper — Tauri dialog ile klasör seç, path basename çıkar.
import { open as openDialog } from "@tauri-apps/plugin-dialog"

// Tauri picker aç, kullanıcı klasör seçerse absolute path döner, iptal ederse null
export async function pickWorkspaceFolder(): Promise<string | null> {
  const result = await openDialog({
    directory: true,
    multiple: false,
    title: "Çalışma klasörü seç",
  })
  if (!result || Array.isArray(result)) return null
  return result
}

// Path'ten son segment (klasör adı) — UI'da gösterim için
export function basename(path: string | undefined): string {
  if (!path) return ""
  const trimmed = path.replace(/[\\/]+$/, "")
  const idx = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"))
  return idx >= 0 ? trimmed.slice(idx + 1) : trimmed
}
