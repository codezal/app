// Plugin install dizini integrity fingerprint'i.
//
//
//
// --------------------
import { readDir, readFile, exists } from "@tauri-apps/plugin-fs"

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", bytes as unknown as BufferSource)
  const arr = new Uint8Array(buf)
  let out = ""
  for (let i = 0; i < arr.length; i++) out += arr[i].toString(16).padStart(2, "0")
  return out
}

async function collectEntries(root: string, rel: string, acc: string[]): Promise<void> {
  const dir = rel ? `${root}/${rel}` : root
  const entries = await readDir(dir)
  for (const e of entries) {
    const childRel = rel ? `${rel}/${e.name}` : e.name
    if (e.isSymlink) {
      acc.push(`${childRel}\0@symlink`)
      continue
    }
    if (e.isDirectory) {
      await collectEntries(root, childRel, acc)
      continue
    }
    const bytes = await readFile(`${root}/${childRel}`)
    acc.push(`${childRel}\0${await sha256Hex(bytes)}`)
  }
}

export async function computeDirFingerprint(installPath: string): Promise<string> {
  const root = installPath.replace(/[\\/]+$/, "")
  if (!(await exists(root))) return ""
  const acc: string[] = []
  await collectEntries(root, "", acc)
  acc.sort()
  return sha256Hex(new TextEncoder().encode(acc.join("\n")))
}
