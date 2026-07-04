//
import { BaseDirectory, exists, mkdir, readDir, readFile, remove, writeFile } from "@tauri-apps/plugin-fs"
import { createId } from "@/lib/id"

const DIR = "images"
const BASE = BaseDirectory.AppData

async function ensureDir(): Promise<void> {
  if (!(await exists(DIR, { baseDir: BASE }))) {
    await mkdir(DIR, { baseDir: BASE, recursive: true })
  }
}

export async function saveImage(dataUrl: string): Promise<string> {
  await ensureDir()
  const { bytes, mime } = dataUrlToBytes(dataUrl)
  const ext = (mime.split("/")[1] || "bin").split(";")[0] || "bin"
  const ref = `${createId("image")}.${ext}`
  await writeFile(`${DIR}/${ref}`, bytes, { baseDir: BASE })
  return ref
}

// data: URL → ham bytes + mime. fetch() KULLANMA: CSP `connect-src` `data:`
function dataUrlToBytes(dataUrl: string): { bytes: Uint8Array; mime: string } {
  const comma = dataUrl.indexOf(",")
  const meta = comma >= 0 ? dataUrl.slice(5, comma) : "" // "data:" prefix'ini at
  const mime = meta.split(";")[0] || "application/octet-stream"
  const data = comma >= 0 ? dataUrl.slice(comma + 1) : ""
  const binary = meta.includes("base64") ? atob(data) : decodeURIComponent(data)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return { bytes, mime }
}

export async function loadImageObjectUrl(ref: string, mime: string): Promise<string> {
  const bytes = await readFile(`${DIR}/${ref}`, { baseDir: BASE })
  return URL.createObjectURL(new Blob([bytes], { type: mime }))
}

export async function loadImageDataUrl(ref: string, mime: string): Promise<string> {
  const bytes = await readFile(`${DIR}/${ref}`, { baseDir: BASE })
  const blob = new Blob([bytes], { type: mime })
  return await new Promise<string>((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(r.result as string)
    r.onerror = () => reject(r.error ?? new Error("FileReader error"))
    r.readAsDataURL(blob)
  })
}

export async function deleteImage(ref: string): Promise<void> {
  try {
    await remove(`${DIR}/${ref}`, { baseDir: BASE })
  } catch {
    // Intentionally ignored.
  }
}

export async function gcOrphanImages(referenced: Set<string>): Promise<number> {
  if (!(await exists(DIR, { baseDir: BASE }))) return 0
  const entries = await readDir(DIR, { baseDir: BASE })
  let deleted = 0
  for (const e of entries) {
    if (e.isFile && !referenced.has(e.name)) {
      await deleteImage(e.name)
      deleted++
    }
  }
  return deleted
}
