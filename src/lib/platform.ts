
function tauriPlatform(): string | null {
  if (typeof window === "undefined") return null
  const internals = (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__
  if (internals && typeof (internals as Record<string, unknown>).platform === "string") {
    return (internals as Record<string, unknown>).platform as string
  }
  return null
}

function ua(): string {
  return typeof navigator !== "undefined" ? navigator.userAgent.toLowerCase() : ""
}

export function isMacOS(): boolean {
  const p = tauriPlatform()
  if (p) return p === "macos"
  return /mac|iphone|ipad/.test(ua())
}

export function isWindows(): boolean {
  const p = tauriPlatform()
  if (p) return p === "windows"
  return ua().includes("windows")
}

export function isLinux(): boolean {
  const p = tauriPlatform()
  if (p) return p === "linux"
  const a = ua()
  return a.includes("linux") && !a.includes("android")
}

const IS_MAC = isMacOS()

//
export function fmtKbd(s: string): string {
  if (!s.includes("⌘") && !s.includes("⌃")) return s
  if (IS_MAC) return s
  return s.replace(/⌘\/Ctrl/g, "Ctrl").replace(/⌘/g, "Ctrl").replace(/⌃/g, "Ctrl")
}
