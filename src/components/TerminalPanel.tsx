import { useEffect, useRef, useState } from "react"
import { Terminal } from "@xterm/xterm"
import { FitAddon } from "@xterm/addon-fit"
import { WebLinksAddon } from "@xterm/addon-web-links"
import { SerializeAddon } from "@xterm/addon-serialize"
import { useTerminalsStore, type TerminalSession } from "@/store/terminals"
import { useSessionsStore } from "@/store/sessions"
import { spawnPty, type PtyHandle } from "@/lib/pty"
import { terminalWriter } from "@/lib/terminal-writer"
import { detectUrls } from "@/lib/detect-urls"
import { usePreviewStore } from "@/store/preview"
import {
  loadTerminalSnapshots,
  saveTerminalSnapshots,
  type TerminalSnapshot,
} from "@/lib/terminal-persist"
import { rcfileEnv } from "@/lib/terminal-rcfile"
import { useSettingsStore } from "@/store/settings"
import { cn } from "@/lib/utils"
import { useT } from "@/lib/i18n/useT"
import { t as tStatic } from "@/lib/i18n"
import { errorMessage } from "@/lib/errors"
import { registerDropTarget } from "@/lib/internal-drag"
import { formatTerminalPathInput } from "@/lib/terminal-path-input"

type Props = {
  workspacePath?: string
  terminalId?: string
}

export function TerminalPanel({ workspacePath, terminalId }: Props) {
  const t = useT()
  const sessions = useTerminalsStore((s) => s.sessions)
  const activeId = useTerminalsStore((s) => s.activeId)
  const ensureOne = useTerminalsStore((s) => s.ensureOne)
  const create = useTerminalsStore((s) => s.create)
  const setActive = useTerminalsStore((s) => s.setActive)
  const chatSessionId = useSessionsStore((s) => s.activeId)
  const sessionsLoaded = useSessionsStore((s) => s.loaded)
  const scopedChatSessionId = chatSessionId ?? undefined
  const visibleSession = sessions.find(
    (session) =>
      session.id === (terminalId ?? activeId) &&
      session.chatSessionId === scopedChatSessionId &&
      session.workspacePath === workspacePath,
  )

  useEffect(() => {
    if (!sessionsLoaded || !scopedChatSessionId) return
    if (!hydrationPromise) {
      hydrationPromise = (async () => {
        const enabled = useSettingsStore.getState().settings.terminalRestore ?? true
        if (enabled) {
          const snap = await loadTerminalSnapshots().catch(() => null)
          if (snap && snap.sessions.length > 0) {
            for (const s of snap.sessions) {
              if (s.chatSessionId && s.buffer) pendingSnapshots.set(s.id, s.buffer)
            }
            useTerminalsStore.getState().hydrate(snap.sessions, snap.activeId)
          }
        }
      })()
    }

    let active = true
    void hydrationPromise.then(() => {
      if (!active) return
      if (!terminalId) {
        ensureOne(scopedChatSessionId, workspacePath)
        return
      }
      const exists = useTerminalsStore.getState().sessions.some(
        (session) =>
          session.id === terminalId &&
          session.chatSessionId === scopedChatSessionId &&
          session.workspacePath === workspacePath,
      )
      if (!exists) create(scopedChatSessionId, workspacePath, { id: terminalId })
      setActive(terminalId)
    })
    return () => {
      active = false
    }
  }, [create, ensureOne, scopedChatSessionId, sessionsLoaded, setActive, terminalId, workspacePath])

  useEffect(() => {
    const onAskAi = () => sendActiveTerminalToAi()
    window.addEventListener("codezal:terminal-ask-ai", onAskAi)
    return () => window.removeEventListener("codezal:terminal-ask-ai", onAskAi)
  }, [])

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col bg-codezal-bg">
      <div className="relative flex-1 min-h-0">
        {visibleSession && (
          <TerminalView
            key={visibleSession.id}
            session={visibleSession}
            workspacePath={workspacePath}
            visible
          />
        )}
        {!visibleSession && (
          <div className="flex h-full items-center justify-center text-sm text-codezal-mute">
            {t("terminal.noTerminals")}
          </div>
        )}
      </div>
    </div>
  )
}

// xterm + portable-pty integration.
type LiveTerm = {
  host: HTMLDivElement
  workspacePath?: string
  term: Terminal
  fit: FitAddon
  serialize: SerializeAddon
  pty: PtyHandle | null
  ptyReady: Promise<void>
  error: string | null
}

const liveTerms = new Map<string, LiveTerm>()
let liveSessionSubscribed = false

function ensureLiveSessionSubscription() {
  if (liveSessionSubscribed) return
  liveSessionSubscribed = true
  useTerminalsStore.subscribe((state) => {
    const ids = new Set(state.sessions.map((session) => session.id))
    for (const id of [...liveTerms.keys()]) {
      if (!ids.has(id)) disposeLiveTerm(id)
    }
  })
}

