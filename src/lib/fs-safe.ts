//
import { readFile, readTextFile, writeTextFile } from "@tauri-apps/plugin-fs"
import { invoke } from "@tauri-apps/api/core"

export function isScopeError(e: unknown): boolean {
  const msg = String((e as { message?: string } | undefined)?.message ?? e)
  return /forbidden|not allowed|scope/i.test(msg)
}

export async function readTextFileSafe(abs: string): Promise<string> {
  try {
    return await readTextFile(abs)
  } catch (e) {
    if (!isScopeError(e)) throw e
    return await invoke<string>("fs_read_text_file", { path: abs })
  }
}

export async function readFileSafe(abs: string): Promise<Uint8Array<ArrayBuffer>> {
  try {
    return (await readFile(abs)) as Uint8Array<ArrayBuffer>
  } catch (e) {
    if (!isScopeError(e)) throw e
    const b64 = await invoke<string>("fs_read_file_base64", { path: abs })
    const bin = atob(b64)
    const arr = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i)
    return arr
  }
}

export async function writeTextFileSafe(abs: string, content: string): Promise<void> {
  try {
    await writeTextFile(abs, content)
  } catch (e) {
    if (!isScopeError(e)) throw e
    await invoke("fs_write_text_file", { path: abs, contents: content })
  }
}

// string (data: prefix'siz).
export async function writeBinaryFileSafe(abs: string, base64: string): Promise<void> {
  await invoke("fs_write_file_base64", { path: abs, contents: base64 })
}
