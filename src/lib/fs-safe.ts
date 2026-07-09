//
import { readDir, readFile, readTextFile, writeTextFile } from "@tauri-apps/plugin-fs"
import { invoke } from "@tauri-apps/api/core"
import { normalizeNativeFsPath } from "./fs-path"

export function isScopeError(e: unknown): boolean {
  const msg = String((e as { message?: string } | undefined)?.message ?? e)
  return /forbidden|not allowed|scope/i.test(msg)
}

export async function readTextFileSafe(abs: string): Promise<string> {
  const path = normalizeNativeFsPath(abs)
  try {
    return await readTextFile(path)
  } catch (e) {
    if (!isScopeError(e)) throw e
    return await invoke<string>("fs_read_text_file", { path })
  }
}

export async function readFileSafe(abs: string): Promise<Uint8Array<ArrayBuffer>> {
  const path = normalizeNativeFsPath(abs)
  try {
    return (await readFile(path)) as Uint8Array<ArrayBuffer>
  } catch (e) {
    if (!isScopeError(e)) throw e
    const b64 = await invoke<string>("fs_read_file_base64", { path })
    const bin = atob(b64)
    const arr = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i)
    return arr
  }
}

export async function readDirSafe(abs: string): Promise<{ name: string; isDirectory: boolean }[]> {
  const path = normalizeNativeFsPath(abs)
  try {
    return await readDir(path)
  } catch (e) {
    try {
      const fallback = await invoke<{ name: string; isDirectory: boolean }[]>("fs_read_dir", { path })
      if (Array.isArray(fallback)) return fallback
    } catch {
      // Keep the original plugin error if the Rust fallback cannot read it either.
    }
    throw e
  }
}

export async function writeTextFileSafe(abs: string, content: string): Promise<void> {
  const path = normalizeNativeFsPath(abs)
  try {
    await writeTextFile(path, content)
  } catch (e) {
    if (!isScopeError(e)) throw e
    await invoke("fs_write_text_file", { path, contents: content })
  }
}

// string (data: prefix'siz).
export async function writeBinaryFileSafe(abs: string, base64: string): Promise<void> {
  await invoke("fs_write_file_base64", { path: normalizeNativeFsPath(abs), contents: base64 })
}
