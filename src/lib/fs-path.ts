export function joinFsPath(dir: string, name: string): string {
  const base = dir.replace(/[\\/]+$/, "")
  if (!base) return name
  const sep = prefersBackslash(base) ? "\\" : "/"
  return `${base}${sep}${name}`
}

function prefersBackslash(path: string): boolean {
  return /^[a-zA-Z]:\\/.test(path) || path.startsWith("\\\\")
}
