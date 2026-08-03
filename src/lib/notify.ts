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
// M101: herhangi bir window focus'unda tüketilmez — focus + kısa TTL; böylece bildirimi
// yok sayıp alt-tab yapan kullanıcı eski session'a zıplamaz (sadece gerçekten hedefe
// dönünce, onAction ile de eşleşirse).
let pendingTargetSessionId: string | null = null
let pendingTargetAt = 0
const PENDING_TTL_MS = 5_000

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

  // Asıl mekanizma: pencere odak kazandığında bekleyen bildirim hedefine atla —
  // SADECE bildirim kısa süre önce gönderildiyse (M101). Bildirimi görmezden
  // gelip uzun süre sonra alt-tab yapmak eski session'a zıplatmamalı.
  window.addEventListener("focus", () => {
    if (Date.now() - pendingTargetAt > PENDING_TTL_MS) {
      pendingTargetSessionId = null
      return
    }
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
      pendingTargetAt = Date.now()
      sendNotification({ title, body, id, extra: { sessionId } })
    } else {
      sendNotification(body != null ? { title, body } : { title })
    }
  } catch {
    // Intentionally ignored.
  }
}
