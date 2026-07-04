// Headless browser (CDP) invoke wrappers — bkz. src-tauri/src/browser.rs.
//
import { invoke } from "@tauri-apps/api/core"

export type NavResult = { finalUrl: string; title: string }

// browser_screenshot base64'leri (toolCallId → JPEG base64). Tool execute buraya
export const pendingScreenshots = new Map<string, string>()

export function browserNavigate(sessionId: string, url: string): Promise<NavResult> {
  return invoke("browser_navigate", { sessionId, url })
}

export function browserScreenshot(sessionId: string): Promise<string> {
  return invoke("browser_screenshot", { sessionId })
}

export function browserConsole(sessionId: string): Promise<string[]> {
  return invoke("browser_console", { sessionId })
}

export function browserNetwork(sessionId: string): Promise<string[]> {
  return invoke("browser_network", { sessionId })
}

export function browserClose(sessionId: string): Promise<void> {
  return invoke("browser_close", { sessionId })
}

// `target` = snapshot ref'i (rakam) VEYA ham CSS selector (Rust resolve eder).

export function browserSnapshot(sessionId: string): Promise<string> {
  return invoke("browser_snapshot", { sessionId })
}
export function browserClick(sessionId: string, target: string): Promise<void> {
  return invoke("browser_click", { sessionId, target })
}
export function browserFill(sessionId: string, target: string, text: string): Promise<void> {
  return invoke("browser_fill", { sessionId, target, text })
}
export function browserSelect(sessionId: string, target: string, value: string): Promise<void> {
  return invoke("browser_select", { sessionId, target, value })
}
export function browserPress(sessionId: string, key: string): Promise<void> {
  return invoke("browser_press", { sessionId, key })
}
export function browserType(sessionId: string, text: string): Promise<void> {
  return invoke("browser_type", { sessionId, text })
}
export function browserScroll(sessionId: string, target?: string, dy?: number): Promise<void> {
  return invoke("browser_scroll", { sessionId, target, dy })
}
export function browserHover(sessionId: string, target: string): Promise<void> {
  return invoke("browser_hover", { sessionId, target })
}
export function browserWait(sessionId: string, selector: string, timeoutMs: number): Promise<void> {
  return invoke("browser_wait", { sessionId, selector, timeoutMs })
}
export function browserEval(sessionId: string, js: string): Promise<string> {
  return invoke("browser_eval", { sessionId, js })
}
