// Terminal — gerçek PTY (portable-pty + xterm.js). vim/htop/nano/ssh çalışır.
// Multi-session tab şerit üstte (store'da tutulur), gövdede xterm canvas.
import { useEffect, useRef, useState } from "react"
import { Terminal } from "@xterm/xterm"
import { FitAddon } from "@xterm/addon-fit"
import { WebLinksAddon } from "@xterm/addon-web-links"
import { ChevronDown, Pencil, Plus, Trash2 } from "lucide-react"
import { useTerminalsStore, type TerminalSession } from "@/store/terminals"
import { spawnPty, type PtyHandle } from "@/lib/pty"
import { rcfileEnv } from "@/lib/terminal-rcfile"
import { useSettingsStore } from "@/store/settings"
import { cn } from "@/lib/utils"
import { useT } from "@/lib/i18n/useT"
import { t as tStatic } from "@/lib/i18n"

type Props = {
  workspacePath?: string
}

export function TerminalPanel({ workspacePath }: Props) {
  const t = useT()
  const sessions = useTerminalsStore((s) => s.sessions)
  const activeId = useTerminalsStore((s) => s.activeId)
  const ensureOne = useTerminalsStore((s) => s.ensureOne)
  const setActive = useTerminalsStore((s) => s.setActive)
  const create = useTerminalsStore((s) => s.create)
  const remove = useTerminalsStore((s) => s.remove)
  const rename = useTerminalsStore((s) => s.rename)

  // Mount: en az bir terminal olsun
  useEffect(() => {
    ensureOne()
  }, [ensureOne])

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col bg-codezal-bg">
      <HeaderBar
        sessions={sessions}
        activeId={activeId}
        onSelect={setActive}
        onNew={create}
        onClose={remove}
        onRename={rename}
      />
      {/* Tüm session'lar mount kalır (xterm state korunsun); sadece active görünür */}
      <div className="relative flex-1 min-h-0">
        {sessions.map((s) => (
          <TerminalView
            key={s.id}
            session={s}
            workspacePath={workspacePath}
            visible={s.id === activeId}
          />
        ))}
        {sessions.length === 0 && (
          <div className="flex h-full items-center justify-center text-[12px] text-codezal-mute">
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
  onRename,
}: {
  sessions: TerminalSession[]
  activeId: string | null
  onSelect: (id: string) => void
  onNew: () => void
  onClose: (id: string) => void
  onRename: (id: string, name: string) => void
}) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const [renameId, setRenameId] = useState<string | null>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const active = sessions.find((s) => s.id === activeId)

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
    <div className="flex h-[28px] shrink-0 items-stretch border-b border-codezal bg-codezal-sidebar">
      <div ref={wrapRef} className="relative flex min-w-0 flex-1 items-stretch">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex h-full min-w-0 flex-1 items-center gap-1.5 px-2.5 text-[11.5px] text-codezal-text hover:bg-codezal-panel-2/60"
        >
          <span
            className={cn(
              "h-1.5 w-1.5 shrink-0 rounded-full",
              active?.running ? "bg-codezal-accent" : "bg-codezal-mute/50",
            )}
          />
          <span className="truncate">{active?.name ?? t("terminal.title")}</span>
          <ChevronDown className="h-3 w-3 shrink-0 text-codezal-mute" />
        </button>

        {open && (
          <div className="absolute left-1 top-[30px] z-50 min-w-[220px] rounded-md border border-codezal bg-codezal-sidebar py-1 shadow-lg">
            <div className="px-2.5 pb-1 text-[10px] uppercase tracking-wide text-codezal-mute">
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
                      className="w-full rounded border border-codezal-hair bg-codezal-bg px-1.5 py-0.5 text-[11.5px] text-codezal-text outline-none focus:border-codezal-accent"
                    />
                  </div>
                )
              }
              return (
                <div
                  key={s.id}
                  className={cn(
                    "group flex items-center gap-1.5 px-2.5 py-1 text-[11.5px]",
                    isActive
                      ? "bg-codezal-panel-2/60 text-codezal-text"
                      : "text-codezal-dim hover:bg-codezal-panel-2/40 hover:text-codezal-text",
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
                    <Pencil className="h-3 w-3" />
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
                      <Trash2 className="h-3 w-3" />
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
              className="flex w-full items-center gap-1.5 px-2.5 py-1 text-[11.5px] text-codezal-dim hover:bg-codezal-panel-2/40 hover:text-codezal-text"
            >
              <Plus className="h-3 w-3" />
              {t("terminal.newTerminal")}
            </button>
          </div>
        )}
      </div>
      <button
        type="button"
        onClick={() => onNew()}
        title={t("terminal.newTerminal")}
        className="flex h-full w-7 shrink-0 items-center justify-center border-l border-codezal-hair text-codezal-mute hover:bg-codezal-panel-2/60 hover:text-codezal-text"
      >
        <Plus className="h-3 w-3" />
      </button>
    </div>
  )
}

