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

// Focus tabanlı navigasyon: bildirim gönderildiğinde hedef sessionId burada hatırlanır.
// Codezal penceresi odak kazandığında (bildirime tıklayınca uygulama aktifleşir) bu session
// açılır. onAction bazı platformlarda/dev'de güvenilir tetiklenmediği için asıl mekanizma budur.
let pendingTargetSessionId: string | null = null

/** Bekleyen bildirim hedefini döndürür ve temizler (tek tüketim). */
export function takePendingNotificationTarget(): string | null {
  const id = pendingTargetSessionId
  pendingTargetSessionId = null
  return id
}

function openSession(id: string): void {
  void import("@/store/sessions")
    .then(({ useSessionsStore }) => useSessionsStore.getState().open(id))
    .catch(() => {
      // Intentionally ignored.
    })
}

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
    openSession(sessionId)
  }).catch(() => {
    // Intentionally ignored.
  })

  // Asıl mekanizma: pencere odak kazandığında bekleyen bildirim hedefine atla.
  window.addEventListener("focus", () => {
    const id = takePendingNotificationTarget()
    if (id) openSession(id)
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
      pendingTargetSessionId = sessionId
      sendNotification({ title, body, id, extra: { sessionId } })
    } else {
      sendNotification(body != null ? { title, body } : { title })
    }
  } catch {
    // Intentionally ignored.
  }
}
