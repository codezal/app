// Local error log — append-only JSON-lines at ~/.codezal/error.log.
//
// Why: agent failures and uncaught exceptions currently only flash on screen
// (and, for crashes, optionally get offered as a remote report). Nothing is
// persisted locally, so a transient error is gone the moment the view scrolls
// away and there is no trail to hand to a maintainer for diagnosis. This log
// keeps that trail on the user's own machine.
//
// Design (mirrors plugins/audit.ts on purpose)
// --------------------------------------------
// - One JSON object per line (JSON-lines) — append-friendly, partial-read safe,
//   survives a truncated last line on crash.
// - Append via Tauri fs `writeTextFile({ append: true })`. No read-modify-write,
//   so concurrent appends don't lose entries.
// - Best-effort: a failed write must NEVER propagate. We log to console and
//   move on — error reporting must not break the thing that just errored.
// - Rotation: when the file passes ~1 MB it is rolled to `error.log.1`
//   (single generation) so it cannot grow unbounded.
// - Local-only: this is NOT telemetry. It ignores the crashReporting setting
//   and never leaves the device, so it captures every real error regardless of
//   whether the user opts into remote crash reports.
//
// Privacy note: unlike the remote reporter we do NOT scrub home paths — the
// file lives on the user's machine and absolute paths are usually what makes a
// stack trace actionable when they share it. The user can redact before
// sharing; we only cap sizes so a single entry cannot blow up the file.
import {
  exists,
  mkdir,
  readTextFile,
  writeTextFile,
  rename,
  stat,
} from "@tauri-apps/plugin-fs"
import { homeDir } from "@tauri-apps/api/path"

export type ErrorLogEntry = {
  // Where the error was caught, e.g. "window.error", "agent:code-reviewer",
  // "markdown-render". Free-form but kept short.
  source: string
  message: string
  name?: string
  stack?: string
  // Arbitrary structured context (sessionId, workerId, tool, …). Kept opaque
  // so callers can attach whatever helps diagnosis without changing the schema.
  context?: Record<string, unknown>
}

type ErrorLogLine = ErrorLogEntry & { ts: number }

const MAX_BYTES = 1_000_000 // ~1 MB before rotation
const MAX_MESSAGE = 2000
const MAX_STACK = 8000
const MAX_READ_LINES = 1000 // viewer cap

function cap(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) + "…[truncated]" : s
}

// JSON.stringify that cannot throw on circular / exotic context values.
function safeContext(ctx: Record<string, unknown> | undefined): unknown {
  if (!ctx) return undefined
  try {
    return JSON.parse(JSON.stringify(ctx)) as unknown
  } catch {
    return "[unserializable]"
  }
}

async function rootDir(): Promise<string> {
  const home = await homeDir()
  const r = home.replace(/[\\/]+$/, "") + "/.codezal"
  if (!(await exists(r))) await mkdir(r, { recursive: true })
  return r
}

// Absolute path of the active log file. Exported so the UI / diagnostics can
// point the user at it ("open log folder", copy path, …).
export async function errorLogPath(): Promise<string> {
  return (await rootDir()) + "/error.log"
}

// Rotate when the active log grows past MAX_BYTES. Single generation: the old
// `error.log.1` is overwritten by rename. Best-effort — failure is swallowed.
async function rotateIfNeeded(path: string): Promise<void> {
  try {
    if (!(await exists(path))) return
    const info = await stat(path)
    if (info.size < MAX_BYTES) return
    await rename(path, path + ".1")
  } catch (e) {
    console.warn("[error-log] rotate failed:", (e as Error).message)
  }
}

// Append one error entry. Best-effort: never throws to the caller. The `ts`
// stamp is added here so callers stay side-effect-light and tests can pass a
// fixed entry without caring about the clock.
export async function logError(entry: ErrorLogEntry): Promise<void> {
  try {
    const path = await errorLogPath()
    await rotateIfNeeded(path)
    const line: ErrorLogLine = {
      ts: Date.now(),
      source: entry.source,
      message: cap(entry.message, MAX_MESSAGE),
    }
    if (entry.name) line.name = entry.name
    if (entry.stack) line.stack = cap(entry.stack, MAX_STACK)
    const ctx = safeContext(entry.context)
    if (ctx !== undefined) line.context = ctx as Record<string, unknown>
    await writeTextFile(path, JSON.stringify(line) + "\n", { append: true })
  } catch (e) {
    console.warn("[error-log] append failed:", (e as Error).message, entry)
  }
}

// Read the most recent entries (newest first), capped at MAX_READ_LINES.
// Tolerates a malformed trailing line (crash during append). Not wired to any
// UI yet — handy for a future diagnostics view and for tests.
export async function readErrorLog(limit = 200): Promise<ErrorLogLine[]> {
  try {
    const path = await errorLogPath()
    if (!(await exists(path))) return []
    const raw = await readTextFile(path)
    const lines = raw.split("\n").filter((l) => l.trim().length > 0)
    const slice = lines.slice(-Math.min(limit, MAX_READ_LINES))
    const out: ErrorLogLine[] = []
    for (const l of slice) {
      try {
        out.push(JSON.parse(l) as ErrorLogLine)
      } catch {
        // skip corrupt line
      }
    }
    return out.reverse() // newest first
  } catch (e) {
    console.warn("[error-log] read failed:", (e as Error).message)
    return []
  }
}

// Combined on-disk size in bytes of the active log + its single rotated
// generation. Used by the settings UI to show how much space the log takes.
// Best-effort: returns 0 if the files cannot be stat'd (e.g. not created yet).
export async function errorLogSize(): Promise<number> {
  let total = 0
  try {
    const base = await errorLogPath()
    for (const p of [base, base + ".1"]) {
      try {
        if (await exists(p)) {
          const info = await stat(p)
          total += info.size
        }
      } catch {
        // a single unreadable generation must not zero the whole result
      }
    }
  } catch (e) {
    console.warn("[error-log] size failed:", (e as Error).message)
  }
  return total
}

// Wipe the error log (active + rotated). For a future "clear log" action.
export async function clearErrorLog(): Promise<void> {
  try {
    const path = await errorLogPath()
    if (await exists(path)) await writeTextFile(path, "")
    if (await exists(path + ".1")) await writeTextFile(path + ".1", "")
  } catch (e) {
    console.warn("[error-log] clear failed:", (e as Error).message)
  }
}