function sendActiveTerminalToAi() {
  const activeId = useTerminalsStore.getState().activeId
  if (!activeId) return
  const raw = liveTerms.get(activeId)?.serialize.serialize({ scrollback: 200 }) ?? ""
  // eslint-disable-next-line no-control-regex
  const clean = raw.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "").replace(/\x1b\][^\x07]*\x07/g, "")
  const text = clean.split("\n").slice(-150).join("\n").trimEnd()
  if (!text.trim()) return
  window.dispatchEvent(new CustomEvent("codezal:terminal-to-ai", { detail: { text } }))
}

// ── Session restore (terminals.json) ────────────────────────────────────────
const pendingSnapshots = new Map<string, string>()
let hydrationPromise: Promise<void> | null = null
const SNAPSHOT_SCROLLBACK = 1000
const RESTORE_MARKER = "\r\n\x1b[90m──────── ⤺ ────────\x1b[0m\r\n"

let snapTimer: ReturnType<typeof setTimeout> | null = null
function scheduleSnapshot() {
  if (snapTimer) return
  snapTimer = setTimeout(() => {
    snapTimer = null
    void doSnapshot()
  }, 1500)
}

async function doSnapshot() {
  const enabled = useSettingsStore.getState().settings.terminalRestore ?? true
  if (!enabled) return
  const { sessions, activeId } = useTerminalsStore.getState()
  if (sessions.length === 0) {
    await saveTerminalSnapshots({ sessions: [], activeId: null })
    return
  }
  const now = Date.now()
  const out: TerminalSnapshot[] = sessions.map((s) => {
    const live = liveTerms.get(s.id)
    let buffer: string
    if (live) {
      try {
        buffer = live.serialize.serialize({ scrollback: SNAPSHOT_SCROLLBACK })
      } catch {
        buffer = ""
      }
    } else {
      buffer = pendingSnapshots.get(s.id) ?? ""
    }
    return {
      id: s.id,
      name: s.name,
      chatSessionId: s.chatSessionId,
      workspacePath: s.workspacePath,
      toolId: s.toolId,
      launchCommand: s.launchCommand,
      buffer,
      savedAt: now,
      history: s.history,
    }
  })
  await saveTerminalSnapshots({ sessions: out, activeId })
}

// eslint-disable-next-line react-refresh/only-export-components -- shutdown flush utility.
export async function flushTerminalSnapshots(): Promise<void> {
  if (snapTimer) {
    clearTimeout(snapTimer)
    snapTimer = null
  }
  await doSnapshot()
}

let snapshotSubscribed = false
function ensureSnapshotSubscription() {
  if (snapshotSubscribed) return
  snapshotSubscribed = true
  useTerminalsStore.subscribe(() => scheduleSnapshot())
}

function cssVarColor(varName: string, fallback: string): string {
  try {
    const probe = document.createElement("span")
    probe.style.display = "none"
    probe.style.color = `hsl(var(${varName}))`
    document.body.appendChild(probe)
    const rgb = getComputedStyle(probe).color
    probe.remove()
    return rgb || fallback
  } catch {
    return fallback
  }
}

function rgbWithAlpha(rgb: string, alpha: number): string {
  const m = rgb.match(/rgba?\(([^)]+)\)/)
  if (!m) return rgb
  const [r, g, b] = m[1].split(",").map((s) => s.trim())
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

function terminalTheme() {
  const accent = cssVarColor("--codezal-accent", "#f0b75f")
  return {
    background: cssVarColor("--codezal-bg", "#0f0f0f"),
    foreground: cssVarColor("--codezal-text", "#e0e0e0"),
    cursor: accent,
    selectionBackground: rgbWithAlpha(accent, 0.27),
  }
}

let themeObserverStarted = false
function ensureThemeObserver() {
  if (themeObserverStarted) return
  themeObserverStarted = true
  const obs = new MutationObserver(() => {
    const theme = terminalTheme()
    for (const live of liveTerms.values()) {
      live.term.options.theme = theme
    }
  })
  obs.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["class", "style"],
  })
}

