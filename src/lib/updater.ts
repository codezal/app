//
//
import { check, type Update } from "@tauri-apps/plugin-updater"
import { relaunch } from "@tauri-apps/plugin-process"
import { useSettingsStore } from "@/store/settings"

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

// sunucu Content-Length vermezse 0 olabilir (belirsiz ilerleme).
export async function downloadAndRelaunch(
  update: Update,
  onProgress: (downloaded: number, total: number) => void,
): Promise<void> {
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
}
