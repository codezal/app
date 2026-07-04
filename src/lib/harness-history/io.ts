import { exists, readDir, readTextFile, stat } from "@tauri-apps/plugin-fs"
import type { HarnessThread, SessionSource } from "./types"
import { baseName, stripExt } from "./normalize"

export function childPath(parent: string, name: string): string {
  const sep = parent.includes("\\") && !parent.includes("/") ? "\\" : "/"
  return parent.replace(/[\\/]+$/, "") + sep + name
}

export async function dirExists(path: string): Promise<boolean> {
  try {
    return await exists(path)
  } catch {
    return false
  }
}

export async function fileMtime(path: string): Promise<number> {
  try {
    const s = await stat(path)
    return s.mtime ? s.mtime.getTime() : 0
  } catch {
    return 0
  }
}

export async function readTextSafe(path: string): Promise<string | null> {
  try {
    return await readTextFile(path)
  } catch {
    return null
  }
}

export async function walkFiles(dir: string, ext: string, maxDepth = 6): Promise<string[]> {
  const out: string[] = []
  async function recur(d: string, depth: number): Promise<void> {
    if (depth > maxDepth) return
    let entries
    try {
      entries = await readDir(d)
    } catch {
      return
    }
    for (const e of entries) {
      if (e.isSymlink) continue
      if (e.isDirectory) {
        await recur(childPath(d, e.name), depth + 1)
      } else if (e.isFile && e.name.endsWith(ext)) {
        out.push(childPath(d, e.name))
      }
    }
  }
  await recur(dir, 0)
  return out
}

export async function listSubdirs(dir: string): Promise<string[]> {
  try {
    const entries = await readDir(dir)
    return entries.filter((e) => e.isDirectory).map((e) => e.name)
  } catch {
    return []
  }
}

export async function makeFileSource(
  file: string,
  parse: (text: string, file: string) => HarnessThread | null,
): Promise<SessionSource> {
  return {
    nativeId: stripExt(baseName(file)),
    sourceRef: file,
    mtime: await fileMtime(file),
    load: async () => {
      const text = await readTextSafe(file)
      return text ? parse(text, file) : null
    },
  }
}
