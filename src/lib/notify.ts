import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification"

export async function sendDesktopNotification(title: string, body?: string): Promise<void> {
  try {
    let granted = await isPermissionGranted()
    if (!granted) {
      const perm = await requestPermission()
      granted = perm === "granted"
    }
    if (granted) sendNotification(body != null ? { title, body } : { title })
  } catch {
    // Intentionally ignored.
  }
}
