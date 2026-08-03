import { copyFile, mkdir, readDir, remove, lstat, exists } from "@tauri-apps/plugin-fs"
import { isWindows } from "./platform"

export type ClipMode = "copy" | "cut"

export type FileClipboardEntry = {
  path: string
  name: string
  isDir: boolean
  mode: ClipMode
}

let current: FileClipboardEntry | null = null
const subs = new Set<() => void>()

export function getFileClipboard(): FileClipboardEntry | null {
  return current
}

export function setFileClipboard(e: FileClipboardEntry | null): void {
  current = e
  for (const fn of subs) fn()
}

export function subscribeFileClipboard(cb: () => void): () => void {
  subs.add(cb)
  return () => {
    subs.delete(cb)
  }
}

function joinPosix(dir: string, name: string): string {
  return `${dir.replace(/[/\\]$/, "")}/${name}`
}

async function uniqueName(dir: string, name: string): Promise<string> {
  const dot = name.lastIndexOf(".")
  const hasExt = dot > 0
  const base = hasExt ? name.slice(0, dot) : name
  const ext = hasExt ? name.slice(dot) : ""

  let candidate = name
  for (let i = 1; i < 1000; i++) {
    if (!(await exists(joinPosix(dir, candidate)))) return candidate
    candidate = `${base} (${i})${ext}`
  }
  throw new Error("hedef dizinde çok fazla çakışma — yeniden adlandır")
}

async function copyRecursive(src: string, dst: string): Promise<void> {
  const st = await lstat(src)
  if (st.isSymlink) {
    return
  }
  if (st.isDirectory) {
    await mkdir(dst, { recursive: true })
    const entries = await readDir(src)
    for (const e of entries) {
      await copyRecursive(joinPosix(src, e.name), joinPosix(dst, e.name))
    }
  } else {
    await copyFile(src, dst)
  }
}

async function removeRecursive(p: string): Promise<void> {
  await remove(p, { recursive: true })
}

// Detect whether `dst` is the source itself or nested inside it — pasting a
// folder into its own subtree copies it into itself forever. On Windows the
// FS is case-insensitive, so `C:\Foo` → `c:\foo\sub` is ALSO a self-paste and
// must be compared case-insensitively (M73). Exported for unit testing.
export function isSelfPaste(dst: string, src: string, caseInsensitive = isWindows()): boolean {
  const norm = (p: string) => {
    let s = p.replace(/\\/g, "/").replace(/\/+$/, "")
    if (caseInsensitive) s = s.toLowerCase()
    return s
  }
  const s = norm(src)
  const d = norm(dst)
  if (s === "") return false
  return d === s || d.startsWith(s + "/")
}

export async function applyFileClipboardPaste(targetDir: string): Promise<string> {
  if (!current) throw new Error("pano boş")
  const name = await uniqueName(targetDir, current.name)
  const dst = joinPosix(targetDir, name)

  const src = current.path
  if (isSelfPaste(dst, src)) {
    throw new Error("hedef kaynağın altında — yapıştırılamaz")
  }

  await copyRecursive(src, dst)
  if (current.mode === "cut") {
    try {
      await removeRecursive(src)
    } catch (e) {
      setFileClipboard(null)
      throw e
    }
    setFileClipboard(null)
  }
  return dst
}
