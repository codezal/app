import { isWindows } from "./platform"

export function normalizeNativeFsPath(path: string, windows = isWindows()): string {
  if (!windows) return path
  const msysDrive = /^\/([a-zA-Z])(?:\/(.*))?$/.exec(path)
  if (!msysDrive) return path
  return `${msysDrive[1].toUpperCase()}:/${msysDrive[2] ?? ""}`
}

export function joinFsPath(dir: string, name: string): string {
  const base = dir.replace(/[\\/]+$/, "")
  if (!base) return name
  const sep = prefersBackslash(base) ? "\\" : "/"
  return `${base}${sep}${name}`
}

function prefersBackslash(path: string): boolean {
  return /^[a-zA-Z]:\\/.test(path) || path.startsWith("\\\\")
}
