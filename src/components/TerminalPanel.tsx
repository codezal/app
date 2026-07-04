import { useEffect, useRef, useState } from "react"
import { Terminal } from "@xterm/xterm"
import { FitAddon } from "@xterm/addon-fit"
import { WebLinksAddon } from "@xterm/addon-web-links"
import { SerializeAddon } from "@xterm/addon-serialize"
import { ChevronDown, Pencil, Plus, Sparkles, Trash2, X } from "@/lib/icons"
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

type Props = {
  workspacePath?: string
  onClose?: () => void
}

export function TerminalPanel({ workspacePath, onClose }: Props) {
  const t = useT()
  const sessions = useTerminalsStore((s) => s.sessions)
  const activeId = useTerminalsStore((s) => s.activeId)
  const ensureOne = useTerminalsStore((s) => s.ensureOne)
  const setActive = useTerminalsStore((s) => s.setActive)
  const create = useTerminalsStore((s) => s.create)
  const remove = useTerminalsStore((s) => s.remove)
  const rename = useTerminalsStore((s) => s.rename)
  const chatSessionId = useSessionsStore((s) => s.activeId)
  const sessionsLoaded = useSessionsStore((s) => s.loaded)
  const scopedChatSessionId = chatSessionId ?? undefined
  const visibleSessions = sessions.filter((s) => s.chatSessionId === scopedChatSessionId)

  useEffect(() => {
    if (!sessionsLoaded) return
    if (hydrated) {
      ensureOne(scopedChatSessionId)
      return
    }
    hydrated = true
    void (async () => {
      const enabled = useSettingsStore.getState().settings.terminalRestore ?? true
      if (enabled) {
        const snap = await loadTerminalSnapshots().catch(() => null)
        if (snap && snap.sessions.length > 0) {
          for (const s of snap.sessions) {
            if (s.buffer) pendingSnapshots.set(s.id, s.buffer)
          }
          useTerminalsStore
            .getState()
            .hydrate(
              snap.sessions.map((s) => ({ id: s.id, name: s.name, history: s.history })),
              snap.activeId,
            )
          ensureOne(scopedChatSessionId)
          return
        }
      }
      ensureOne(scopedChatSessionId)
    })()
  }, [ensureOne, scopedChatSessionId, sessionsLoaded])

  useEffect(() => {
    const ids = new Set(sessions.map((s) => s.id))
    for (const id of [...liveTerms.keys()]) {
      if (!ids.has(id)) disposeLiveTerm(id)
    }
  }, [sessions])

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col bg-codezal-bg">
      <HeaderBar
        sessions={visibleSessions}
        activeId={activeId}
        onSelect={setActive}
        onNew={() => create(scopedChatSessionId)}
        onClose={remove}
        onClosePanel={onClose}
        onRename={rename}
      />
      <div className="relative flex-1 min-h-0">
        {visibleSessions.map((s) => (
          <TerminalView
            key={s.id}
            session={s}
            workspacePath={workspacePath}
            visible={s.id === activeId}
          />
        ))}
        {visibleSessions.length === 0 && (
          <div className="flex h-full items-center justify-center text-sm text-codezal-mute">
            {t("terminal.noTerminals")}
          </div>
        )}
      </div>
    </div>
  )
}

