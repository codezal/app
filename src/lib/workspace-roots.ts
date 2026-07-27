//
// Register user-approved workspace roots with the Rust shell so file access is
// allowed OUTSIDE the home directory too. On Windows projects commonly live on
// other drives (D:\, E:\, network shares); without registration both the
// tauri-plugin-fs scope and the Rust `fs_*` fallback reject those paths with
// "forbidden path". Registration is idempotent and a no-op outside Tauri (tests).
//
import { invoke } from "@tauri-apps/api/core"
import { normalizeNativeFsPath } from "./fs-path"

function isTauri(): boolean {
  if (typeof window === "undefined") return false
  return Boolean((window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__)
}

// Case-insensitive: Windows filesystems are case-insensitive, so the same root
// arriving as "D:\Proj" and "d:\proj" must dedupe to one entry.
const registered = new Set<string>()

export async function registerWorkspaceRoot(path?: string | null): Promise<void> {
  if (!path || !isTauri()) return
  const normalized = normalizeNativeFsPath(path).replace(/[\\/]+$/, "")
  if (!normalized) return
  const key = normalized.toLowerCase()
  if (registered.has(key)) return
  registered.add(key)
  try {
    await invoke("register_workspace_root", { path: normalized })
  } catch (e) {
    // Don't poison the cache on failure so a later call can retry.
    registered.delete(key)
    console.warn("[workspace-roots] register failed:", e)
  }
}

export function registerWorkspaceRoots(paths: Array<string | undefined | null>): void {
  for (const p of paths) void registerWorkspaceRoot(p)
}
