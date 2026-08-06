//
//
import { check, type Update } from "@tauri-apps/plugin-updater"
import { relaunch } from "@tauri-apps/plugin-process"
import { useSettingsStore } from "@/store/settings"

// How often the running app silently re-checks for updates.
export const UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000 // 1 hour

export async function checkForUpdate(): Promise<Update | null> {
  try {
    return await check()
  } catch (e) {
    console.warn("[updater] check failed", e)
    return null
  }
}

export async function checkForUpdateOnLaunch(): Promise<Update | null> {
  if (!useSettingsStore.getState().settings.autoUpdate) return null
  return checkForUpdate()
}

// Single-flight guard: concurrent callers (menu item + toast button) must not
// start parallel downloads — a second call joins the in-flight one. Reset in
// finally so a failed download can be retried.
let inflightDownload: Promise<void> | null = null

// sunucu Content-Length vermezse 0 olabilir (belirsiz ilerleme).
export async function downloadAndRelaunch(
  update: Update,
  onProgress: (downloaded: number, total: number) => void,
): Promise<void> {
  if (inflightDownload) return inflightDownload
  const run = (async () => {
    let downloaded = 0
    let total = 0
    await update.downloadAndInstall((e) => {
      switch (e.event) {
        case "Started":
          total = e.data.contentLength ?? 0
          onProgress(0, total)
          break
        case "Progress":
          downloaded += e.data.chunkLength
          onProgress(downloaded, total)
          break
        case "Finished":
          onProgress(total, total)
          break
      }
    })
    await relaunch()
  })()
  inflightDownload = run
  try {
    await run
  } finally {
    inflightDownload = null
  }
}
