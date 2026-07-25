// Thin wrapper around the Tauri opener plugin so the rest of the app never
// imports `@tauri-apps/plugin-opener` directly. Used by the `open_path` tool
// card (Open / Reveal buttons) and by Markdown `file:` links that point at a
// binary or out-of-workspace path the editor can't open.
//
// These functions never run on their own as a side effect of a tool call — the
// tool only returns metadata and renders a card; the actual open/reveal is
// always triggered by the user clicking a button, so arbitrary paths can't be
// launched without the user seeing the path first.
import { openPath, revealItemInDir } from "@tauri-apps/plugin-opener"
import { captureError } from "@/lib/report"

/** Open `absPath` with the OS default application for its type. */
export async function openWithDefault(absPath: string): Promise<void> {
  try {
    await openPath(absPath)
  } catch (e) {
    captureError(e, "open-path:open")
    throw e
  }
}

/** Reveal `absPath` in the system file manager (Finder / Explorer), selected. */
export async function revealInFinder(absPath: string): Promise<void> {
  try {
    await revealItemInDir(absPath)
  } catch (e) {
    captureError(e, "open-path:reveal")
    throw e
  }
}

// Extensions the in-app editor can't meaningfully open — these should be handed
// to the OS instead. Kept here (not in the UI) so Markdown links and the tool
// card share one definition.
const BINARY_EXTS = new Set([
  "dmg",
  "app",
  "pkg",
  "zip",
  "tar",
  "gz",
  "tgz",
  "rar",
  "7z",
  "exe",
  "msi",
  "pdf",
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "bmp",
  "ico",
  "tif",
  "tiff",
  "svg",
  "mp4",
  "mov",
  "mkv",
  "webm",
  "avi",
  "mp3",
  "wav",
  "flac",
  "aac",
  "ogg",
])

/** Human-readable byte size, e.g. 1536 -> "1.5 KB". */
export function humanSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return ""
  const units = ["B", "KB", "MB", "GB", "TB"]
  let i = 0
  let n = bytes
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024
    i++
  }
  return i === 0
    ? `${n} ${units[i]}`
    : `${n.toFixed(n >= 10 ? 0 : 1).replace(/\.0$/, "")} ${units[i]}`
}

/** True when a path's extension is a binary/preview type the editor can't open. */
export function isBinaryPath(path: string): boolean {
  const dot = path.lastIndexOf(".")
  const slash = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"))
  if (dot === -1 || dot < slash) return false
  return BINARY_EXTS.has(path.slice(dot + 1).toLowerCase())
}
