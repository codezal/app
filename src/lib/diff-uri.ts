
export type DiffMode = "worktree" | "staged" | "untracked" | "branch" | "commit"

export type DiffRef = {
  mode: DiffMode
  ref: string | null
  path: string
}

const PREFIX = "codezal-diff:"

export function isDiffUri(s: string): boolean {
  return s.startsWith(PREFIX)
}

export function makeDiffUri(d: DiffRef): string {
  return `${PREFIX}${d.mode}:${encodeURIComponent(d.ref ?? "")}:${encodeURIComponent(d.path)}`
}

export function parseDiffUri(uri: string): DiffRef | null {
  if (!isDiffUri(uri)) return null
  const rest = uri.slice(PREFIX.length)
  const i1 = rest.indexOf(":")
  const i2 = rest.indexOf(":", i1 + 1)
  if (i1 < 0 || i2 < 0) return null
  const mode = rest.slice(0, i1) as DiffMode
  const ref = decodeURIComponent(rest.slice(i1 + 1, i2))
  const path = decodeURIComponent(rest.slice(i2 + 1))
  if (!path) return null
  return { mode, ref: ref || null, path }
}
