// Tauri app data dizininde JSON dosya tabanlı kalıcı depolama.
// Web fallback yok — Tauri runtime varsay (electron/web farkı şu an gereksiz).
import {
  BaseDirectory,
  exists,
  mkdir,
  readDir,
  readTextFile,
  remove,
  writeTextFile,
} from "@tauri-apps/plugin-fs"

const SESSIONS_DIR = "sessions"
const SNAPSHOTS_DIR = "snapshots"
const SETTINGS_FILE = "settings.json"
const BASE = BaseDirectory.AppData

// İlk kullanım için sessions/ klasörünü oluştur.
async function ensureSessionsDir(): Promise<void> {
  const has = await exists(SESSIONS_DIR, { baseDir: BASE })
  if (!has) await mkdir(SESSIONS_DIR, { baseDir: BASE, recursive: true })
}

export async function readJson<T>(path: string, fallback: T): Promise<T> {
  try {
    const has = await exists(path, { baseDir: BASE })
    if (!has) return fallback
    const raw = await readTextFile(path, { baseDir: BASE })
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

export async function writeJson(path: string, data: unknown): Promise<void> {
  await writeTextFile(path, JSON.stringify(data, null, 2), { baseDir: BASE })
}

export async function loadSettingsFile<T>(fallback: T): Promise<T> {
  return readJson(SETTINGS_FILE, fallback)
}

export async function saveSettingsFile(data: unknown): Promise<void> {
  await writeJson(SETTINGS_FILE, data)
}

export async function listSessionFiles(): Promise<string[]> {
  await ensureSessionsDir()
  const entries = await readDir(SESSIONS_DIR, { baseDir: BASE })
  return entries
    .filter((e) => e.isFile && e.name.endsWith(".json"))
    .map((e) => `${SESSIONS_DIR}/${e.name}`)
}

export async function loadSession<T>(id: string, fallback: T): Promise<T> {
  return readJson(`${SESSIONS_DIR}/${id}.json`, fallback)
}

export async function saveSession(id: string, data: unknown): Promise<void> {
  await ensureSessionsDir()
  await writeJson(`${SESSIONS_DIR}/${id}.json`, data)
}

export async function deleteSession(id: string): Promise<void> {
  const path = `${SESSIONS_DIR}/${id}.json`
  const has = await exists(path, { baseDir: BASE })
  if (has) await remove(path, { baseDir: BASE })
  // Snapshot klasörünü de temizle
  await clearSessionSnapshots(id)
}

// Snapshot storage — AppData/snapshots/<sessionId>/<messageId>/<encoded-rel-path>
// İçerik: dosyanın o anki ham içeriği. Dosya yoksa "__DELETED__" sentinel yazılır.
// Bu sentinel revert sırasında "dosya yoksa silinmeli" anlamına gelir.
const DELETED_SENTINEL = "__CODEZAL_SNAPSHOT_DELETED__"

function snapshotDir(sessionId: string, messageId: string): string {
  return `${SNAPSHOTS_DIR}/${sessionId}/${messageId}`
}

function encodePath(rel: string): string {
  // Sadece slash kaçışı yeter — diğer karakterler dosya sisteminde geçerli
  return encodeURIComponent(rel)
}

function decodePath(enc: string): string {
  return decodeURIComponent(enc)
}

export async function saveSnapshot(
  sessionId: string,
  messageId: string,
  relPath: string,
  content: string | null,
): Promise<void> {
  const dir = snapshotDir(sessionId, messageId)
  if (!(await exists(dir, { baseDir: BASE }))) {
    await mkdir(dir, { baseDir: BASE, recursive: true })
  }
  const file = `${dir}/${encodePath(relPath)}`
  await writeTextFile(file, content ?? DELETED_SENTINEL, { baseDir: BASE })
}

// Tek mesaja ait snapshot'lardan dosyaları geri yükle.
// Dönüş: { restored, deleted } — kaç dosya geri yüklendi/silindi.
export async function readSnapshot(
  sessionId: string,
  messageId: string,
  relPath: string,
): Promise<{ exists: boolean; content: string | null }> {
  const file = `${snapshotDir(sessionId, messageId)}/${encodePath(relPath)}`
  if (!(await exists(file, { baseDir: BASE }))) return { exists: false, content: null }
  const raw = await readTextFile(file, { baseDir: BASE })
  if (raw === DELETED_SENTINEL) return { exists: true, content: null }
  return { exists: true, content: raw }
}

export async function listSnapshotPaths(sessionId: string, messageId: string): Promise<string[]> {
  const dir = snapshotDir(sessionId, messageId)
  if (!(await exists(dir, { baseDir: BASE }))) return []
  const entries = await readDir(dir, { baseDir: BASE })
  return entries.filter((e) => e.isFile).map((e) => decodePath(e.name))
}

export async function clearSessionSnapshots(sessionId: string): Promise<void> {
  const dir = `${SNAPSHOTS_DIR}/${sessionId}`
  if (!(await exists(dir, { baseDir: BASE }))) return
  // recursive remove — Tauri plugin-fs remove dosya/dizin destekler ama recursive=true gerek
  await remove(dir, { baseDir: BASE, recursive: true })
}
