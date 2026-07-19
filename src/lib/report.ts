//
//
//
import { isTransientNetworkError } from "./providers/error"
import { RESOURCE_INVALID } from "./http-noise"

const ENDPOINT = "https://www.codezal.com/api/report"
const MAX_PROMPTS_PER_SESSION = 5
const PROMPT_TTL_MS = 30_000

type ReportType = "feedback" | "error"

interface ReportPayload {
  type: ReportType
  version: string
  os: string
  arch: string
  message: string
  stack?: string
}

const seen = new Set<string>()
let promptCount = 0

export function __resetReportState(): void {
  seen.clear()
  promptCount = 0
}

function messageOf(err: unknown): string {
  if (err instanceof Error) return err.message
  if (typeof err === "string") return err
  if (err == null) return "unknown"
  try {
    return String(err)
  } catch {
    return "unstringifiable error"
  }
}

function stackOf(err: unknown): string {
  return err instanceof Error && typeof err.stack === "string" ? err.stack : ""
}

export function isNoiseError(message: string, name?: string): boolean {
  if (name === "AbortError") return true
  if (/\bAbort(Error)?\b|\baborted\b/i.test(message)) return true
  // WebKit/Tauri can surface normal ReadableStream teardown as a bare cancellation error.
  if (/^(?:request\s+)?cancell?ed[.!]?$/i.test(message.trim())) return true
  if (RESOURCE_INVALID.test(message)) return true // plugin-http stream teardown (bkz. http-noise.ts)
  if (isTransientNetworkError(message)) return true
  return false
}

export function dedupeKey(type: ReportType, message: string, stack: string): string {
  const firstFrame = stack.split("\n")[1]?.trim() ?? ""
  return `${type}:${message}:${firstFrame}`
}

export function shouldSurface(opts: {
  message: string
  name?: string
  stack: string
  enabled: boolean
}): boolean {
  if (!opts.enabled) return false
  if (isNoiseError(opts.message, opts.name)) return false
  if (promptCount >= MAX_PROMPTS_PER_SESSION) return false
  const key = dedupeKey("error", opts.message, opts.stack)
  if (seen.has(key)) return false
  seen.add(key)
  promptCount += 1
  return true
}

async function promptsEnabled(): Promise<boolean> {
  try {
    const { useSettingsStore } = await import("@/store/settings")
    return useSettingsStore.getState().settings.crashReporting !== false
  } catch {
    return true
  }
}

async function gatherMeta(): Promise<{ version: string; os: string; arch: string }> {
  let version = "?"
  let os = "?"
  let arch = "?"
  try {
    const { getVersion } = await import("@tauri-apps/api/app")
    version = await getVersion()
  } catch {
    /* yoksay */
  }
  try {
    const osMod = await import("@tauri-apps/plugin-os")
    os = osMod.platform()
    arch = osMod.arch()
  } catch {
    /* yoksay */
  }
  return { version, os, arch }
}

const HOME_PATTERNS = [
  /\/Users\/[^/\s]+/g, // macOS
  /\/home\/[^/\s]+/g, // Linux
  /[A-Za-z]:\\Users\\[^\\\s]+/g, // Windows
]
function capText(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) + "…[truncated]" : s
}
function scrubStack(stack: string): string {
  let s = stack
  for (const p of HOME_PATTERNS) s = s.replace(p, "~")
  return capText(s, 4000)
}

async function post(type: ReportType, message: string, stack?: string): Promise<boolean> {
  try {
    const meta = await gatherMeta()
    const payload: ReportPayload = { type, ...meta, message: capText(message, 1000) }
    if (stack) payload.stack = scrubStack(stack)
    const { tauriFetch } = await import("./providers/tauri-fetch")
    const token = (import.meta.env.VITE_REPORT_TOKEN as string | undefined) ?? ""
    const res = await tauriFetch(ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json", "x-report-token": token },
      body: JSON.stringify(payload),
    })
    return res.ok
  } catch {
    return false
  }
}

export async function sendFeedback(message: string): Promise<boolean> {
  const m = message.trim()
  if (!m) return false
  return post("feedback", m)
}

async function surfaceReportPrompt(message: string, stack: string): Promise<void> {
  const { useToastStore, toast } = await import("@/store/toast")
  const { t } = await import("@/lib/i18n")
  useToastStore.getState().show(t("settings.feedback.errorPrompt"), {
    kind: "error",
    duration: PROMPT_TTL_MS,
    action: {
      label: t("settings.feedback.sendButton"),
      onClick: () => {
        void post("error", message, stack).then((ok) =>
          toast[ok ? "success" : "error"](
            t(ok ? "settings.feedback.sent" : "settings.feedback.failed"),
          ),
        )
      },
    },
  })
}

export async function captureError(err: unknown, _source: string): Promise<void> {
  const message = messageOf(err)
  const stack = stackOf(err)
  const name = err instanceof Error ? err.name : undefined
  const enabled = await promptsEnabled()
  if (!shouldSurface({ message, name, stack, enabled })) return
  await surfaceReportPrompt(message, stack)
}

let reporterInstalled = false
export function installGlobalErrorReporter(): void {
  if (reporterInstalled || typeof window === "undefined") return
  reporterInstalled = true
  window.addEventListener("error", (e) => {
    if (!(e.error instanceof Error)) return
    void captureError(e.error, "window.error")
  })
  window.addEventListener("unhandledrejection", (e) => {
    void captureError(e.reason, "unhandledrejection")
  })
}
