// Tema uygulama: light | dark | system → <html class="dark"?>.
export type Theme = "light" | "dark" | "system"

export function applyTheme(theme: Theme): void {
  const root = document.documentElement
  const isDark =
    theme === "dark" ||
    (theme === "system" &&
      window.matchMedia("(prefers-color-scheme: dark)").matches)
  root.classList.toggle("dark", isDark)
}

// system seçiliyse OS değişimini takip et.
export function watchSystemTheme(onChange: (isDark: boolean) => void): () => void {
  const mq = window.matchMedia("(prefers-color-scheme: dark)")
  const handler = (e: MediaQueryListEvent) => onChange(e.matches)
  mq.addEventListener("change", handler)
  return () => mq.removeEventListener("change", handler)
}

// Yazı ölçeği — S/M/L/XL → Tauri webview setZoom (browser-level).
// CSS zoom denenmedi: content scale eder, viewport scale etmez,
// composer/title-bar ekran dışına itilir. Tauri setZoom Ctrl+/- equivalent'i
// — viewport-aware, layout taşmaz.
export type FontScale = "s" | "m" | "l" | "xl"

const FONT_SCALE_ZOOM: Record<FontScale, number> = {
  s: 0.9,
  m: 1.0,
  l: 1.1,
  xl: 1.2,
}

export async function applyFontScale(scale: FontScale | undefined): Promise<void> {
  const zoom = FONT_SCALE_ZOOM[scale ?? "m"]
  // Tauri context dışında (saf tarayıcı dev) sessizce geç
  if (typeof window === "undefined" || !("__TAURI_INTERNALS__" in window)) return
  try {
    const { getCurrentWebviewWindow } = await import("@tauri-apps/api/webviewWindow")
    await getCurrentWebviewWindow().setZoom(zoom)
  } catch (e) {
    console.warn("[font-scale] setZoom başarısız:", e)
  }
}
