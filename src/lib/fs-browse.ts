import { readDir } from "@tauri-apps/plugin-fs"
import { IGNORE_DIRS } from "./ignore"
import { protectedNames } from "./protected"

export type DirEntry = {
  name: string
  path: string // absolute
  rel: string
  isDir: boolean
}


const MAX_DEPTH = 6
const DEFAULT_MAX = 1000

export async function listDirShallow(
  root: string,
  max: number = DEFAULT_MAX,
): Promise<DirEntry[]> {
  const blocked = protectedNames()
  const out: DirEntry[] = []
  await walk(root, root, 0, out, max, blocked)
  out.sort((a, b) => a.rel.localeCompare(b.rel))
  return out
}

async function walk(
  root: string,
  cur: string,
  depth: number,
  out: DirEntry[],
  max: number,
  blocked: Set<string>,
): Promise<void> {
  if (depth > MAX_DEPTH) return
  if (out.length >= max) return
  let entries
  try {
    entries = await readDir(cur)
  } catch {
    return
  }
  for (const e of entries) {
    if (out.length >= max) return
    if (IGNORE_DIRS.has(e.name)) continue
    if (depth === 0 && blocked.has(e.name)) continue
    if (e.name.startsWith(".") && e.name !== ".env.example") continue
    const abs = cur.replace(/[\\/]+$/, "") + "/" + e.name
    const rel = abs.startsWith(root)
      ? abs.slice(root.length).replace(/^[\\/]+/, "")
      : abs
    out.push({ name: e.name, path: abs, rel, isDir: !!e.isDirectory })
    if (e.isDirectory) {
      await walk(root, abs, depth + 1, out, max, blocked)
    }
  }
}