function getOrCreateLiveTerm(
  sessionId: string,
  opts: { workspacePath?: string; shortPrompt: boolean; launchCommand?: string },
): LiveTerm {
  ensureLiveSessionSubscription()
  const existing = liveTerms.get(sessionId)
  if (existing && existing.workspacePath === opts.workspacePath) return existing
  if (existing) disposeLiveTerm(sessionId)

  ensureThemeObserver()

  const host = document.createElement("div")
  host.style.width = "100%"
  host.style.height = "100%"

  const term = new Terminal({
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
    fontSize: 12,
    lineHeight: 1,
    cursorBlink: true,
    scrollback: 10_000,
    theme: terminalTheme(),
  })
  const fit = new FitAddon()
  const serialize = new SerializeAddon()
  term.loadAddon(fit)
  term.loadAddon(new WebLinksAddon())
  term.loadAddon(serialize)
  term.open(host)

  const live: LiveTerm = {
    host,
    workspacePath: opts.workspacePath,
    term,
    fit,
    serialize,
    pty: null,
    ptyReady: Promise.resolve(),
    error: null,
  }
  liveTerms.set(sessionId, live)

  const restoredBuffer = pendingSnapshots.get(sessionId)
  if (restoredBuffer) {
    term.write(restoredBuffer)
    term.write(RESTORE_MARKER)
  }
  pendingSnapshots.delete(sessionId)
  ensureSnapshotSubscription()

  const { patch } = useTerminalsStore.getState()
  live.ptyReady = (async () => {
    try {
      const env = await rcfileEnv({ shortPrompt: opts.shortPrompt }).catch(() => undefined)
      const handle = await spawnPty({
        rows: term.rows,
        cols: term.cols,
        cwd: opts.workspacePath,
        env,
      })
      live.pty = handle
      patch(sessionId, { running: true })

      const writer = terminalWriter((data, done) => term.write(data, done))

      let urlTail = ""
      await handle.onData((chunk) => {
        writer.push(chunk)
        scheduleSnapshot()
        const wsPath = opts.workspacePath
        if (wsPath) {
          const scan = urlTail + chunk
          if (scan.includes("://")) {
            for (const { url } of detectUrls(scan)) {
              usePreviewStore.getState().addDetected(wsPath, url)
            }
          }
          urlTail = scan.length > 256 ? scan.slice(-256) : scan
        }
      })
      await handle.onExit(() => {
        writer.push(`\r\n\x1b[31m${tStatic("terminal.ptyExited")}\x1b[0m\r\n`)
        patch(sessionId, { running: false })
      })
      // xterm input → PTY stdin
      term.onData((data) => {
        void handle.write(data)
      })
      // xterm resize → PTY resize
      term.onResize(({ rows, cols }) => {
        void handle.resize(rows, cols)
      })
      if (opts.launchCommand) {
        await handle.write(`${opts.launchCommand}\r`)
      }
    } catch (e) {
      const msg = errorMessage(e)
      live.error = msg
      term.write(`\r\n\x1b[31m${tStatic("terminal.ptyFailed", { message: msg })}\x1b[0m\r\n`)
      patch(sessionId, { running: false })
      throw e
    }
  })()

  return live
}

function disposeLiveTerm(sessionId: string) {
  const live = liveTerms.get(sessionId)
  if (!live) return
  liveTerms.delete(sessionId)
  void live.pty?.dispose()
  live.term.dispose()
  live.host.remove()
}

function TerminalView({
  session,
  workspacePath,
  visible,
}: {
  session: TerminalSession
  workspacePath?: string
  visible: boolean
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const liveRef = useRef<LiveTerm | null>(null)
  const [error, setError] = useState<string | null>(null)
  const shortPrompt = useSettingsStore((s) => s.settings.terminalShortPrompt ?? true)

  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    const live = getOrCreateLiveTerm(session.id, {
      workspacePath,
      shortPrompt,
      launchCommand: session.launchCommand,
    })
    liveRef.current = live
    el.appendChild(live.host)
    setError(live.error)
    live.ptyReady.catch(() => setError(live.error))

    requestAnimationFrame(() => {
      try {
        live.fit.fit()
      } catch {
        // Intentionally ignored.
      }
    })

    // Container resize observer → xterm fit
    const ro = new ResizeObserver(() => {
      try {
        live.fit.fit()
      } catch {
        // Intentionally ignored.
      }
    })
    ro.observe(el)

    return () => {
      ro.disconnect()
      if (live.host.parentElement === el) el.removeChild(live.host)
    }
  }, [session.id, session.launchCommand, shortPrompt, workspacePath])

  useEffect(() => {
    if (!visible) return
    setTimeout(() => {
      try {
        liveRef.current?.fit.fit()
        liveRef.current?.term.focus()
      } catch {
        // ignore
      }
    }, 0)
  }, [visible])

  useEffect(() => {
    if (!visible) return
    const el = containerRef.current
    if (!el) return

    return registerDropTarget({
      el,
      accepts: "file",
      onDrop: (path) => {
        const live = liveRef.current
        if (!live) return
        live.term.focus()
        void live.ptyReady
          .then(() => live.pty?.write(formatTerminalPathInput(path)))
          .catch(() => {})
      },
    })
  }, [visible])

  return (
    <div
      className={cn(
        "absolute inset-0 flex flex-col bg-codezal-bg",
        !visible && "invisible pointer-events-none",
      )}
    >
      {error && (
        <div className="border-b border-destructive/40 bg-destructive/10 px-3 py-1.5 text-sm text-destructive">
          {error}
        </div>
      )}
      <div ref={containerRef} className="flex-1 min-h-0 overflow-hidden p-1" />
    </div>
  )
}
