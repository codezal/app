// Plugin audit log — append-only JSON-lines at ~/.codezal/audit.log.
//
// Why: SHA pinning + permission gating prevent classes of attack, but they
// leave no forensic trail. After an incident ("which plugin did that?"), or
// for SOC 2 / ISO 27001 compliance, the user needs an immutable record of
// every lifecycle + security event: what was installed, from which SHA, which
// permissions were approved, what was denied at runtime.
//
// Design
// ------
// - One JSON object per line (JSON-lines) — append-friendly, partial-read safe,
//   survives a truncated last line on crash.
// - Append via Tauri fs `writeTextFile({ append: true })`. No read-modify-write,
//   so concurrent appends don't lose entries.
// - Best-effort: a failed audit write must NEVER block the underlying action
//   (install/uninstall). We log to console and move on.
// - Rotation: when the file passes ~1 MB, it is rolled to `audit.log.1`
//   (single generation) so it cannot grow unbounded.
//
// Threat note: a plugin with `filesystem.write` could tamper with this file —
// it lives under the same scope as installed_plugins.json. True tamper-evidence
// (append-only fs flag, off-device log) is out of scope; this is a transparency
// + forensics aid, not an integrity guarantee.
import {
  exists,
  mkdir,
  readTextFile,
  writeTextFile,
  rename,
  stat,
} from "@tauri-apps/plugin-fs"
import { homeDir } from "@tauri-apps/api/path"
import type { Permission } from "./types"

export type AuditEvent =
  | "install"
  | "uninstall"
  | "enable"
  | "disable"
  | "update"
  | "permission-deny"
  | "network-deny"
  | "entry-reject"
  | "fingerprint-mismatch"
  | "signature-verify"
  | "signature-fail"
  | "marketplace-add"
  | "marketplace-remove"

export type AuditEntry = {
  // Epoch milliseconds. Caller stamps it (keeps this module side-effect free
  // for testing and avoids Date.now in unexpected places).
  ts: number
  event: AuditEvent
  // Plugin id ("name@channel") when the event concerns a plugin.
  plugin?: string
  // Pinned SHA at install/update time.
  sha?: string
  // Permissions approved (install) or the single permission denied.
  permissions?: Permission[]
  permission?: Permission
  // Marketplace url/id for marketplace events.
  marketplace?: string
  // Host that was blocked for network-deny.
  host?: string
  // Free-form detail (error text, reason).
  detail?: string
}

const MAX_BYTES = 1_000_000 // ~1 MB before rotation
const MAX_READ_LINES = 1000 // viewer cap

async function rootDir(): Promise<string> {
  const home = await homeDir()
  const r = home.replace(/[\\/]+$/, "") + "/.codezal"
  if (!(await exists(r))) await mkdir(r, { recursive: true })
  return r
}

async function logPath(): Promise<string> {
  return (await rootDir()) + "/audit.log"
}

// Rotate when the active log grows past MAX_BYTES. Single generation: the old
// `audit.log.1` is overwritten by rename. Best-effort — failure is swallowed.
async function rotateIfNeeded(path: string): Promise<void> {
  try {
    if (!(await exists(path))) return
    const info = await stat(path)
    if (info.size < MAX_BYTES) return
    await rename(path, path + ".1")
  } catch (e) {
    console.warn("[audit] rotate failed:", (e as Error).message)
  }
}

// Append one entry. Best-effort: never throws to the caller.
export async function appendAudit(entry: AuditEntry): Promise<void> {
  try {
    const path = await logPath()
    await rotateIfNeeded(path)
    const line = JSON.stringify(entry) + "\n"
    await writeTextFile(path, line, { append: true })
  } catch (e) {
    console.warn("[audit] append failed:", (e as Error).message, entry)
  }
}

// Read the most recent entries (newest first), capped at MAX_READ_LINES.
// Tolerates a malformed trailing line (crash during append).
export async function readAudit(limit = 200): Promise<AuditEntry[]> {
  try {
    const path = await logPath()
    if (!(await exists(path))) return []
    const raw = await readTextFile(path)
    const lines = raw.split("\n").filter((l) => l.trim().length > 0)
    const slice = lines.slice(-Math.min(limit, MAX_READ_LINES))
    const out: AuditEntry[] = []
    for (const l of slice) {
      try {
        out.push(JSON.parse(l) as AuditEntry)
      } catch {
        // skip corrupt line
      }
    }
    return out.reverse() // newest first
  } catch (e) {
    console.warn("[audit] read failed:", (e as Error).message)
    return []
  }
}

// Wipe the audit log (active + rotated). User-initiated from the UI.
export async function clearAudit(): Promise<void> {
  const path = await logPath()
  if (await exists(path)) await writeTextFile(path, "")
  if (await exists(path + ".1")) await writeTextFile(path + ".1", "")
}
