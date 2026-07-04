import { BaseDirectory, exists, mkdir, readFile, remove, writeFile } from "@tauri-apps/plugin-fs"
import { createId } from "@/lib/id"

const DIR = "pdfs"
const BASE = BaseDirectory.AppData

async function ensureDir(): Promise<void> {
  if (!(await exists(DIR, { baseDir: BASE }))) {
    await mkdir(DIR, { baseDir: BASE, recursive: true })
  }
}

export async function savePdf(bytes: Uint8Array): Promise<string> {
  await ensureDir()
  const ref = `${createId("pdf")}.pdf`
  await writeFile(`${DIR}/${ref}`, bytes, { baseDir: BASE })
  return ref
}

export async function loadPdfBytes(ref: string): Promise<Uint8Array> {
  return await readFile(`${DIR}/${ref}`, { baseDir: BASE })
}

export async function loadPdfDataUrl(ref: string): Promise<string> {
  const bytes = await readFile(`${DIR}/${ref}`, { baseDir: BASE })
  const blob = new Blob([bytes], { type: "application/pdf" })
  return await new Promise<string>((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(r.result as string)
    r.onerror = () => reject(r.error ?? new Error("FileReader error"))
    r.readAsDataURL(blob)
  })
}

export async function deletePdf(ref: string): Promise<void> {
  try {
    await remove(`${DIR}/${ref}`, { baseDir: BASE })
  } catch {
    // Intentionally ignored.
  }
}
