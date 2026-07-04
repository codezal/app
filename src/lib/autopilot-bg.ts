// Autopilot background helpers — autostart (login launch) + keep-awake (prevent
// system idle-sleep so the scheduler keeps ticking unattended). Cross-platform:
// autostart via tauri-plugin-autostart (registered Rust-side, called by its
// plugin command name — no JS package dependency); keep-awake via a Rust command
// that spawns `caffeinate` (macOS) / a hidden PowerShell SetThreadExecutionState
// loop (Windows). All calls best-effort: silent no-op outside Tauri (tests/web).
import { invoke } from "@tauri-apps/api/core"

// Login-launch on/off.
export async function setAutostart(on: boolean): Promise<void> {
  try {
    await invoke(on ? "plugin:autostart|enable" : "plugin:autostart|disable")
  } catch {
    // not under Tauri / plugin unavailable — ignore
  }
}

export async function isAutostartEnabled(): Promise<boolean> {
  try {
    return await invoke<boolean>("plugin:autostart|is_enabled")
  } catch {
    return false
  }
}

// Prevent system idle-sleep while `on` is true so the (app-open) scheduler keeps
// firing unattended. Releases the OS assertion / kills the helper when false.
export async function setKeepAwake(on: boolean): Promise<void> {
  try {
    await invoke("set_keep_awake", { enabled: on })
  } catch {
    // not under Tauri — ignore
  }
}