// xterm + portable-pty entegrasyonu.
// Her session lifetime'ı boyunca: mount → spawn PTY → bind onData/onResize → unmount'ta dispose.
// visible=false iken DOM'da ama gizli (display:none yerine pozisyon ile gizleme — xterm
// scrollback DOM'da hesaplanır, display:none vermek boyut bozar).
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
  const termRef = useRef<Terminal | null>(null)
  const ptyRef = useRef<PtyHandle | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const patch = useTerminalsStore((s) => s.patch)
  const [error, setError] = useState<string | null>(null)
  // Default true — kullanıcı Settings'ten kapatabilir.
  const shortPrompt = useSettingsStore((s) => s.settings.terminalShortPrompt ?? true)

  // Mount + PTY spawn (sadece bir kez per session)
  useEffect(() => {
    const el = containerRef.current
    if (!el || termRef.current) return

    const term = new Terminal({
      fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
      fontSize: 12,
      lineHeight: 1.3,
      cursorBlink: true,
      scrollback: 10_000,
      theme: {
        background: "#0f0f0f",
        foreground: "#e0e0e0",
        cursor: "#f0b75f",
        selectionBackground: "#f0b75f44",
      },
    })
    const fit = new FitAddon()
    const links = new WebLinksAddon()
    term.loadAddon(fit)
    term.loadAddon(links)
    term.open(el)
    // fit() race: container layout henüz hesaplanmamış olabilir → RAF ile ertele.
    // Ek olarak this._renderer.value.dimensions hatası için try/catch.
    requestAnimationFrame(() => {
      try {
        fit.fit()
      } catch {
        // xterm internal race — sonraki ResizeObserver ile zaten fit eder
      }
    })

    termRef.current = term
    fitRef.current = fit

    let mounted = true
    ;(async () => {
      try {
        const env = await rcfileEnv({ shortPrompt }).catch(() => undefined)
        const handle = await spawnPty({
          rows: term.rows,
          cols: term.cols,
          cwd: workspacePath,
          env,
        })
        if (!mounted) {
          await handle.dispose()
          return
        }
        ptyRef.current = handle
        patch(session.id, { running: true })

        await handle.onData((chunk) => {
          term.write(chunk)
        })
        await handle.onExit(() => {
          term.write(`\r\n\x1b[31m${tStatic("terminal.ptyExited")}\x1b[0m\r\n`)
          patch(session.id, { running: false })
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
        const msg = e instanceof Error ? e.message : String(e)
        setError(msg)
        term.write(`\r\n\x1b[31m${tStatic("terminal.ptyFailed", { message: msg })}\x1b[0m\r\n`)
        patch(session.id, { running: false })
      }
    })()

    // Container resize observer → xterm fit
    const ro = new ResizeObserver(() => {
      try {
        fit.fit()
      } catch {
        // mount/unmount race — sessiz geç
      }
    })
    ro.observe(el)

    return () => {
      mounted = false
      ro.disconnect()
      void ptyRef.current?.dispose()
      term.dispose()
      termRef.current = null
      ptyRef.current = null
      fitRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.id])

  // Görünür olunca tekrar fit + focus
  useEffect(() => {
    if (!visible) return
    setTimeout(() => {
      try {
        fitRef.current?.fit()
        termRef.current?.focus()
      } catch {
        // ignore
      }
    }, 0)
  }, [visible])

  return (
    <div
      className={cn(
        "absolute inset-0 flex flex-col bg-[#0f0f0f]",
        !visible && "invisible pointer-events-none",
      )}
    >
      {error && (
        <div className="border-b border-destructive/40 bg-destructive/10 px-3 py-1.5 text-[11px] text-destructive">
          {error}
        </div>
      )}
      <div ref={containerRef} className="flex-1 min-h-0 overflow-hidden p-1" />
    </div>
  )
}
