import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
  onAction,
} from "@tauri-apps/plugin-notification"

// Bildirim -> sahip session eşlemesi. sessionId bildirimin `extra` alanına gömülür;
// kullanıcı bildirime tıkladığında onAction geri çağrısında okunup ilgili sohbete atlanır.
// id, platformların bildirimi benzersiz referanslaması için 32-bit tam sayı olarak verilir.
let nextNotificationId = 1

function focusWindow(): void {
  void (async () => {
    try {
      const { getCurrentWindow } = await import("@tauri-apps/api/window")
      const w = getCurrentWindow()
      await w.show()
      await w.unminimize()
      await w.setFocus()
    } catch {
      // Intentionally ignored.
    }
  })()
}

// Global tek dinleyici: bir bildirime tıklanınca onu gönderen session'a geç.
// extra.sessionId yoksa (örn. PR review) sadece pencereyi öne getir.
if (typeof window !== "undefined") {
  onAction((notification) => {
    const sessionId = (notification.extra as { sessionId?: string } | undefined)?.sessionId
    focusWindow()
    if (!sessionId) return
    void import("@/store/sessions")
      .then(({ useSessionsStore }) => useSessionsStore.getState().open(sessionId))
      .catch(() => {
        // Intentionally ignored.
      })
  }).catch(() => {
    // Intentionally ignored.
  })
}

export async function sendDesktopNotification(
  title: string,
  body?: string,
  sessionId?: string,
): Promise<void> {
  try {
    let granted = await isPermissionGranted()
    if (!granted) {
      const perm = await requestPermission()
      granted = perm === "granted"
    }
    if (!granted) return
    if (sessionId != null) {
      const id = nextNotificationId++
      if (nextNotificationId > 0x7fffffff) nextNotificationId = 1
      sendNotification({ title, body, id, extra: { sessionId } })
    } else {
      sendNotification(body != null ? { title, body } : { title })
    }
  } catch {
    // Intentionally ignored.
  }
}
