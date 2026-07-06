import { IGNORE_DIRS } from "./ignore"
import { readDirSafe } from "./fs-safe"
import { joinFsPath } from "./fs-path"

export type FsEntry = {
  name: string
  path: string // absolute
  isDir: boolean
}


export async function readWorkspaceDir(absPath: string): Promise<FsEntry[]> {
  const entries = await readDirSafe(absPath)
  const out: FsEntry[] = []
  for (const e of entries) {
    if (IGNORE_DIRS.has(e.name)) continue
    out.push({
      name: e.name,
      path: joinFsPath(absPath, e.name),
      isDir: !!e.isDirectory,
    })
  }
  out.sort((a, b) => {
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1
    return a.name.localeCompare(b.name)
  })
  return out
}
