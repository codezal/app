import { normalizeNativeFsPath } from "@/lib/fs-path"
import { isWindows } from "@/lib/platform"

export const PWD_SENTINEL = "__CODEZAL_PWD__"

export function extractPwd(
  stdout: string,
  sentinel: string,
): { cleaned: string; cwd: string | null } {
  const idx = stdout.lastIndexOf(sentinel)
  if (idx === -1) return { cleaned: stdout, cwd: null }
  const cwd = stdout.slice(idx + sentinel.length).split("\n")[0].trim()
  let cleaned = stdout.slice(0, idx)
  if (cleaned.endsWith("\n")) cleaned = cleaned.slice(0, -1)
  return { cleaned, cwd: cwd || null }
}

function comparablePath(path: string, windows: boolean): string {
  const normalized = normalizeNativeFsPath(path, windows)
    .replace(/\\/g, "/")
    .replace(/\/+$/, "")
  return windows ? normalized.toLowerCase() : normalized
}

export function isWithinWorkspace(
  workspace: string,
  cwd: string,
  windows = isWindows(),
): boolean {
  const root = comparablePath(workspace, windows)
  const current = comparablePath(cwd, windows)
  return current === root || current.startsWith(root + "/")
}