function HeaderBar({
  sessions,
  activeId,
  onSelect,
  onNew,
  onClose,
  onClosePanel,
  onRename,
}: {
  sessions: TerminalSession[]
  activeId: string | null
  onSelect: (id: string) => void
  onNew: () => void
  onClose: (id: string) => void
  onClosePanel?: () => void
  onRename: (id: string, name: string) => void
}) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const [renameId, setRenameId] = useState<string | null>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const active = sessions.find((s) => s.id === activeId)

  function askAi() {
    if (!activeId) return
    const raw = liveTerms.get(activeId)?.serialize.serialize({ scrollback: 200 }) ?? ""
    // eslint-disable-next-line no-control-regex
    const clean = raw.replace(/\[[0-9;?]*[A-Za-z]/g, "").replace(/\][^]*/g, "")
    const text = clean.split("\n").slice(-150).join("\n").trimEnd()
    if (!text.trim()) return
    window.dispatchEvent(new CustomEvent("codezal:terminal-to-ai", { detail: { text } }))
  }

  useEffect(() => {
    if (!open) return
    function onDoc(e: MouseEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) {
        setOpen(false)
        setRenameId(null)
      }
    }
    document.addEventListener("mousedown", onDoc)
    return () => document.removeEventListener("mousedown", onDoc)
  }, [open])

  return (
    <div className="flex h-11 shrink-0 items-center gap-1 border-b border-codezal-hair bg-codezal-sidebar px-3.5">
      <div ref={wrapRef} className="relative flex min-w-0 items-center">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex min-w-0 items-center gap-1.5 rounded-md px-2 py-1 text-sm text-codezal-text hover:bg-codezal-panel-2/60"
        >
          <span
            className={cn(
              "h-1.5 w-1.5 shrink-0 rounded-full",
              active?.running ? "bg-codezal-accent" : "bg-codezal-mute/50",
            )}
          />
          <span className="max-w-[180px] truncate">{active?.name ?? t("terminal.title")}</span>
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-codezal-mute" />
        </button>

        {open && (
          <div className="absolute left-0 top-full z-50 mt-1 min-w-[220px] cz-menu py-1">
            <div className="px-2.5 pb-1 text-sm uppercase tracking-wide text-codezal-mute">
              {t("terminal.terminalsHeading")}
            </div>
            {sessions.map((s) => {
              const isActive = s.id === activeId
              if (renameId === s.id) {
                return (
                  <div key={s.id} className="px-2 py-1">
                    <input
                      autoFocus
                      defaultValue={s.name}
                      onBlur={(e) => {
                        const v = e.currentTarget.value.trim()
                        if (v) onRename(s.id, v)
                        setRenameId(null)
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") e.currentTarget.blur()
                        if (e.key === "Escape") {
                          e.currentTarget.value = s.name
                          e.currentTarget.blur()
                        }
                      }}
                      className="w-full rounded border border-codezal-hair bg-codezal-bg px-1.5 py-0.5 text-sm text-codezal-text outline-none focus:border-codezal-accent"
                    />
                  </div>
                )
              }
              return (
                <div
                  key={s.id}
                  className={cn(
                    "group flex items-center gap-1.5 px-2.5 py-1 text-sm",
                    isActive
                      ? "bg-codezal-panel-2/60 text-codezal-text"
                      : "text-codezal-dim hover:bg-codezal-panel-2 hover:text-codezal-text",
                  )}
                >
                  <span
                    className={cn(
                      "h-1.5 w-1.5 shrink-0 rounded-full",
                      s.running ? "bg-codezal-accent" : "bg-codezal-mute/50",
                    )}
                  />
                  <button
                    type="button"
                    onClick={() => {
                      onSelect(s.id)
                      setOpen(false)
                    }}
                    className="flex-1 truncate text-left"
                  >
                    {s.name}
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      setRenameId(s.id)
                    }}
                    title={t("terminal.renameTitle")}
                    className="opacity-0 group-hover:opacity-70 hover:opacity-100"
                  >
                    <Pencil className="h-4 w-4" />
                  </button>
                  {sessions.length > 1 && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        onClose(s.id)
                      }}
                      title={t("terminal.closeTitle")}
                      className="text-codezal-mute opacity-0 group-hover:opacity-70 hover:text-destructive hover:opacity-100"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </div>
              )
            })}
            <div className="my-1 h-px bg-codezal-hair" />
            <button
              type="button"
              onClick={() => {
                onNew()
                setOpen(false)
              }}
              className="flex w-full items-center gap-1.5 px-2.5 py-1 text-sm text-codezal-dim hover:bg-codezal-panel-2 hover:text-codezal-text"
            >
              <Plus className="h-4 w-4" />
              {t("terminal.newTerminal")}
            </button>
          </div>
        )}
      </div>
      {activeId && (
        <button
          type="button"
          onClick={() => onClose(activeId)}
          title={t("terminal.closeTerminal")}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-codezal-mute hover:bg-codezal-panel-2/60 hover:text-destructive"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      )}
      <button
        type="button"
        onClick={() => onNew()}
        title={t("terminal.newTerminal")}
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-codezal-mute hover:bg-codezal-panel-2/60 hover:text-codezal-text"
      >
        <Plus className="h-4 w-4" />
      </button>
      <button
        type="button"
        onClick={askAi}
        title={t("terminal.askAi")}
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-codezal-mute hover:bg-codezal-panel-2/60 hover:text-codezal-text"
      >
        <Sparkles className="h-4 w-4" />
      </button>
      <div className="flex-1" />
      {onClosePanel && (
        <button
          type="button"
          onClick={onClosePanel}
          title={tStatic("contextPanel.panelClose")}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-codezal-mute hover:bg-codezal-panel-2/60 hover:text-codezal-text"
        >
          <X className="h-4 w-4" />
        </button>
      )}
    </div>
  )
}

// xterm + portable-pty entegrasyonu.
type LiveTerm = {
  host: HTMLDivElement
  term: Terminal
  fit: FitAddon
  serialize: SerializeAddon
  pty: PtyHandle | null
  ptyReady: Promise<void>
  error: string | null
}

const liveTerms = new Map<string, LiveTerm>()

// ── Session restore (terminals.json) ────────────────────────────────────────
const pendingSnapshots = new Map<string, string>()
let hydrated = false
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
    return { id: s.id, name: s.name, buffer, savedAt: now, history: s.history }
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
  opts: { workspacePath?: string; shortPrompt: boolean },
): LiveTerm {
  const existing = liveTerms.get(sessionId)
  if (existing) return existing

  ensureThemeObserver()

  const host = document.createElement("div")
  host.style.width = "100%"
  host.style.height = "100%"

  const term = new Terminal({
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
    fontSize: 12,
    lineHeight: 1.3,
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

  const live: LiveTerm = { host, term, fit, serialize, pty: null, ptyReady: Promise.resolve(), error: null }
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

    const live = getOrCreateLiveTerm(session.id, { workspacePath, shortPrompt })
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.id])

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
