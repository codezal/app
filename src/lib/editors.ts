// External editor integration. Detection + open run in Rust (cross-platform,
// PATH + well-known install locations); this module is the typed frontend
// bridge. Editor ids match the Rust `EDITORS` table.
import { invoke } from "@tauri-apps/api/core"

export type EditorId = "vscode" | "vscode-insiders" | "cursor" | "windsurf" | "vscodium"

// Human-readable names for the open-with menu.
export const EDITOR_LABELS: Record<EditorId, string> = {
  vscode: "VS Code",
  "vscode-insiders": "VS Code Insiders",
  cursor: "Cursor",
  windsurf: "Windsurf",
  vscodium: "VSCodium",
}

// Detection is process-wide stable, so memoize the first probe for the app's
// lifetime instead of hitting the filesystem on every file open.
let cache: Promise<EditorId[]> | null = null

// Editors found installed on this machine.
export function detectEditors(): Promise<EditorId[]> {
  if (!cache) {
    cache = invoke<string[]>("detect_editors")
      .then((ids) => ids as EditorId[])
      .catch(() => [])
  }
  return cache
}

// Open a file in the given editor, jumping to `line` (1-based) when provided.
export function openInEditor(cmd: EditorId, path: string, line?: number): Promise<void> {
  return invoke("open_in_editor", { cmd, path, line: line ?? null })
}
