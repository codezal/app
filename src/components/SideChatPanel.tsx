// Quick chat panel (/btw) — a tool-free quick Q&A surface that inherits the
// current conversation context without touching the main thread.
import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react"
import { useSessionsStore } from "@/store/sessions"
import { useT } from "@/lib/i18n/useT"
import { cn } from "@/lib/utils"
import { Markdown } from "./Markdown"
import { Brain, ChevronDown, Loader2, MessageSquare, Plus, Send, X } from "@/lib/icons"

const PANEL_MARGIN = 12

type Props = {
  sessionId: string
  threadId: string | null
  busy: boolean
  onAsk: (question: string) => void
  onStop: () => void
  onNewThread: () => void
  onSelectThread: (id: string) => void
  onClose: () => void
}

export function SideChatPanel({
  sessionId,
  threadId,
  busy,
  onAsk,
  onStop,
  onNewThread,
  onSelectThread,
  onClose,
}: Props) {
  const t = useT()
  const threads = useSessionsStore((s) => s.sessions[sessionId]?.sideChats ?? [])
  const parentTitle = useSessionsStore((s) => s.sessions[sessionId]?.title)
  const active = useMemo(
    () => threads.find((x) => x.id === threadId) ?? threads[threads.length - 1],
    [threads, threadId],
  )
  const [text, setText] = useState("")
  const [showThreads, setShowThreads] = useState(false)
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null)
  const [dragging, setDragging] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)
  const bodyRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  const messages = active?.messages ?? []
  const lastLen = messages.length
  const lastContent = messages[messages.length - 1]?.content.length ?? 0
  useEffect(() => {
    const el = bodyRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [lastLen, lastContent])

  function submit() {
    const q = text.trim()
    if (!q || busy) return
    onAsk(q)
    setText("")
  }

  function startDrag(e: ReactPointerEvent<HTMLDivElement>) {
    if (e.button !== 0) return
    const panel = panelRef.current
    const parent = panel?.offsetParent instanceof HTMLElement ? panel.offsetParent : panel?.parentElement
    if (!panel || !parent) return
    const panelRect = panel.getBoundingClientRect()
    const parentRect = parent.getBoundingClientRect()
    const startX = pos?.x ?? panelRect.left - parentRect.left
    const startY = pos?.y ?? panelRect.top - parentRect.top
    const maxX = parentRect.width - panelRect.width - PANEL_MARGIN
    const maxY = parentRect.height - panelRect.height - PANEL_MARGIN
    const originX = e.clientX
    const originY = e.clientY
    const clampAxis = (value: number, max: number) =>
      max < PANEL_MARGIN ? PANEL_MARGIN : Math.min(Math.max(value, PANEL_MARGIN), max)
    const onMove = (ev: PointerEvent) => {
      setPos({
        x: clampAxis(startX + ev.clientX - originX, maxX),
        y: clampAxis(startY + ev.clientY - originY, maxY),
      })
    }
    const onUp = () => {
      setDragging(false)
      window.removeEventListener("pointermove", onMove)
      window.removeEventListener("pointerup", onUp)
      window.removeEventListener("pointercancel", onUp)
    }
    e.preventDefault()
    setDragging(true)
    window.addEventListener("pointermove", onMove)
    window.addEventListener("pointerup", onUp)
    window.addEventListener("pointercancel", onUp)
  }

  return (
    <div
      ref={panelRef}
      style={pos ? { left: pos.x, top: pos.y } : undefined}
      className={cn(
        "absolute z-30 flex h-[360px] max-h-[80%] w-[380px] flex-col overflow-hidden rounded-xl border border-codezal-hair bg-codezal-panel shadow-2xl",
        pos ? "" : "bottom-3 right-3",
      )}
    >
      <div className="flex h-9 shrink-0 items-center gap-1.5 border-b border-codezal-hair bg-codezal-sidebar px-2.5">
        <div
          onPointerDown={startDrag}
          className={cn(
            "flex min-w-0 flex-1 cursor-grab select-none items-center gap-1.5",
            dragging && "cursor-grabbing",
          )}
        >
          <MessageSquare className="h-3.5 w-3.5 shrink-0 text-codezal-accent" />
          <span className="text-sm font-medium text-codezal-text">{t("sideChat.title")}</span>
          {parentTitle && (
            <span className="min-w-0 flex-1 truncate text-sm text-codezal-mute" title={parentTitle}>
              · {parentTitle}
            </span>
          )}
          {!parentTitle && <span className="min-w-0 flex-1" />}
        </div>
        {dragging && (
          <span className="pointer-events-none text-sm text-codezal-mute">
            {t("sideChat.dragging")}
          </span>
        )}
        <div className="flex items-center gap-0.5">
          {threads.length > 1 && (
            <div className="relative">
              <button
                type="button"
                onClick={() => setShowThreads((v) => !v)}
                title={t("sideChat.threads")}
                className="flex h-6 items-center gap-0.5 rounded-md px-1.5 text-sm text-codezal-dim hover:bg-codezal-panel-2 hover:text-codezal-text"
              >
                {threads.length}
                <ChevronDown className="h-3 w-3" />
              </button>
              {showThreads && (
                <div className="absolute right-0 top-7 z-40 max-h-60 w-56 overflow-auto cz-menu py-1">
                  {threads
                    .slice()
                    .reverse()
                    .map((th) => {
                      const preview = th.messages[0]?.content ?? t("sideChat.emptyThread")
                      return (
                        <button
                          key={th.id}
                          type="button"
                          onClick={() => {
                            onSelectThread(th.id)
                            setShowThreads(false)
                          }}
                          className={cn(
                            "block w-full truncate px-2.5 py-1.5 text-left text-sm hover:bg-codezal-panel-2",
                            th.id === active?.id ? "text-codezal-accent" : "text-codezal-dim",
                          )}
                          title={preview}
                        >
                          {preview}
                        </button>
                      )
                    })}
                </div>
              )}
            </div>
          )}
          <button
            type="button"
            onClick={onNewThread}
            title={t("sideChat.new")}
            className="flex h-6 w-6 items-center justify-center rounded-md text-codezal-dim hover:bg-codezal-panel-2 hover:text-codezal-text"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={onClose}
            title={t("sideChat.close")}
            className="flex h-6 w-6 items-center justify-center rounded-md text-codezal-dim hover:bg-codezal-panel-2 hover:text-codezal-text"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {active && (
        <div className="shrink-0 border-b border-codezal-hair/60 px-2.5 py-1 text-center text-sm text-codezal-mute">
          {t("sideChat.contextFrom", { time: new Date(active.createdAt).toLocaleString() })}
        </div>
      )}

      <div ref={bodyRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-3">
        {messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 px-4 text-center text-codezal-mute">
            <MessageSquare className="h-5 w-5 opacity-50" />
            <p className="text-sm leading-relaxed">{t("sideChat.empty")}</p>
          </div>
        ) : (
          messages.map((m, i) =>
            m.role === "user" ? (
              <div key={`${active?.id}-${i}`} className="flex justify-end">
                <div className="max-w-[85%] whitespace-pre-wrap break-words rounded-lg bg-codezal-accent/15 px-2.5 py-1.5 text-sm text-codezal-text">
                  {m.content}
                </div>
              </div>
            ) : (
              <div key={`${active?.id}-${i}`} className="space-y-1">
                {m.reasoning && (
                  <details className="rounded-md bg-codezal-panel-2/60 px-2 py-1 text-codezal-mute">
                    <summary className="flex cursor-pointer items-center gap-1 text-sm">
                      <Brain className="h-3 w-3" />
                      {t("sideChat.reasoning")}
                    </summary>
                    <div className="mt-1 whitespace-pre-wrap break-words text-sm leading-relaxed">
                      {m.reasoning}
                    </div>
                  </details>
                )}
                {m.content ? (
                  <Markdown content={m.content} streaming={m.pending} className="text-sm leading-relaxed" />
                ) : m.pending && !m.reasoning ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-codezal-mute" />
                ) : null}
              </div>
            ),
          )
        )}
      </div>

      <div className="shrink-0 border-t border-codezal-hair p-2">
        <div className="flex items-end gap-1.5 rounded-lg border border-codezal-hair bg-codezal-bg px-2 py-1.5 focus-within:border-codezal-accent/60">
          <textarea
            ref={inputRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault()
                submit()
              }
            }}
            rows={1}
            placeholder={t("sideChat.placeholder")}
            className="max-h-28 min-h-[20px] flex-1 resize-none bg-transparent text-sm text-codezal-text placeholder:text-codezal-mute focus:outline-none"
          />
          {busy ? (
            <button
              type="button"
              onClick={onStop}
              title={t("sideChat.stop")}
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-codezal-mute hover:bg-codezal-panel-2 hover:text-red-400"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          ) : (
            <button
              type="button"
              onClick={submit}
              disabled={!text.trim()}
              title={t("sideChat.send")}
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-codezal-accent disabled:opacity-40 hover:bg-codezal-panel-2"
            >
              <Send className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
