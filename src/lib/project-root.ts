import { exists } from "@tauri-apps/plugin-fs"

const MARKERS = ["tsconfig.json", "jsconfig.json", "package.json", ".git"]

function toPosix(p: string): string {
  return p.replace(/\\/g, "/").replace(/\/+$/, "")
}

function parentDir(p: string): string {
  const i = p.lastIndexOf("/")
  if (i <= 0) return ""
  return p.slice(0, i)
}

export async function findProjectRoot(filePath: string): Promise<string | null> {
  let dir = parentDir(toPosix(filePath))
  for (let depth = 0; depth < 40 && dir; depth++) {
    for (const marker of MARKERS) {
      try {
        if (await exists(`${dir}/${marker}`)) return dir
      } catch {
        // Intentionally ignored.
      }
    }
    const parent = parentDir(dir)
    if (parent === dir || parent === "") break
    dir = parent
  }
  return null
}
