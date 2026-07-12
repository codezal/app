import { createElement, memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import { createPortal } from "react-dom"
import hljs from "highlight.js"
import "@/styles/highlight.css"
import {
  Activity,
  AlertTriangle,
  ArrowDown,
  Bot,
  Check,
  ChevronRight,
  Columns2,
  Copy,
  Download,
  ExternalLink,
  Eye,
  File as FileIcon,
  FileText,
  Folder,
  GitBranch,
  Globe,
  ImageIcon,
  ListChecks,
  MessageSquarePlus,
  Network,
  Pencil,
  Quote,
  RefreshCcw,
  Search,
  Sparkles,
  Terminal,
  Undo2,
  Wrench,
  X,
} from "@/lib/icons"
import { openUrl } from "@tauri-apps/plugin-opener"
import { Markdown } from "./Markdown"
import { EditorContextMenu, type CtxMenuItem } from "./EditorContextMenu"
import { CodeView } from "./CodeView"
import { StoredImage } from "./StoredImage"
import { ImageLightbox } from "./ImageLightbox"
import { TodoList } from "./TodoList"
import type { Message, MessageImage, MessageFile, MessagePdf, Part } from "@/store/types"
import { useSessionsStore } from "@/store/sessions"
import { useQuestionsStore } from "@/store/questions"
import { useBrowserShots } from "@/store/browser-shots"
import { useGeneratedImages } from "@/store/generated-images"
import { useWriteDiffs } from "@/store/write-diffs"
import { annotateIntraline, hunksForEdit, type DiffLine } from "@/lib/diff"
import { parsePatchForUI } from "@/lib/tools/patch"
import { aggregateTurnEdits, type TurnEdits, type TurnEditFile } from "@/lib/turn-edits"
import { insertToFocusedComposer } from "@/lib/composer-drop"
import { getScrollPosition, setScrollPosition } from "@/lib/scroll-memory"
import { extractTimestamp } from "@/lib/id"
import { basename } from "@/lib/workspace"
import { cn } from "@/lib/utils"
import { useT } from "@/lib/i18n/useT"
import { t as tStatic } from "@/lib/i18n"
import type { MessageKey } from "@/lib/i18n/types-messages"

const EMPTY_MESSAGES: Message[] = []

const RENDER_WINDOW = 200
const RENDER_STEP = 200
const BOTTOM_THRESHOLD_PX = 40

function isNearBottom(el: HTMLElement) {
  return el.scrollHeight - el.clientHeight - el.scrollTop < BOTTOM_THRESHOLD_PX
}

type Props = {
  streaming?: boolean
  searchOpen?: boolean
  onCloseSearch?: () => void
  emptyHint?: string
  sessionId?: string
  onRegenerate?: (userMsgId: string) => void
  onEditUser?: (userMsgId: string, newText: string) => void
  onBranch?: (messageId: string) => void
  onRevert?: (messageId: string) => void
  onReview?: (messageId: string, path?: string) => void
  onOpenAgentPanel?: () => void
  // Send selected text as a side-chat question.
  onAskSideChat?: (question: string) => void
  // Send selected text to a full split chat with normal tool access.
  onAskSplitChat?: (question: string) => void
  onContinue?: () => void
  inCard?: boolean
  onScrolledChange?: (scrolled: boolean) => void
}

export function MessageList({
  streaming,
  onScrolledChange,
  searchOpen,
  onCloseSearch,
  sessionId,
  onRegenerate,
  onEditUser,
  onBranch,
  onRevert,
  onReview,
  onOpenAgentPanel,
  onAskSideChat,
  onAskSplitChat,
  onContinue,
  inCard = false,
}: Props) {
  const t = useT()
  const active = useSessionsStore((s) => (sessionId ? s.sessions[sessionId] ?? null : s.active))
  const loading = useSessionsStore((s) => {
    const id = sessionId ?? s.activeId
    return s.loadingMsgId != null && s.loadingMsgId === id
  })
  const allMessages = useSessionsStore((s) =>
    (sessionId ? s.sessions[sessionId]?.messages : s.active?.messages) ?? EMPTY_MESSAGES,
  )
  const messages = useMemo(
    () => (allMessages.some((m) => m.meta) ? allMessages.filter((m) => !m.meta) : allMessages),
    [allMessages],
  )
  const hasOlder = useSessionsStore((s) => {
    const id = sessionId ?? s.activeId
    return id ? !!s.msgWindow[id]?.hasOlder : false
  })
  const loadOlderMessages = useSessionsStore((s) => s.loadOlderMessages)
  const [loadingOlder, setLoadingOlder] = useState(false)
  const [showJumpToBottom, setShowJumpToBottom] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const [searchQuery, setSearchQuery] = useState("")
  const [matchIdx, setMatchIdx] = useState(0)
  const matchIds = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    if (!q) return [] as string[]
    return messages.filter((m) => (m.content ?? "").toLowerCase().includes(q)).map((m) => m.id)
  }, [searchQuery, messages])
  const gotoNext = () =>
    setMatchIdx((i) => (matchIds.length ? (i + 1) % matchIds.length : 0))
  const gotoPrev = () =>
    setMatchIdx((i) => (matchIds.length ? (i - 1 + matchIds.length) % matchIds.length : 0))
  useEffect(() => {
    if (!searchOpen || matchIds.length === 0) return
    const id = matchIds[Math.min(matchIdx, matchIds.length - 1)]
    const el = scrollRef.current?.querySelector<HTMLElement>(`[data-msg-id="${id}"]`)
    if (!el) return
    el.scrollIntoView({ block: "center", behavior: "smooth" })
    el.classList.add("cz-msg-hit")
    const tmo = window.setTimeout(() => el.classList.remove("cz-msg-hit"), 1400)
    return () => window.clearTimeout(tmo)
  }, [searchOpen, matchIds, matchIdx])
  const [askSel, setAskSel] = useState<{ x: number; y: number; text: string } | null>(null)
  const [selMenu, setSelMenu] = useState<{ x: number; y: number; text: string } | null>(null)
  const onContentMouseUp = () => {
    const sel = window.getSelection()
    const txt = sel?.toString().trim() ?? ""
    if (txt.length >= 2 && sel && sel.rangeCount > 0) {
      const r = sel.getRangeAt(0).getBoundingClientRect()
      if (r.width || r.height) {
        setAskSel({ x: r.left + r.width / 2, y: r.top - 6, text: txt })
        return
      }
    }
    setAskSel(null)
  }
  const onContentContextMenu = (e: React.MouseEvent) => {
    const txt = window.getSelection()?.toString().trim() ?? ""
    if (txt.length >= 1) {
      e.preventDefault()
      setAskSel(null)
      setSelMenu({ x: e.clientX, y: e.clientY, text: txt })
    }
  }
  const askAboutSelection = () => {
    if (!askSel) return
    insertToFocusedComposer(`${quoteSelection(askSel.text)}\n`)
    setAskSel(null)
    window.getSelection()?.removeAllRanges()
  }
  const askSideChatAboutText = (text: string) => {
    if (!onAskSideChat) return
    onAskSideChat(`${quoteSelection(text)}\n\n${t("sideChat.askSelectionQuestion")}`)
    setAskSel(null)
    setSelMenu(null)
    window.getSelection()?.removeAllRanges()
  }
  const askSplitChatAboutText = (text: string) => {
    if (!onAskSplitChat) return
    onAskSplitChat(`${quoteSelection(text)}\n\n${t("sideChat.askSelectionInSplitQuestion")}`)
    setAskSel(null)
    setSelMenu(null)
    window.getSelection()?.removeAllRanges()
  }
  const qPanelH = useQuestionsStore((s) => s.panelHeight)
  const autoFollowRef = useRef(true)
  const streamingRef = useRef(!!streaming)
  useEffect(() => {
    streamingRef.current = !!streaming
  })
  const rafRef = useRef<number | null>(null)
  const animatingRef = useRef(false)
  const [hoveredId, setHoveredId] = useState<string | null>(null)
  const [renderLimit, setRenderLimit] = useState(RENDER_WINDOW)
  const anchorRef = useRef<{ top: number; height: number } | null>(null)

  const [windowSessionId, setWindowSessionId] = useState(active?.id)
  if (windowSessionId !== active?.id) {
    setWindowSessionId(active?.id)
    setRenderLimit(RENDER_WINDOW)
  }

  useLayoutEffect(() => {
    const a = anchorRef.current
    const sc = scrollRef.current
    if (a && sc) {
      sc.scrollTop = a.top + (sc.scrollHeight - a.height)
      anchorRef.current = null
    }
  })

  const hasMessages = messages.length > 0

  useLayoutEffect(() => {
    const sc = scrollRef.current
    if (sc && autoFollowRef.current) sc.scrollTop = sc.scrollHeight
  }, [qPanelH])

  useEffect(() => {
    if (!hasMessages) return
    const scroll = scrollRef.current
    const content = contentRef.current
    if (!scroll || !content) return

    const savedTop = active?.id ? getScrollPosition(active.id) : undefined
    if (savedTop != null && savedTop > 0) {
      scroll.scrollTop = savedTop
      const atBottom = isNearBottom(scroll)
      autoFollowRef.current = atBottom
      setShowJumpToBottom(!atBottom)
    } else {
      scroll.scrollTop = scroll.scrollHeight
      autoFollowRef.current = true
      setShowJumpToBottom(false)
    }

    const tick = () => {
      rafRef.current = null
      if (!autoFollowRef.current) {
        animatingRef.current = false
        return
      }
      const target = scroll.scrollHeight - scroll.clientHeight
      const cur = scroll.scrollTop
      const dist = target - cur
      if (dist <= 1) {
        scroll.scrollTop = target
        animatingRef.current = false
        return
      }
      scroll.scrollTop = cur + dist * 0.18
      rafRef.current = requestAnimationFrame(tick)
    }

    const startAnimation = () => {
      if (animatingRef.current) return
      animatingRef.current = true
      rafRef.current = requestAnimationFrame(tick)
    }
    const stopAnimation = () => {
      animatingRef.current = false
      if (rafRef.current != null) {
        cancelAnimationFrame(rafRef.current)
        rafRef.current = null
      }
    }

    const ro = new ResizeObserver(() => {
      if (autoFollowRef.current && streamingRef.current) startAnimation()
    })
    ro.observe(content)

    const onUserScroll = (deltaY: number) => {
      if (deltaY < 0) {
        autoFollowRef.current = false
        if (scroll.scrollTop > 0) setShowJumpToBottom(true)
        stopAnimation()
      }
    }
    const onWheel = (e: WheelEvent) => onUserScroll(e.deltaY)
    let touchY = 0
    const onTouchStart = (e: TouchEvent) => {
      touchY = e.touches[0]?.clientY ?? 0
    }
    const onTouchMove = (e: TouchEvent) => {
      const y = e.touches[0]?.clientY ?? 0
      onUserScroll(touchY - y)
      touchY = y
    }
    const onKey = (e: KeyboardEvent) => {
      if (["ArrowUp", "PageUp", "Home"].includes(e.key)) onUserScroll(-1)
    }
    scroll.addEventListener("wheel", onWheel, { passive: true })
    scroll.addEventListener("touchstart", onTouchStart, { passive: true })
    scroll.addEventListener("touchmove", onTouchMove, { passive: true })
    scroll.addEventListener("keydown", onKey)

    let scrollTimer: number | null = null
    const onScroll = () => {
      if (active?.id) setScrollPosition(active.id, scroll.scrollTop)
      if (scrollTimer != null) window.clearTimeout(scrollTimer)
      scrollTimer = window.setTimeout(() => {
        const atBottom = isNearBottom(scroll)
        setShowJumpToBottom(!atBottom)
        if (atBottom && !autoFollowRef.current) {
          autoFollowRef.current = true
          startAnimation()
        }
      }, 80)
    }
    scroll.addEventListener("scroll", onScroll, { passive: true })

    return () => {
      ro.disconnect()
      scroll.removeEventListener("wheel", onWheel)
      scroll.removeEventListener("touchstart", onTouchStart)
      scroll.removeEventListener("touchmove", onTouchMove)
      scroll.removeEventListener("keydown", onKey)
      scroll.removeEventListener("scroll", onScroll)
      if (scrollTimer != null) window.clearTimeout(scrollTimer)
      stopAnimation()
    }
  }, [hasMessages, active?.id])

  if (messages.length === 0) return loading ? <ChatSkeleton /> : <Welcome />

  const hiddenCount = Math.max(0, messages.length - renderLimit)
  const shown = hiddenCount > 0 ? messages.slice(hiddenCount) : messages
  const loadEarlier = () => {
    if (hiddenCount > 0) {
      const sc = scrollRef.current
      if (sc) anchorRef.current = { top: sc.scrollTop, height: sc.scrollHeight }
      setRenderLimit((l) => l + RENDER_STEP)
      return
    }
    if (hasOlder && !loadingOlder) {
      const id = sessionId ?? active?.id
      if (!id) return
      setLoadingOlder(true)
      void loadOlderMessages(id)
        .then((added) => {
          if (added > 0) {
            const el = scrollRef.current
            if (el) anchorRef.current = { top: el.scrollTop, height: el.scrollHeight }
            setRenderLimit((l) => l + added)
          }
        })
        .finally(() => setLoadingOlder(false))
    }
  }
  const jumpToBottom = () => {
    const scroll = scrollRef.current
    if (!scroll) return
    autoFollowRef.current = true
    setShowJumpToBottom(false)
    scroll.scrollTo({ top: scroll.scrollHeight, behavior: "smooth" })
  }

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      {searchOpen && (
        <ChatSearchBar
          query={searchQuery}
          count={matchIds.length}
          index={matchIdx}
          onQuery={(v) => {
            setSearchQuery(v)
            setMatchIdx(0)
          }}
          onPrev={gotoPrev}
          onNext={gotoNext}
          onClose={() => onCloseSearch?.()}
        />
      )}
      <div
        ref={scrollRef}
        className={cn(
          "relative flex-1 overflow-y-auto [overflow-anchor:none] [scrollbar-gutter:stable_both-edges]",
          inCard && "overflow-x-hidden",
        )}
        onScroll={(e) => onScrolledChange?.(e.currentTarget.scrollTop > 4)}
      style={{
        paddingBottom: qPanelH || undefined,
      }}
    >
      <div
        ref={contentRef}
        className={cn("mx-auto w-full max-w-[860px] pt-4", inCard ? "px-3" : "px-6")}
        onMouseUp={onContentMouseUp}
        onMouseDown={() => setAskSel(null)}
        onContextMenu={onContentContextMenu}
      >
        <div className="flex flex-col gap-1 py-5">
          {(hiddenCount > 0 || hasOlder) && (
            <button
              onClick={loadEarlier}
              disabled={loadingOlder}
              title={String(hiddenCount || RENDER_STEP)}
              className="mx-auto mb-2 flex items-center gap-1 rounded-full border border-codezal-hair px-3 py-1 text-sm text-codezal-mute transition-colors hover:text-codezal-text disabled:opacity-50"
            >
              <ChevronRight size={12} className="-rotate-90" />
              {loadingOlder ? "…" : hiddenCount > 0 ? Math.min(hiddenCount, RENDER_STEP) : RENDER_STEP}
            </button>
          )}
          {shown.map((m, i) => {
            const prevUserId = findPrevUserId(shown, i)
            return (
              <Bubble
                key={m.id}
                m={m}
                streaming={!!streaming && i === shown.length - 1 && m.role === "assistant"}
                active={hoveredId === m.id}
                onHover={setHoveredId}
                onRegenerate={
                  m.role === "assistant" && prevUserId && onRegenerate
                    ? () => onRegenerate(prevUserId)
                    : undefined
                }
                onEditUser={
                  m.role === "user" && onEditUser
                    ? (text) => onEditUser(m.id, text)
                    : undefined
                }
                onBranch={
                  m.role === "user" && onBranch ? () => onBranch(m.id) : undefined
                }
                onRevert={
                  onRevert && !!m.snapshotBase
                    ? () => onRevert(m.id)
                    : undefined
                }
                onReview={onReview ? (path) => onReview(m.id, path) : undefined}
                onOpenAgentPanel={onOpenAgentPanel}
                onContinue={
                  m.role === "assistant" && i === shown.length - 1 && onContinue
                    ? onContinue
                    : undefined
                }
              />
            )
          })}
        </div>
      </div>
      {askSel &&
        createPortal(
          <div
            style={{
              position: "fixed",
              left: askSel.x,
              top: askSel.y,
              transform: "translate(-50%, -100%)",
              zIndex: 90,
            }}
            className="flex overflow-hidden rounded-full border border-codezal bg-codezal-panel text-sm text-codezal-text shadow-xl"
          >
            <button
              type="button"
              onMouseDown={(e) => {
                e.preventDefault()
                askAboutSelection()
              }}
              className="flex items-center gap-1.5 px-3 py-1.5 transition hover:bg-codezal-chip"
            >
              <Quote className="h-3.5 w-3.5 text-codezal-accent" aria-hidden />
              {t("messageList.askSelection")}
            </button>
            {onAskSideChat && (
              <button
                type="button"
                aria-label={t("sideChat.askSelectionAction")}
                title={t("sideChat.askSelectionAction")}
                onMouseDown={(e) => {
                  e.preventDefault()
                  askSideChatAboutText(askSel.text)
                }}
                className="flex items-center justify-center border-l border-codezal-hair px-2.5 py-1.5 text-codezal-dim transition hover:bg-codezal-chip hover:text-codezal-accent"
              >
                <MessageSquarePlus className="h-3.5 w-3.5" aria-hidden />
              </button>
            )}
            {onAskSplitChat && (
              <button
                type="button"
                aria-label={t("sideChat.askSelectionInSplitAction")}
                title={t("sideChat.askSelectionInSplitAction")}
                onMouseDown={(e) => {
                  e.preventDefault()
                  askSplitChatAboutText(askSel.text)
                }}
                className="flex items-center justify-center border-l border-codezal-hair px-2.5 py-1.5 text-codezal-dim transition hover:bg-codezal-chip hover:text-codezal-accent"
              >
                <Columns2 className="h-3.5 w-3.5" aria-hidden />
              </button>
            )}
          </div>,
          document.body,
        )}
      {selMenu && (
        <EditorContextMenu
          x={selMenu.x}
          y={selMenu.y}
          onClose={() => setSelMenu(null)}
          items={
            [
              {
                kind: "item" as const,
                label: t("common.copy"),
                icon: <Copy className="h-3.5 w-3.5" />,
                onClick: () => {
                  void navigator.clipboard.writeText(selMenu.text).catch(() => {})
                },
              },
              {
                kind: "item" as const,
                label: t("messageList.askSelection"),
                icon: <Quote className="h-3.5 w-3.5" />,
                onClick: () => {
                  insertToFocusedComposer(`${quoteSelection(selMenu.text)}\n`)
                  window.getSelection()?.removeAllRanges()
                },
              },
              ...(onAskSideChat
                ? [
                    {
                      kind: "item" as const,
                      label: t("sideChat.askSelectionAction"),
                      icon: <MessageSquarePlus className="h-3.5 w-3.5" />,
                      onClick: () => askSideChatAboutText(selMenu.text),
                    },
                  ]
                : []),
              ...(onAskSplitChat
                ? [
                    {
                      kind: "item" as const,
                      label: t("sideChat.askSelectionInSplitAction"),
                      icon: <Columns2 className="h-3.5 w-3.5" />,
                      onClick: () => askSplitChatAboutText(selMenu.text),
                    },
                  ]
                : []),
            ] satisfies CtxMenuItem[]
          }
        />
      )}
      </div>
      {showJumpToBottom && (
        <button
          type="button"
          aria-label={t("messageList.jumpToBottom")}
          title={t("messageList.jumpToBottom")}
          onClick={jumpToBottom}
          style={{ bottom: (qPanelH || 0) + 12 }}
          className="absolute left-1/2 z-20 flex h-8 w-8 -translate-x-1/2 items-center justify-center rounded-full border border-codezal-hair bg-codezal-panel/95 text-codezal-dim shadow-lg backdrop-blur transition hover:border-codezal-strong hover:bg-codezal-panel-2 hover:text-codezal-text"
        >
          <ArrowDown className="h-4 w-4" aria-hidden />
        </button>
      )}
    </div>
  )
}

function quoteSelection(text: string) {
  return text.split("\n").map((l) => `> ${l}`).join("\n")
}

function ChatSearchBar({
  query,
  count,
  index,
  onQuery,
  onPrev,
  onNext,
  onClose,
}: {
  query: string
  count: number
  index: number
  onQuery: (v: string) => void
  onPrev: () => void
  onNext: () => void
  onClose: () => void
}) {
  const t = useT()
  const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [])
  return (
    <div className="absolute right-4 top-2 z-30 flex items-center gap-1 cz-menu px-1.5 py-1">
      <input
        ref={inputRef}
        value={query}
        onChange={(e) => onQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault()
            if (e.shiftKey) onPrev()
            else onNext()
          } else if (e.key === "Escape") {
            e.preventDefault()
            onClose()
          }
        }}
        placeholder={t("chatSearch.placeholder")}
        className="w-44 bg-transparent px-1 text-sm text-codezal-text placeholder:text-codezal-mute outline-none"
      />
      <span className="min-w-[42px] shrink-0 text-center text-sm tabular-nums text-codezal-mute">
        {query ? `${count ? index + 1 : 0}/${count}` : ""}
      </span>
      <button
        type="button"
        onClick={onPrev}
        disabled={count === 0}
        title={t("chatSearch.prev")}
        className="flex h-6 w-6 items-center justify-center rounded text-codezal-dim hover:bg-codezal-panel-2 hover:text-codezal-text disabled:opacity-40"
      >
        <ChevronRight className="h-4 w-4 -rotate-90" />
      </button>
      <button
        type="button"
        onClick={onNext}
        disabled={count === 0}
        title={t("chatSearch.next")}
        className="flex h-6 w-6 items-center justify-center rounded text-codezal-dim hover:bg-codezal-panel-2 hover:text-codezal-text disabled:opacity-40"
      >
        <ChevronRight className="h-4 w-4 rotate-90" />
      </button>
      <button
        type="button"
        onClick={onClose}
        title={t("common.close")}
        className="flex h-6 w-6 items-center justify-center rounded text-codezal-dim hover:bg-codezal-panel-2 hover:text-codezal-text"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  )
}

type BubbleProps = {
  m: Message
  streaming: boolean
  active: boolean
  onHover: (id: string | null) => void
  onRegenerate?: () => void
  onEditUser?: (newText: string) => void
  onBranch?: () => void
  onRevert?: () => void
  onReview?: (path?: string) => void
  onOpenAgentPanel?: () => void
  onContinue?: () => void
}

const Bubble = memo(BubbleImpl, (prev, next) => {
  return (
    prev.m === next.m &&
    prev.streaming === next.streaming &&
    prev.active === next.active &&
    !!prev.onRegenerate === !!next.onRegenerate &&
    !!prev.onEditUser === !!next.onEditUser &&
    !!prev.onBranch === !!next.onBranch &&
    !!prev.onRevert === !!next.onRevert &&
    !!prev.onReview === !!next.onReview &&
    !!prev.onContinue === !!next.onContinue
  )
})

function BubbleImpl({
  m,
  streaming,
  active,
  onHover,
  onRegenerate,
  onEditUser,
  onBranch,
  onRevert,
  onReview,
  onOpenAgentPanel,
  onContinue,
}: BubbleProps) {
  const t = useT()
  const isUser = m.role === "user"
  const writeOld = useWriteDiffs((s) => s.byCallId)
  const turnEdits = useMemo(
    () => (isUser ? null : aggregateTurnEdits(m.parts, writeOld)),
    [isUser, m.parts, writeOld],
  )
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(m.content)
  const [copied, setCopied] = useState(false)
  const editRef = useRef<HTMLTextAreaElement>(null)
  const editEndRef = useRef<HTMLDivElement>(null)

  const keepEditVisible = () => {
    requestAnimationFrame(() => {
      editEndRef.current?.scrollIntoView({ block: "nearest" })
    })
  }

  useEffect(() => {
    if (!editing) return
    const el = editRef.current
    if (!el) return
    el.focus()
    el.setSelectionRange(el.value.length, el.value.length)
    el.style.height = "auto"
    el.style.height = Math.min(el.scrollHeight, 320) + "px"
    keepEditVisible()
  }, [editing])

  function startEdit() {
    setDraft(m.content)
    setEditing(true)
  }
  function cancelEdit() {
    setEditing(false)
    setDraft(m.content)
  }
  function saveEdit() {
    const t = draft.trim()
    if (!t) {
      setEditing(false)
      return
    }
    onEditUser?.(t)
    setEditing(false)
  }

  async function copyContent() {
    try {
      await navigator.clipboard.writeText(m.content)
      setCopied(true)
      setTimeout(() => setCopied(false), 1200)
    } catch {
      // Intentionally ignored.
    }
  }

  const showActions = !streaming && !m.pending && !editing
  const msgTime = (() => {
    try {
      return extractTimestamp(m.id)
    } catch {
      return 0
    }
  })()

  return (
    <div
      // pb-2 extends the hover zone below the action row so the cursor sitting
      // on the icons (which used to sit flush at the wrapper's bottom edge)
      // can't dip into the inter-message gap and re-trigger mouseLeave →
      // mouseEnter on micro-movements (the left-to-right "flicker").
      className="relative pb-2"
      data-msg-id={m.id}
      aria-busy={streaming ? true : undefined}
      onMouseEnter={() => onHover(m.id)}
      onMouseLeave={() => onHover(null)}
    >
      <div className={cn("min-w-0", isUser && "flex flex-col items-end")}>

        {editing ? (
          <div className={cn("rounded-md border border-codezal-strong bg-codezal-input p-2", isUser && "w-full max-w-[80%]")}>
            <textarea
              ref={editRef}
              value={draft}
              onChange={(e) => {
                setDraft(e.target.value)
                const el = e.currentTarget
                el.style.height = "auto"
                el.style.height = Math.min(el.scrollHeight, 320) + "px"
                keepEditVisible()
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault()
                  saveEdit()
                } else if (e.key === "Escape") {
                  e.preventDefault()
                  cancelEdit()
                }
              }}
              className="w-full resize-none bg-transparent text-md leading-[1.7] text-codezal-text focus:outline-none"
              rows={1}
            />
            <div className="mt-2 flex items-center justify-end gap-2 text-sm">
              <button
                type="button"
                onClick={cancelEdit}
                className="flex items-center gap-1 rounded-md border border-codezal px-2 py-1 text-codezal-dim hover:border-codezal-strong"
              >
                <X className="h-4 w-4" /> {t("messageList.cancel")}
              </button>
              <button
                type="button"
                onClick={saveEdit}
                disabled={!draft.trim()}
                className="flex items-center gap-1 rounded-md bg-accent px-2 py-1 text-sm font-medium text-accent-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
              >
                <RefreshCcw className="h-4 w-4" /> {t("messageList.saveAndRerun")}
              </button>
            </div>
            <div ref={editEndRef} className="mt-1 text-right text-sm text-codezal-mute">
              {t("messageList.saveCancelHint")}
            </div>
          </div>
        ) : m.pending && (!m.parts || m.parts.length === 0) && m.content === "" ? (
          streaming && !isUser ? null : <Dots />
        ) : m.compacting ? (
          <div className="flex items-center gap-2.5">
            <SpinnerRing />
            <span className="text-md leading-[1.7] text-codezal-dim">{m.content}</span>
            <Dots />
          </div>
        ) : isUser ? (
          <UserContent content={m.content} images={m.images} files={m.files} pdfs={m.pdfs} />
        ) : m.parts && m.parts.length > 0 ? (
          <PartsRender parts={m.parts} onOpenAgentPanel={onOpenAgentPanel} streaming={streaming} />
        ) : (
          <Markdown content={m.content} streaming={streaming} className="text-md leading-[1.7]" />
        )}

        {streaming && !isUser && (
          <div className="mt-2">
            <StreamingHint message={m} />
          </div>
        )}

        {!isUser && !streaming && !m.pending && turnEdits && turnEdits.files.length > 0 && (
          <TurnEditSummary
            edits={turnEdits}
            canRevert={!!m.snapshotBase && !!onRevert}
            onRevert={onRevert}
            onReview={onReview}
          />
        )}

        {!isUser && !streaming && !m.pending && m.stopReason && onContinue && (
          <div className="mt-1.5 flex items-center gap-2">
            <span className="flex items-center gap-1 text-sm text-codezal-mute">
              <AlertTriangle className="h-3 w-3 text-amber-500" />
              {t("messageList.incompleteHint")}
            </span>
            <button
              type="button"
              onClick={onContinue}
              className="flex items-center gap-1 rounded-full border border-codezal px-2 py-0.5 text-sm text-codezal-text transition-colors hover:border-codezal-strong"
            >
              <ChevronRight className="h-3 w-3" />
              {t("messageList.continueAction")}
            </button>
          </div>
        )}

        {!isUser && !streaming && !m.pending && m.localStats && (
          <div className="mt-1.5 flex items-center gap-2 text-xs text-codezal-mute">
            <span>⚡ {m.localStats.tokPerSec.toFixed(1)} tok/s</span>
            {m.localStats.tokens > 0 && <span>· {m.localStats.tokens.toLocaleString()} token</span>}
            {m.localStats.ttftMs > 0 && (
              <span>· ilk token {(m.localStats.ttftMs / 1000).toFixed(1)}s</span>
            )}
          </div>
        )}

        {showActions && (
          <div
            className={cn(
              "mt-1 flex items-center gap-0.5",
              isUser && "justify-end",
              active ? "opacity-100" : "opacity-0 pointer-events-none",
            )}
          >
            <ActionBtn onClick={copyContent} title={t("messageList.copy")}>
              {copied ? <Check className="h-3 w-3 text-codezal-accent" /> : <Copy className="h-3 w-3" />}
            </ActionBtn>
            {isUser && onEditUser && (
              <ActionBtn onClick={startEdit} title={t("messageList.editAndResend")}>
                <Pencil className="h-3 w-3" />
              </ActionBtn>
            )}
            {!isUser && onRegenerate && (
              <ActionBtn onClick={onRegenerate} title={t("messageList.rerunTitle")}>
                <RefreshCcw className="h-3 w-3" />
              </ActionBtn>
            )}
            {onBranch && (
              <ActionBtn onClick={onBranch} title={t("messageList.forkTitle")}>
                <GitBranch className="h-3 w-3" />
              </ActionBtn>
            )}
            {onRevert && (
              <ActionBtn
                onClick={onRevert}
                title={t("messageList.revertFilesTitle")}
              >
                <Undo2 className="h-3 w-3" />
              </ActionBtn>
            )}
            {msgTime > 0 && (
              <span
                className="ml-1 select-none text-sm text-codezal-mute"
                title={new Date(msgTime).toLocaleString()}
              >
                {new Date(msgTime).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function ActionBtn({
  children,
  onClick,
  title,
  danger,
}: {
  children: React.ReactNode
  onClick: () => void
  title: string
  danger?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={cn(
        "flex h-5 w-5 items-center justify-center rounded border border-transparent text-codezal-mute hover:border-codezal hover:text-codezal-text",
        danger && "hover:border-destructive/40 hover:text-destructive",
      )}
    >
      {children}
    </button>
  )
}

const TURN_COLLAPSE_AT = 4
function TurnEditSummary({
  edits,
  canRevert,
  onRevert,
  onReview,
}: {
  edits: TurnEdits
  canRevert: boolean
  onRevert?: () => void
  onReview?: (path?: string) => void
}) {
  const t = useT()
  const [showAll, setShowAll] = useState(false)
  const files = edits.files
  const hidden = !showAll && files.length > TURN_COLLAPSE_AT ? files.length - TURN_COLLAPSE_AT : 0
  const shown = hidden > 0 ? files.slice(0, TURN_COLLAPSE_AT) : files
  return (
    <div className="mt-3 overflow-hidden rounded-xl border border-codezal-panel bg-codezal-panel text-md shadow-sm">
      <div className="flex items-center gap-2 px-3 py-2">
        <FileText className="h-4 w-4 shrink-0 text-codezal-mute" />
        <span className="font-medium text-codezal-text">
          {t("messageList.turnEditsSummary", { count: files.length })}
        </span>
        <span className="flex shrink-0 items-center gap-1.5 font-mono text-sm">
          {edits.totalAdded > 0 && <span className="text-codezal-diff-add">+{edits.totalAdded}</span>}
          {edits.totalRemoved > 0 && <span className="text-codezal-diff-del">-{edits.totalRemoved}</span>}
        </span>
        <div className="ml-auto flex shrink-0 items-center gap-1">
          {canRevert && onRevert && (
            <button
              type="button"
              onClick={onRevert}
              className="flex items-center gap-1 rounded-md border border-codezal px-2 py-0.5 text-codezal-dim transition-colors hover:border-codezal-strong hover:text-codezal-text"
            >
              <Undo2 className="h-3 w-3" /> {t("messageList.turnRevert")}
            </button>
          )}
          {onReview && (
            <button
              type="button"
              onClick={() => onReview()}
              className="flex items-center gap-1 rounded-md border border-codezal px-2 py-0.5 text-codezal-dim transition-colors hover:border-codezal-strong hover:text-codezal-text"
            >
              <Eye className="h-3 w-3" /> {t("messageList.turnReview")}
            </button>
          )}
        </div>
      </div>
      <div>
        {shown.map((f) => (
          <TurnEditRow key={f.path} file={f} onReview={onReview} />
        ))}
        {hidden > 0 && (
          <button
            type="button"
            onClick={() => setShowAll(true)}
            className="flex w-full items-center gap-1 px-3 py-1.5 text-left text-md text-codezal-mute transition-colors hover:text-codezal-text"
          >
            <ChevronRight className="h-3 w-3 rotate-90" />
            {t("messageList.turnShowMore", { count: hidden })}
          </button>
        )}
      </div>
    </div>
  )
}

function TurnEditRow({ file, onReview }: { file: TurnEditFile; onReview?: (path: string) => void }) {
  return (
    <button
      type="button"
      onClick={onReview ? () => onReview(file.path) : undefined}
      disabled={!onReview}
      className="flex w-full items-center gap-2 px-3 py-1.5 text-left transition-colors hover:bg-codezal-chip disabled:cursor-default disabled:hover:bg-transparent"
    >
      <span className="min-w-0 flex-1 truncate font-mono text-sm text-codezal-text" title={file.path}>
        {file.path}
      </span>
      <span className="flex shrink-0 items-center gap-1.5 font-mono text-sm">
        {file.added > 0 && <span className="text-codezal-diff-add">+{file.added}</span>}
        {file.removed > 0 && <span className="text-codezal-diff-del">-{file.removed}</span>}
      </span>
    </button>
  )
}

function UserContent({
  content,
  images,
  files,
  pdfs,
}: {
  content: string
  images?: MessageImage[]
  files?: MessageFile[]
  pdfs?: MessagePdf[]
}) {
  const t = useT()
  const [lightbox, setLightbox] = useState<number | null>(null)
  const COLLAPSE_THRESHOLD = 10
  const COLLAPSED_LINES = 10
  const [collapsed, setCollapsed] = useState(true)
  const contentLines = useMemo(() => content.trimEnd().split("\n"), [content])
  const collapsible = contentLines.length > COLLAPSE_THRESHOLD
  const displayContent = collapsed && collapsible ? contentLines.slice(0, COLLAPSED_LINES).join("\n") : content
  return (
    <div className="flex w-full flex-col items-end gap-1.5">
      {images && images.length > 0 && (
        <div className="flex max-w-[80%] flex-wrap justify-end gap-2">
          {images.map((im, i) => (
            <StoredImage
              key={im.id}
              image={im}
              onClick={() => setLightbox(i)}
              className="max-h-[120px] max-w-[180px] w-auto cursor-pointer rounded-lg border border-codezal-hair object-cover transition hover:opacity-90"
            />
          ))}
        </div>
      )}
      {lightbox !== null && images && (
        <ImageLightbox
          images={images}
          index={lightbox}
          onIndex={setLightbox}
          onClose={() => setLightbox(null)}
        />
      )}
      {files && files.length > 0 && (
        <div className="flex max-w-[80%] flex-wrap justify-end gap-2">
          {files.map((f) => (
            <div
              key={f.id}
              className="flex items-center gap-2 rounded-lg border border-codezal-hair bg-codezal-chip px-2.5 py-1.5 text-sm text-codezal-text"
              title={f.path}
            >
              {f.isDir ? (
                <Folder className="h-4 w-4 shrink-0 text-codezal-accent" aria-hidden />
              ) : (
                <FileIcon className="h-4 w-4 shrink-0 text-codezal-mute" aria-hidden />
              )}
              <span className="max-w-[200px] truncate">{f.name}</span>
            </div>
          ))}
        </div>
      )}
      {pdfs && pdfs.length > 0 && (
        <div className="flex max-w-[80%] flex-wrap justify-end gap-2">
          {pdfs.map((p) => (
            <div
              key={p.id}
              className="flex items-center gap-2 rounded-lg border border-codezal-hair bg-codezal-chip px-2.5 py-1.5 text-sm text-codezal-text"
              title={p.name}
            >
              <FileText className="h-4 w-4 shrink-0 text-codezal-accent" aria-hidden />
              <span className="max-w-[200px] truncate">{p.name}</span>
              {p.pages ? (
                <span className="shrink-0 text-sm text-codezal-dim">
                  {t("composer.pdfPages", { n: String(p.pages) })}
                </span>
              ) : null}
            </div>
          ))}
        </div>
      )}
      {content.trim() && (
        <div className="max-w-[80%] overflow-hidden rounded-2xl rounded-br-md border border-codezal-strong bg-codezal-panel shadow-sm">
          <div className="whitespace-pre-wrap px-3.5 py-2 text-md leading-[1.7] text-codezal-text">
            {displayContent}
          </div>
          {collapsible && collapsed && (
            <button
              type="button"
              onClick={() => setCollapsed(false)}
              className="flex w-full items-center justify-center gap-1 border-t border-codezal-hair px-3 py-1 text-sm text-codezal-mute hover:bg-codezal-panel-2/40 hover:text-codezal-text"
            >
              <ChevronRight size={12} className="rotate-90" />
              {tStatic("messageList.linesMore", { count: contentLines.length - COLLAPSED_LINES })}
            </button>
          )}
        </div>
      )}
    </div>
  )
}

function findPrevUserId(messages: Message[], i: number): string | null {
  for (let k = i - 1; k >= 0; k--) {
    if (messages[k].role === "user") return messages[k].id
  }
  return null
}

const CONTEXT_TOOLS = new Set(["read_file", "grep", "glob", "list_dir"])
const FILE_EDIT_TOOLS = new Set(["edit_file", "write_file", "apply_patch"])

function toolIcon(toolName: string): typeof Wrench {
  if (toolName === "read_file") return FileText
  if (toolName === "list_dir") return Folder
  if (FILE_EDIT_TOOLS.has(toolName)) return Pencil
  if (toolName === "bash") return Terminal
  if (toolName === "grep" || toolName === "glob" || toolName === "tool_search") return Search
  if (toolName.startsWith("code_") || toolName === "lsp") return Network
  if (toolName === "todo_write" || toolName === "propose_plan" || toolName === "propose_build")
    return ListChecks
  if (toolName === "webfetch") return Download
  if (toolName === "websearch") return Globe
  if (toolName === "spawn_agent" || toolName === "dispatch_workers") return Bot
  if (toolName === "load_skill") return Sparkles
  if (toolName === "clone_repo" || toolName.includes("worktree")) return GitBranch
  if (toolName === "generate_image" || toolName === "browser_screenshot") return ImageIcon
  if (toolName === "browser_read_console") return Terminal
  if (toolName === "browser_read_network") return Activity
  if (toolName === "browser_snapshot") return Eye
  if (toolName.startsWith("browser_")) return Globe
  return Wrench
}

const CODE_TOOLS = new Set([
  "code_query",
  "code_search",
  "code_callers",
  "code_callees",
  "code_trace",
  "code_impact",
])

function isHiddenToolRow(toolName: string): boolean {
  if (toolName === "repo_overview" || toolName === "bash_status") return true
  return false
}

function contextDescribe(
  call: Extract<Part, { type: "tool-call" }>,
): { label: string; name: string } {
  const input = call.input as Record<string, unknown>
  switch (call.toolName) {
    case "grep": {
      const pat = String(input.query ?? "")
      const inc = input.glob ? `  include=${String(input.glob)}` : ""
      return { label: "Grep", name: `pattern=${pat}${inc}` }
    }
    case "glob":
      return { label: "Glob", name: `pattern=${String(input.pattern ?? "")}` }
    case "read_file":
      return { label: "Read", name: String(input.path ?? "") }
    case "list_dir":
      return { label: "List", name: String(input.path ?? "") || "." }
  }
  return { label: call.toolName, name: "" }
}

function PartsRender({
  parts,
  onOpenAgentPanel,
  streaming,
}: {
  parts: Part[]
  onOpenAgentPanel?: () => void
  streaming?: boolean
}) {
  const resultMap = new Map<string, Part & { type: "tool-result" }>()
  for (const p of parts) {
    if (p.type === "tool-result") resultMap.set(p.toolCallId, p)
  }

  type ToolCallPart = Extract<Part, { type: "tool-call" }>
  type Block =
    | { kind: "text"; key: string; text: string }
    | { kind: "tools"; key: string; calls: ToolCallPart[] }

  const blocks: Block[] = []
  parts.forEach((p, i) => {
    if (p.type === "text") {
      if (!p.text.trim()) return
      blocks.push({ kind: "text", key: `t${i}`, text: p.text })
    } else if (p.type === "tool-call") {
      if (isHiddenToolRow(p.toolName)) return
      const last = blocks[blocks.length - 1]
      const isCtx = CONTEXT_TOOLS.has(p.toolName)
      const isCode = CODE_TOOLS.has(p.toolName)
      if (last && last.kind === "tools") {
        const lastIsCtx = CONTEXT_TOOLS.has(last.calls[0].toolName)
        const lastIsCode = CODE_TOOLS.has(last.calls[0].toolName)
        if (isCtx && lastIsCtx) {
          last.calls.push(p)
          return
        }
        if (isCode && lastIsCode) {
          last.calls.push(p)
          return
        }
        if (!isCtx && !lastIsCtx && last.calls[0].toolName === p.toolName && !p.toolName.includes("__")) {
          last.calls.push(p)
          return
        }
      }
      blocks.push({ kind: "tools", key: `g${i}`, calls: [p] })
    }
  })

  const lastTextKey = [...blocks].reverse().find((b) => b.kind === "text")?.key

  return (
    <div className="space-y-1">
      {blocks.map((b) => {
        if (b.kind === "text") {
          return (
            <Markdown
              key={b.key}
              content={b.text}
              streaming={streaming && b.key === lastTextKey}
              className="text-md leading-[1.7] [&>:first-child]:mt-0 [&>:last-child]:mb-0"
            />
          )
        }
        const isContextBlock = CONTEXT_TOOLS.has(b.calls[0].toolName)
        if (b.calls.length === 1 && !isContextBlock) {
          const c = b.calls[0]
          return (
            <ToolRow
              key={c.toolCallId}
              call={c}
              result={resultMap.get(c.toolCallId)}
              onOpenAgentPanel={onOpenAgentPanel}
              streaming={streaming}
            />
          )
        }
        return (
          <ToolGroup
            key={b.key}
            calls={b.calls}
            resultMap={resultMap}
            onOpenAgentPanel={onOpenAgentPanel}
            streaming={streaming}
          />
        )
      })}
    </div>
  )
}

function ToolGroup({
  calls,
  resultMap,
  onOpenAgentPanel,
  streaming,
}: {
  calls: Extract<Part, { type: "tool-call" }>[]
  resultMap: Map<string, Extract<Part, { type: "tool-result" }>>
  onOpenAgentPanel?: () => void
  streaming?: boolean
}) {
  const t = useT()
  const errorCount = calls.reduce((n, c) => {
    const r = resultMap.get(c.toolCallId)
    return n + (r?.isError ? 1 : 0)
  }, 0)
  const [open, setOpen] = useState(false)

  const isContext = CONTEXT_TOOLS.has(calls[0].toolName)
  const isCode = CODE_TOOLS.has(calls[0].toolName)
  const runningAny = calls.some((c) => !resultMap.get(c.toolCallId))

  let typeSummary: string
  if (isCode) {
    typeSummary = summarizeTool(calls[0].toolName, calls.length, runningAny, t)
  } else {
    const counts = new Map<string, { n: number; running: number }>()
    for (const c of calls) {
      const e = counts.get(c.toolName) ?? { n: 0, running: 0 }
      e.n++
      if (!resultMap.get(c.toolCallId)) e.running++
      counts.set(c.toolName, e)
    }
    typeSummary = Array.from(counts.entries())
      .map(([name, { n, running }]) => summarizeTool(name, n, running > 0, t))
      .join(", ")
  }

  let ctxHead = ""
  let ctxCounts = ""
  if (isContext) {
    let reads = 0
    let searches = 0
    let lists = 0
    for (const c of calls) {
      if (c.toolName === "read_file") reads++
      else if (c.toolName === "grep" || c.toolName === "glob") searches++
      else if (c.toolName === "list_dir") lists++
    }
    const segs: string[] = []
    if (reads > 0) segs.push(t("messageList.ctxRead", { count: reads }))
    if (searches > 0) segs.push(t("messageList.ctxSearch", { count: searches }))
    if (lists > 0) segs.push(t("messageList.ctxList", { count: lists }))
    ctxHead = t(runningAny ? "messageList.gatheringContext" : "messageList.gatheredContext")
    ctxCounts = segs.join(", ")
  }

  return (
    <div className="my-1 border-l-2 border-codezal-hair pl-2 text-md">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="group flex w-full items-center gap-2 rounded-r-lg px-2 py-1 text-left hover:bg-codezal-chip/40"
      >
        {isContext ? (
          <span className="flex min-w-0 items-baseline gap-1.5 truncate">
            <span className="shrink-0 text-codezal-dim">{ctxHead}</span>
            <span className="min-w-0 truncate text-codezal-mute">{ctxCounts}</span>
          </span>
        ) : (
          <span className="min-w-0 truncate text-codezal-dim">{typeSummary}</span>
        )}
        <ChevronRight
          className={cn(
            "h-3 w-3 shrink-0 text-codezal-mute opacity-0 transition-all group-hover:opacity-100",
            open && "rotate-90",
          )}
        />
        {errorCount > 0 && (
          <span className="shrink-0 rounded bg-destructive/10 px-1.5 py-0.5 text-sm text-destructive">
            {t("messageList.toolError", { count: errorCount })}
          </span>
        )}
      </button>
      {open && (
        <div className="mt-1 rounded-xl bg-codezal-panel-2 px-2.5 py-1.5">
          {calls.map((c) => (
            <ToolRow
              key={c.toolCallId}
              call={c}
              result={resultMap.get(c.toolCallId)}
              onOpenAgentPanel={onOpenAgentPanel}
              grouped={isContext}
              streaming={streaming}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function CountUp({ value, animate }: { value: number; animate: boolean }) {
  const reduce =
    typeof window !== "undefined" &&
    !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
  const [display, setDisplay] = useState(() => (animate && !reduce ? 0 : value))
  const curRef = useRef(animate && !reduce ? 0 : value)
  useEffect(() => {
    const from = curRef.current
    if (from === value) return
    const DUR = reduce ? 0 : 450
    let raf = 0
    let t0 = 0
    const step = (ts: number) => {
      if (!t0) t0 = ts
      const p = DUR === 0 ? 1 : Math.min(1, (ts - t0) / DUR)
      const eased = 1 - Math.pow(1 - p, 3)
      const cur = Math.round(from + (value - from) * eased)
      curRef.current = cur
      setDisplay(cur)
      if (p < 1) raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => {
      if (raf) cancelAnimationFrame(raf)
    }
  }, [value, reduce])
  return <>{display}</>
}

function ToolRow({
  call,
  result,
  onOpenAgentPanel,
  grouped,
  streaming,
}: {
  call: Extract<Part, { type: "tool-call" }>
  result?: Extract<Part, { type: "tool-result" }>
  onOpenAgentPanel?: () => void
  grouped?: boolean
  streaming?: boolean
}) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const status = result ? (result.isError ? "error" : "done") : "running"
  const writeOld = useWriteDiffs((s) => s.byCallId[call.toolCallId])
  const writeContent = String((call.input as Record<string, unknown> | undefined)?.content ?? "")
  const writeHunks = useMemo(
    () =>
      call.toolName === "write_file" && writeOld != null && writeOld !== writeContent
        ? hunksForEdit(writeOld, writeContent)
        : null,
    [call.toolName, writeOld, writeContent],
  )
  if (call.toolName === "workflow_status") return null
  const { label, name, added, removed } = describeCall(call, !result, t, writeHunks)
  if (call.toolName === "dispatch_workers") {
    const txt =
      status === "running"
        ? t("agentCard.runningWorker", { name })
        : status === "error"
          ? t("agentCard.workerFailed", { name })
          : t("agentCard.workerDone", { name })
    return <div className="py-0.5 text-md text-codezal-dim">{txt}</div>
  }
  let displayLabel = label
  let displayName = name
  const isWebUrl =
    (call.toolName === "webfetch" || call.toolName === "clone_repo") &&
    /^https?:\/\//.test(displayName)
  const noExpand = isWebUrl || call.toolName === "load_skill"
  const ctxGrouped = !!grouped && CONTEXT_TOOLS.has(call.toolName)
  if (ctxGrouped) {
    const cd = contextDescribe(call)
    displayLabel = cd.label
    displayName = cd.name
  }
  if (call.toolName === "write_file" && result && !result.isError) {
    displayLabel = result.output.includes("güncellendi")
      ? t("messageList.fileChanged")
      : t("messageList.fileCreated")
  }
  if (call.toolName === "question" && result) {
    const qs = (call.input as Record<string, unknown>)?.questions
    const n = Array.isArray(qs) ? qs.length : 1
    displayName = t("messageList.questionAnswered", { count: n })
  }
  // spawn_agent: the full live card lives in the right panel (ContextPanel
  // "agents"). Clicking the row opens that panel instead of an inline body.
  const isAgent = call.toolName === "spawn_agent"
  const isWorkflow = call.toolName === "run_workflow" || call.toolName === "workflow_status"

  const labelColor =
    status === "error"
      ? "text-destructive"
      : FILE_EDIT_TOOLS.has(call.toolName)
        ? "text-codezal-cmd"
        : "text-codezal-mute"

  // Collapsed = quiet row (chip hover); open = detail indented below — no box,
  // border or panel, so expanding never snaps into a table.
  return (
    <div className={cn("text-md", !grouped && "my-1 border-l-2 border-codezal-hair pl-2")}>
      <button
        type="button"
        onClick={() => {
          if (isAgent) onOpenAgentPanel?.()
          else if (isWorkflow) window.dispatchEvent(new CustomEvent("codezal:open-workflows"))
          else if (!noExpand) setOpen((v) => !v)
        }}
        className="group flex w-full items-center gap-2 rounded-r-lg px-2 py-1.5 text-left hover:bg-codezal-chip/40"
      >
        {createElement(toolIcon(call.toolName), { className: cn("h-3.5 w-3.5 shrink-0", labelColor) })}
        <span className={cn("shrink-0", labelColor)}>{displayLabel}</span>
        {ctxGrouped && displayName && <span className="shrink-0 text-codezal-mute">/</span>}
        <span className="min-w-0 truncate text-codezal-text">{displayName}</span>
        {isWebUrl && (
          <span
            role="button"
            tabIndex={0}
            onClick={(e) => {
              e.stopPropagation()
              void openUrl(displayName).catch(() => {})
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault()
                e.stopPropagation()
                void openUrl(displayName).catch(() => {})
              }
            }}
            title={t("messageList.openInBrowser") as string}
            aria-label={t("messageList.openInBrowser") as string}
            className="shrink-0 text-codezal-mute transition hover:text-codezal-accent"
          >
            <ExternalLink className="h-3 w-3" aria-hidden />
          </span>
        )}
        {added != null && (
          <span className="shrink-0 font-mono text-codezal-diff-add">
            +<CountUp value={added} animate={!!streaming} />
          </span>
        )}
        {removed != null && removed > 0 && (
          <span className="shrink-0 font-mono text-codezal-diff-del">
            -<CountUp value={removed} animate={!!streaming} />
          </span>
        )}
        {!noExpand && (
          <ChevronRight
            className={cn(
              "h-3 w-3 shrink-0 text-codezal-mute transition-transform",
              !isAgent && !isWorkflow && open && "rotate-90",
              status === "error" && "text-destructive",
            )}
          />
        )}
      </button>
      {!isAgent && !isWorkflow && !noExpand && open && (
        <div className="mt-1 space-y-2.5">
          <ToolBody call={call} result={result} writeHunks={writeHunks} />
        </div>
      )}
    </div>
  )
}

function stripCR(s: string): string {
  return s.replace(/\r\n/g, "\n").replace(/\r/g, "")
}

function BashBody({
  cmd,
  output: rawOutput,
  hasResult,
  isError,
}: {
  cmd: string
  output: string
  hasResult: boolean
  isError: boolean
}) {
  const t = useT()
  const [copied, setCopied] = useState(false)
  const [collapsed, setCollapsed] = useState(true)
  const COLLAPSE_THRESHOLD = 15
  const COLLAPSED_LINES = 8
  const output = useMemo(() => stripCR(rawOutput), [rawOutput])
  const cmdHtml = useMemo(() => {
    try {
      return hljs.highlight(cmd, { language: "bash" }).value
    } catch {
      return cmd.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    }
  }, [cmd])
  const outputLines = useMemo(() => output.trimEnd().split("\n"), [output])
  const collapsible = hasResult && outputLines.length > COLLAPSE_THRESHOLD
  const displayOutput = collapsed && collapsible ? outputLines.slice(0, COLLAPSED_LINES).join("\n") : output
  async function onCopy() {
    try {
      await navigator.clipboard.writeText(hasResult ? `$ ${cmd}\n\n${output}` : `$ ${cmd}`)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // Intentionally ignored.
    }
  }
  return (
    <div
      className={cn(
        "group/out overflow-hidden rounded-xl bg-codezal-chip",
        isError && "ring-1 ring-destructive/25",
      )}
    >
      <div className="flex items-center justify-between px-4 pt-3 pb-1">
        <span className="font-mono text-sm font-semibold uppercase tracking-[0.1em] text-codezal-dim">
          BASH
        </span>
        <button
          type="button"
          onClick={onCopy}
          title={t("messageList.copyBlockTitle")}
          className="inline-flex shrink-0 items-center gap-1 rounded px-1 py-0.5 text-sm text-codezal-mute opacity-0 transition hover:text-codezal-text group-hover/out:opacity-100 focus-visible:opacity-100"
        >
          {copied ? (
            <>
              <Check className="h-3.5 w-3.5" /> {t("messageList.copiedLabel")}
            </>
          ) : (
            <>
              <Copy className="h-3.5 w-3.5" /> {t("messageList.copyLabel")}
            </>
          )}
        </button>
      </div>
      <pre className="m-0 whitespace-pre-wrap px-4 pb-2 font-mono text-sm leading-[1.65] text-codezal-text">
        <span className="select-none text-codezal-mute">$ </span>
        <code className="hljs !bg-transparent !p-0" dangerouslySetInnerHTML={{ __html: cmdHtml }} />
      </pre>
      {hasResult && (
        <pre
          className={cn(
            "m-0 max-h-[240px] overflow-y-auto whitespace-pre-wrap px-4 pb-3 font-mono text-sm leading-[1.65]",
            isError ? "text-destructive" : "text-codezal-text",
          )}
        >
          {displayOutput}
        </pre>
      )}
      {collapsible && collapsed && (
        <button
          type="button"
          onClick={() => setCollapsed(false)}
          className="flex w-full items-center justify-center gap-1 border-t border-codezal-hair px-3 py-1 text-sm text-codezal-mute hover:bg-codezal-panel-2/40 hover:text-codezal-text"
        >
          <ChevronRight size={12} className="rotate-90" />
          {tStatic("messageList.linesMore", { count: outputLines.length - COLLAPSED_LINES })}
        </button>
      )}
    </div>
  )
}

// (lsp, webfetch). SearchBody CSS'i uppercase uygular → "CONTEXT7", "LSP", "CODE QUERY".
function genericBoxLabel(toolName: string): string {
  if (toolName.includes("__")) return toolName.slice(0, toolName.indexOf("__"))
  if (toolName.startsWith("browser_")) {
    const v = TOOL_VERB_KEYS[toolName]
    if (v) return tStatic(v.pastKey as MessageKey)
  }
  return toolName.replace(/_/g, " ")
}

function SearchBody({
  label,
  output: rawOutput,
  isError,
}: {
  label: string
  output: string
  isError: boolean
}) {
  const t = useT()
  const [copied, setCopied] = useState(false)
  const [collapsed, setCollapsed] = useState(true)
  const COLLAPSE_THRESHOLD = 15
  const COLLAPSED_LINES = 8
  const output = useMemo(() => stripCR(rawOutput), [rawOutput])
  const outputLines = useMemo(() => output.trimEnd().split("\n"), [output])
  const collapsible = outputLines.length > COLLAPSE_THRESHOLD
  const displayOutput = collapsed && collapsible ? outputLines.slice(0, COLLAPSED_LINES).join("\n") : output
  async function onCopy() {
    try {
      await navigator.clipboard.writeText(output)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // Intentionally ignored.
    }
  }
  return (
    <div
      className={cn(
        "group/out overflow-hidden rounded-xl bg-codezal-chip",
        isError && "ring-1 ring-destructive/25",
      )}
    >
      <div className="flex items-center gap-2.5 px-4 pt-3 pb-1.5">
        <span className="shrink-0 font-mono text-sm font-semibold uppercase tracking-[0.1em] text-codezal-dim">
          {label}
        </span>
        <span className="min-w-0 flex-1" />
        <button
          type="button"
          onClick={onCopy}
          title={t("messageList.copyBlockTitle")}
          className="inline-flex shrink-0 items-center gap-1 rounded px-1 py-0.5 text-sm text-codezal-mute opacity-0 transition hover:text-codezal-text group-hover/out:opacity-100 focus-visible:opacity-100"
        >
          {copied ? (
            <>
              <Check className="h-3.5 w-3.5" /> {t("messageList.copiedLabel")}
            </>
          ) : (
            <>
              <Copy className="h-3.5 w-3.5" /> {t("messageList.copyLabel")}
            </>
          )}
        </button>
      </div>
      <pre
        className={cn(
          "m-0 max-h-[240px] overflow-y-auto whitespace-pre-wrap px-4 pb-3 font-mono text-sm leading-[1.65]",
          isError ? "text-destructive" : "text-codezal-text",
        )}
      >
        {displayOutput}
      </pre>
      {collapsible && collapsed && (
        <button
          type="button"
          onClick={() => setCollapsed(false)}
          className="flex w-full items-center justify-center gap-1 border-t border-codezal-hair px-3 py-1 text-sm text-codezal-mute hover:bg-codezal-panel-2/40 hover:text-codezal-text"
        >
          <ChevronRight size={12} className="rotate-90" />
          {tStatic("messageList.linesMore", { count: outputLines.length - COLLAPSED_LINES })}
        </button>
      )}
    </div>
  )
}

function ToolBody({
  call,
  result,
  writeHunks,
}: {
  call: Extract<Part, { type: "tool-call" }>
  result?: Extract<Part, { type: "tool-result" }>
  writeHunks?: DiffLine[] | null
}) {
  const t = useT()
  const input = call.input as Record<string, unknown>

  if (call.toolName === "browser_screenshot") {
    return <ScreenshotBody toolCallId={call.toolCallId} fallback={result?.output} isError={result?.isError} />
  }

  if (call.toolName === "generate_image") {
    return <GeneratedImageBody toolCallId={call.toolCallId} fallback={result?.output} isError={result?.isError} />
  }

  if (call.toolName === "edit_file") {
    const oldStr = String(input.old_string ?? "")
    const newStr = String(input.new_string ?? "")
    const hunks = hunksForEdit(oldStr, newStr)
    return (
      <>
        <DiffBlock
          lines={hunks}
          path={String(input.path ?? "")}
          added={hunks.filter((l) => l.kind === "add").length}
          removed={hunks.filter((l) => l.kind === "del").length}
        />
        {result?.isError && <ErrorBlock text={result.output} />}
      </>
    )
  }

  if (call.toolName === "write_file") {
    const content = String(input.content ?? "")
    if (writeHunks) {
      return (
        <>
          <DiffBlock
            lines={writeHunks}
            path={String(input.path ?? "")}
            added={writeHunks.filter((l) => l.kind === "add").length}
            removed={writeHunks.filter((l) => l.kind === "del").length}
          />
          {result?.isError && <ErrorBlock text={result.output} />}
        </>
      )
    }
    return (
      <>
        <CodeView
          code={content}
          path={String(input.path ?? "")}
          accent="add"
          added={content === "" ? 0 : content.split("\n").length}
        />
        {result?.isError && <ErrorBlock text={result.output} />}
      </>
    )
  }

  if (call.toolName === "apply_patch") {
    const views = parsePatchForUI(String(input.patch ?? ""))
    if (views.length === 0) {
      return result ? (
        <OutputBlock copyText={result.output} tone={result.isError ? "error" : "default"}>
          <pre className="m-0 max-h-[420px] overflow-auto whitespace-pre-wrap bg-codezal-code px-4 py-3 font-mono text-sm leading-[1.65] text-codezal-text">
            {stripCR(result.output)}
          </pre>
        </OutputBlock>
      ) : null
    }
    return (
      <div className="space-y-2">
        {views.map((v, i) =>
          v.op === "delete" ? (
            <DeletedFileLine key={i} path={v.path} />
          ) : v.movePath && v.lines.length === 0 ? (
            <MovedFileLine key={i} from={v.path} to={v.movePath} />
          ) : (
            <DiffBlock
              key={i}
              lines={v.lines}
              path={v.movePath ? `${v.path} → ${v.movePath}` : v.path}
              added={v.lines.filter((l) => l.kind === "add").length}
              removed={v.lines.filter((l) => l.kind === "del").length}
            />
          ),
        )}
        {result?.isError && <ErrorBlock text={result.output} />}
      </div>
    )
  }

  if (call.toolName === "read_file") {
    const path = String(input.path ?? "")
    if (result?.isError) return <ErrorBlock text={result.output} />
    if (!result) return <FileLine path={path} />
    const { code, startLine } = stripCatN(result.output)
    const { body, note } = splitReadFooter(code)
    return (
      <>
        <CodeView code={body} path={path} startLine={startLine} />
        {note && <div className="px-0.5 pt-1 text-sm text-codezal-mute">{note}</div>}
      </>
    )
  }

  if (call.toolName === "bash") {
    return (
      <BashBody
        cmd={String(input.command ?? "")}
        output={result?.output ?? ""}
        hasResult={!!result}
        isError={!!result?.isError}
      />
    )
  }

  if (call.toolName === "glob" || call.toolName === "grep") {
    return (
      <SearchBody
        label={call.toolName.toUpperCase()}
        output={result?.output ?? ""}
        isError={!!result?.isError}
      />
    )
  }

  if (call.toolName === "todo_write") {
    const todos = Array.isArray(input.todos)
      ? (input.todos as { content?: string; status?: string; priority?: string }[])
      : []
    return <TodoList todos={todos} title="Plan" />
  }

  if (call.toolName === "propose_build" || call.toolName === "propose_plan") {
    const isBuild = call.toolName === "propose_build"
    const text = isBuild ? String(input.plan ?? "") : String(input.reason ?? "")
    const heading = t(
      (isBuild ? "messageList.planSummary" : "messageList.planReason") as MessageKey,
    )
    return (
      <>
        <div className="overflow-hidden rounded-xl border border-codezal-strong bg-codezal-panel-2/40">
          <div className="border-b border-codezal/60 px-4 py-2 text-sm font-medium uppercase tracking-[0.08em] text-codezal-mute">
            {heading}
          </div>
          <div className="px-4 py-3 text-base leading-[1.65] whitespace-pre-wrap text-codezal-text">
            {text}
          </div>
        </div>
        {result?.isError && (
          <OutputBlock copyText={result.output} tone="error">
            <div className="px-4 py-2.5 text-base leading-[1.65] whitespace-pre-wrap text-destructive">
              {stripCR(result.output)}
            </div>
          </OutputBlock>
        )}
      </>
    )
  }

  if (call.toolName === "question") {
    type QOpt = { label?: string; description?: string }
    type QItem = { question?: string; header?: string; options?: QOpt[] }
    const questions: QItem[] = Array.isArray(input.questions)
      ? (input.questions as QItem[])
      : input.prompt
        ? [
            {
              question: String(input.prompt),
              options: (Array.isArray(input.choices) ? (input.choices as string[]) : []).map(
                (c) => ({ label: c }),
              ),
            },
          ]
        : []
    if (result) {
      return (
        <div className="overflow-hidden rounded-xl border border-codezal-strong bg-codezal-panel-2/40 px-4 py-3">
          <div
            className={cn(
              "whitespace-pre-wrap text-base leading-[1.65]",
              result.isError ? "text-destructive" : "text-codezal-text",
            )}
          >
            {stripCR(result.output)}
          </div>
        </div>
      )
    }
    return (
      <div className="divide-y divide-codezal/60 overflow-hidden rounded-xl border border-codezal-strong bg-codezal-panel-2/40">
        {questions.map((q, qi) => (
          <div key={qi} className="px-4 py-3">
            <div className="flex items-start gap-2">
              {q.header && (
                <span className="mt-[1px] shrink-0 rounded bg-codezal-chip px-1.5 py-0.5 text-sm font-medium uppercase tracking-wide text-codezal-mute">
                  {q.header}
                </span>
              )}
              <p className="whitespace-pre-wrap text-base leading-[1.65] text-codezal-text">
                {String(q.question ?? "")}
              </p>
            </div>
            {Array.isArray(q.options) && q.options.length > 0 && (
              <ul className="mt-2 space-y-1 text-sm leading-[1.6] text-codezal-dim">
                {q.options.map((o, oi) => (
                  <li key={oi} className="whitespace-pre-wrap">
                    {o.label}
                    {o.description ? ` — ${o.description}` : ""}
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </div>
    )
  }

  if (!result) return null
  return (
    <SearchBody
      label={genericBoxLabel(call.toolName)}
      output={result.output}
      isError={!!result.isError}
    />
  )
}

function stripCatN(out: string): { code: string; startLine: number } {
  const lines = out.split("\n")
  const m = lines[0]?.match(/^ *(\d+)\t/)
  if (!m) return { code: out, startLine: 1 }
  const startLine = parseInt(m[1], 10) || 1
  const code = lines.map((l) => l.replace(/^ *\d+\t/, "")).join("\n")
  return { code, startLine }
}

function splitReadFooter(code: string): { body: string; note?: string } {
  const lines = code.split("\n")
  let i = lines.length - 1
  while (i >= 0 && lines[i].trim() === "") i--
  if (i >= 0 && /^\(.*\)$/.test(lines[i].trim())) {
    return { body: lines.slice(0, i).join("\n").replace(/\n+$/, ""), note: lines[i].trim() }
  }
  return { body: code }
}

function FileLine({ path, meta }: { path: string; meta?: string }) {
  const t = useT()
  return (
    <div className="text-sm text-codezal-mute">
      {t("messageList.file")}: <span className="font-mono text-codezal-text">{path}</span>
      {meta && <span className="text-codezal-mute"> · {meta}</span>}
    </div>
  )
}

function OutputBlock({
  label,
  copyText,
  tone = "default",
  children,
}: {
  label?: string
  copyText: string
  tone?: "default" | "error"
  children: React.ReactNode
}) {
  const t = useT()
  const [copied, setCopied] = useState(false)
  async function onCopy(e: React.MouseEvent) {
    e.stopPropagation()
    try {
      await navigator.clipboard.writeText(copyText)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // Intentionally ignored.
    }
  }
  // Flat layout: a quiet caption + ghost copy above a recessed code well —
  // no header bar or outer border, so expanding a tool no longer snaps into a
  // boxed "table". The children carry their own bg-codezal-code surface.
  return (
    <div className="group/out space-y-1">
      <div className={cn("flex items-center px-0.5", label ? "justify-between" : "justify-end")}>
        {label && (
          <span className="text-sm font-medium uppercase tracking-[0.08em] text-codezal-mute">
            {label}
          </span>
        )}
        <button
          type="button"
          onClick={onCopy}
          title={t("messageList.copyBlockTitle")}
          className="inline-flex items-center gap-1 rounded px-1 py-0.5 text-sm text-codezal-mute opacity-0 transition hover:text-codezal-text group-hover/out:opacity-100 focus-visible:opacity-100"
        >
          {copied ? (
            <>
              <Check className="h-3.5 w-3.5" /> {t("messageList.copiedLabel")}
            </>
          ) : (
            <>
              <Copy className="h-3.5 w-3.5" /> {t("messageList.copyLabel")}
            </>
          )}
        </button>
      </div>
      <div
        className={cn(
          "overflow-hidden rounded-xl",
          tone === "error" && "ring-1 ring-destructive/25",
        )}
      >
        {children}
      </div>
    </div>
  )
}

function ScreenshotBody({
  toolCallId,
  fallback,
  isError,
}: {
  toolCallId: string
  fallback?: string
  isError?: boolean
}) {
  const img = useBrowserShots((s) => s.byCallId[toolCallId])
  if (isError && fallback) return <ErrorBlock text={fallback} />
  if (!img) {
    return fallback ? <div className="px-1 py-0.5 text-sm text-codezal-mute">{fallback}</div> : null
  }
  return (
    <div className="overflow-hidden rounded-xl bg-codezal-chip p-2">
      <img
        src={img}
        alt="browser screenshot"
        className="max-h-[440px] w-auto rounded-lg border border-codezal-hair"
      />
    </div>
  )
}

function GeneratedImageBody({
  toolCallId,
  fallback,
  isError,
}: {
  toolCallId: string
  fallback?: string
  isError?: boolean
}) {
  const img = useGeneratedImages((s) => s.byCallId[toolCallId])
  if (isError && fallback) return <ErrorBlock text={fallback} />
  if (!img) {
    return fallback ? <div className="px-1 py-0.5 text-sm text-codezal-mute">{fallback}</div> : null
  }
  return (
    <div className="overflow-hidden rounded-xl bg-codezal-chip p-2">
      <img
        src={img}
        alt="generated image"
        className="max-h-[440px] w-auto rounded-lg border border-codezal-hair"
      />
    </div>
  )
}

function ErrorBlock({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false)
  const output = useMemo(() => stripCR(text).trimEnd(), [text])
  const lines = output.split("\n")
  const visibleLines = expanded ? lines : lines.slice(0, 1)
  const hiddenCount = Math.max(0, lines.length - visibleLines.length)
  return (
    <OutputBlock label={tStatic("messageList.errorLabel")} copyText={text} tone="error">
      <pre className="m-0 overflow-x-auto whitespace-pre-wrap bg-destructive/5 px-4 py-3 font-mono text-sm leading-[1.65] text-destructive">
        {visibleLines.join("\n")}
      </pre>
      {!expanded && hiddenCount > 0 && (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="flex w-full items-center justify-center gap-1 border-t border-destructive/10 bg-destructive/5 px-3 py-1 text-sm text-destructive/80 hover:bg-destructive/10"
        >
          <ChevronRight size={12} className="rotate-90" />
          {tStatic("messageList.linesMore", { count: hiddenCount })}
        </button>
      )}
    </OutputBlock>
  )
}

function DeletedFileLine({ path }: { path: string }) {
  return (
    <div className="overflow-hidden rounded-lg border border-codezal-strong bg-codezal-code px-3 py-1.5 font-mono text-sm text-codezal-diff-del">
      − {path}
    </div>
  )
}

function MovedFileLine({ from, to }: { from: string; to: string }) {
  return (
    <div className="overflow-hidden rounded-lg border border-codezal-strong bg-codezal-code px-3 py-1.5 font-mono text-sm text-codezal-mute">
      {from} → {to}
    </div>
  )
}

// Diff renderer. With a path/added/removed it shows a Codex-style file header
// (path + diff-stat) above the colored hunk lines; without, just the lines.
function DiffBlock({
  lines,
  path,
  added,
  removed,
}: {
  lines: DiffLine[]
  path?: string
  added?: number
  removed?: number
}) {
  const [collapsed, setCollapsed] = useState(true)
  if (lines.length === 0) {
    return (
      <div className="rounded bg-codezal-code p-3 text-sm leading-[1.6] font-mono text-codezal-mute">
        {tStatic("messageList.noChanges")}
      </div>
    )
  }
  const hasHeader = path != null || added != null || removed != null
  const COLLAPSE_THRESHOLD = 24
  const COLLAPSED_LINES = 12
  const collapsible = lines.length > COLLAPSE_THRESHOLD
  const shownLines = collapsed && collapsible ? lines.slice(0, COLLAPSED_LINES) : lines
  return (
    <div className="overflow-hidden rounded-lg border border-codezal-strong bg-codezal-code">
      {hasHeader && (
        <button
          type="button"
          onClick={() => collapsible && setCollapsed((c) => !c)}
          className={cn(
            "flex w-full items-center gap-2 border-b border-codezal-hair px-3 py-1.5 text-left text-sm",
            collapsible && "cursor-pointer hover:bg-codezal-panel-2/40",
          )}
        >
          {collapsible && (
            <ChevronRight
              size={12}
              className={cn("shrink-0 text-codezal-mute transition-transform", !collapsed && "rotate-90")}
            />
          )}
          {path && <span className="truncate font-mono text-codezal-text">{path}</span>}
          {added != null && (
            <span className="shrink-0 font-mono text-codezal-diff-add">+{added}</span>
          )}
          {removed != null && removed > 0 && (
            <span className="shrink-0 font-mono text-codezal-diff-del">-{removed}</span>
          )}
        </button>
      )}
      <pre className="m-0 overflow-x-auto py-2 font-mono text-sm leading-[1.6]">
        {annotateIntraline(shownLines).map((l, i) => {
          const no = l.kind === "del" ? l.oldNo : l.newNo
          return (
            <div
              key={i}
              className={cn(
                "flex gap-2 px-3",
                l.kind === "add" && "bg-codezal-diff-add text-codezal-diff-add",
                l.kind === "del" && "bg-codezal-diff-del text-codezal-diff-del",
              )}
            >
              <span className="w-9 shrink-0 select-none text-right tabular-nums text-codezal-mute/60">
                {no ?? ""}
              </span>
              <span className="w-3 shrink-0 text-codezal-mute">
                {l.kind === "add" ? "+" : l.kind === "del" ? "-" : " "}
              </span>
              <span className="whitespace-pre">
                {l.segs
                  ? l.segs.map((s, si) => (
                      <span key={si} className={s.changed ? "font-semibold" : "opacity-55"}>
                        {s.text}
                      </span>
                    ))
                  : l.text}
              </span>
            </div>
          )
        })}
      </pre>
      {collapsible && collapsed && (
        <button
          type="button"
          onClick={() => setCollapsed(false)}
          className="flex w-full items-center justify-center gap-1 border-t border-codezal-hair px-3 py-1 text-sm text-codezal-mute hover:bg-codezal-panel-2/40 hover:text-codezal-text"
        >
          <ChevronRight size={12} className="rotate-90" />
          {tStatic("messageList.linesMore", { count: lines.length - COLLAPSED_LINES })}
        </button>
      )}
    </div>
  )
}

// Codex-style row descriptor: a tense-aware verb label + the file basename
// (link coloured) + optional +added/-removed diff counts. Reads have no counts.
function describeCall(
  call: Extract<Part, { type: "tool-call" }>,
  running: boolean,
  tFn: (k: MessageKey) => string,
  writeHunks?: DiffLine[] | null,
): { label: string; name: string; added?: number; removed?: number } {
  const input = (call.input as Record<string, unknown>) ?? {}
  const tool = call.toolName
  const label = verbLabel(tool, running, tFn)
  if (tool === "todo_write") {
    // Friendly status label; the floating HUD shows the actual list. A fresh
    // list (every item pending) reads "prepared", otherwise "updated".
    const todos = Array.isArray(input.todos)
      ? (input.todos as { status?: string }[])
      : []
    const fresh = todos.length > 0 && todos.every((x) => x?.status === "pending")
    const completed = todos.filter(
      (x) => x?.status === "completed" || x?.status === "cancelled",
    ).length
    return {
      label: tFn(
        (fresh ? "messageList.todoPrepared" : "messageList.todoUpdated") as MessageKey,
      ),
      name: todos.length > 0 ? `${completed}/${todos.length}` : "",
    }
  }
  if (tool === "spawn_agent") {
    // Breadcrumb: "Agent called" + agent name; the full live card is in the panel.
    return { label: tFn("messageList.agentCalled" as MessageKey), name: String(input.name ?? "") }
  }
  if (tool === "question") {
    return { label: tFn("messageList.toolQuestion" as MessageKey), name: "" }
  }
  if (tool === "read_file") {
    return { label, name: basename(String(input.path ?? "")) }
  }
  if (tool === "write_file") {
    const content = String(input.content ?? "")
    if (writeHunks) {
      return {
        label,
        name: basename(String(input.path ?? "")),
        added: writeHunks.filter((l) => l.kind === "add").length,
        removed: writeHunks.filter((l) => l.kind === "del").length,
      }
    }
    return {
      label,
      name: basename(String(input.path ?? "")),
      added: content === "" ? 0 : content.split("\n").length,
    }
  }
  if (tool === "edit_file") {
    const hunks = hunksForEdit(String(input.old_string ?? ""), String(input.new_string ?? ""))
    return {
      label,
      name: basename(String(input.path ?? "")),
      added: hunks.filter((l) => l.kind === "add").length,
      removed: hunks.filter((l) => l.kind === "del").length,
    }
  }
  if (tool === "bash") {
    const desc = String(input.description ?? "").trim()
    const c = String(input.command ?? "").trim().replace(/^(sudo|env)\s+/i, "")
    return { label, name: desc || c.split(/\s+/)[0] || "" }
  }
  if (tool === "list_dir") {
    return { label, name: String(input.path ?? "") }
  }
  if (tool === "glob" || tool === "grep") {
    const q = tool === "glob" ? String(input.pattern ?? "") : String(input.query ?? "")
    return { label, name: q }
  }
  if (tool === "dispatch_workers") {
    const dispatches = Array.isArray(input.dispatches) ? input.dispatches as { workerIdx?: number }[] : []
    const name = dispatches.length === 1
      ? `Worker ${dispatches[0].workerIdx ?? 1}`
      : `${dispatches.length} workers`
    return { label, name }
  }
  if (tool === "webfetch" || tool === "clone_repo") {
    return { label, name: String(input.url ?? "") }
  }
  if (tool === "websearch" || tool === "code_query" || tool === "code_search") {
    return { label, name: String(input.query ?? "") }
  }
  if (tool === "lsp") {
    const op = String(input.operation ?? "")
    if (op === "workspaceSymbol") {
      const q = String(input.query ?? "")
      return { label, name: [op, q ? `"${q}"` : ""].filter(Boolean).join(" ") }
    }
    const p = input.path ? basename(String(input.path)) : ""
    const hasPos = input.line != null && input.character != null
    const loc = hasPos ? `${p}:${input.line}:${input.character}` : p
    return { label, name: [op, loc].filter(Boolean).join(" ") }
  }
  if (tool === "apply_patch") {
    const m = String(input.patch ?? "").match(/^\*\*\* (?:Add|Update|Delete) File: (.+)$/m)
    return { label, name: m ? basename(m[1].trim()) : "" }
  }
  if (tool === "code_callers" || tool === "code_callees" || tool === "code_impact") {
    return { label, name: String(input.symbol ?? "") }
  }
  if (tool === "code_trace") {
    return { label, name: `${String(input.from ?? "")}→${String(input.to ?? "")}` }
  }
  if (tool === "create_worktree") {
    return { label, name: String(input.branch ?? "") }
  }
  if (tool === "remove_worktree") {
    return { label, name: basename(String(input.target ?? "")) }
  }
  if (tool === "load_skill") {
    return { label, name: String(input.name ?? "") }
  }
  if (tool === "list_worktrees" || tool === "propose_build" || tool === "propose_plan") {
    return { label, name: "" }
  }
  if (tool === "tool_search") {
    const q = String(input.query ?? "")
    const sel = q.startsWith("select:") ? q.slice("select:".length) : ""
    if (!sel) return { label, name: q }
    const byServer = new Map<string, string[]>()
    for (const raw of sel.split(",").map((s) => s.trim()).filter(Boolean)) {
      const i = raw.indexOf("__")
      const server = i >= 0 ? raw.slice(0, i) : ""
      const short = i >= 0 ? raw.slice(i + 2) : raw
      const arr = byServer.get(server) ?? []
      arr.push(short)
      byServer.set(server, arr)
    }
    const name = Array.from(byServer.entries())
      .map(([s, tools]) => (s ? `${s}: ${tools.join(", ")}` : tools.join(", ")))
      .join(" · ")
    return { label, name }
  }
  if (tool.includes("__")) {
    const i = tool.indexOf("__")
    const server = tool.slice(0, i)
    const short = tool.slice(i + 2)
    return { label: server ? `${server}: ${short}` : tool, name: "" }
  }
  return { label, name: pickLabel(input) }
}

// Tool verb lookup keyed by tool name.
// Returns locale keys for the past-tense and present-participle labels.
const TOOL_VERB_KEYS: Record<string, { pastKey: string; ingKey: string }> = {
  read_file: { pastKey: "messageList.toolReadFile", ingKey: "messageList.toolReadFileIng" },
  write_file: { pastKey: "messageList.fileCreated", ingKey: "messageList.fileCreatedIng" },
  edit_file: { pastKey: "messageList.fileChanged", ingKey: "messageList.fileChangedIng" },
  list_dir: { pastKey: "messageList.toolDir", ingKey: "messageList.toolDirIng" },
  bash: { pastKey: "messageList.toolBash", ingKey: "messageList.toolBashIng" },
  dispatch_workers: { pastKey: "messageList.toolDispatchWorkers", ingKey: "messageList.toolDispatchWorkersIng" },
  grep: { pastKey: "messageList.toolGrep", ingKey: "messageList.toolGrepIng" },
  tool_search: { pastKey: "messageList.toolSearch", ingKey: "messageList.toolSearchIng" },
  glob: { pastKey: "messageList.toolGlob", ingKey: "messageList.toolGlobIng" },
  todo_write: { pastKey: "messageList.toolTodo", ingKey: "messageList.toolTodoIng" },
  webfetch: { pastKey: "messageList.toolWebfetch", ingKey: "messageList.toolWebfetchIng" },
  websearch: { pastKey: "messageList.toolWebsearch", ingKey: "messageList.toolWebsearchIng" },
  lsp: { pastKey: "messageList.toolLsp", ingKey: "messageList.toolLspIng" },
  apply_patch: { pastKey: "messageList.toolPatch", ingKey: "messageList.toolPatchIng" },
  code_query: { pastKey: "messageList.toolCode", ingKey: "messageList.toolCodeIng" },
  code_search: { pastKey: "messageList.toolCode", ingKey: "messageList.toolCodeIng" },
  code_callers: { pastKey: "messageList.toolCode", ingKey: "messageList.toolCodeIng" },
  code_callees: { pastKey: "messageList.toolCode", ingKey: "messageList.toolCodeIng" },
  code_trace: { pastKey: "messageList.toolCode", ingKey: "messageList.toolCodeIng" },
  code_impact: { pastKey: "messageList.toolCode", ingKey: "messageList.toolCodeIng" },
  clone_repo: { pastKey: "messageList.toolClone", ingKey: "messageList.toolCloneIng" },
  create_worktree: { pastKey: "messageList.toolWorktree", ingKey: "messageList.toolWorktreeIng" },
  remove_worktree: { pastKey: "messageList.toolWorktree", ingKey: "messageList.toolWorktreeIng" },
  list_worktrees: { pastKey: "messageList.toolWorktree", ingKey: "messageList.toolWorktreeIng" },
  load_skill: { pastKey: "messageList.toolSkill", ingKey: "messageList.toolSkillIng" },
  propose_build: { pastKey: "messageList.toolProposeBuild", ingKey: "messageList.toolProposeBuild" },
  propose_plan: { pastKey: "messageList.toolProposePlan", ingKey: "messageList.toolProposePlan" },
  spawn_agent: { pastKey: "messageList.agentCalled", ingKey: "messageList.agentCalled" },
  browser_navigate: { pastKey: "messageList.toolBrowserNav", ingKey: "messageList.toolBrowserNavIng" },
  browser_screenshot: { pastKey: "messageList.toolBrowserShot", ingKey: "messageList.toolBrowserShotIng" },
  generate_image: { pastKey: "messageList.toolGenImage", ingKey: "messageList.toolGenImageIng" },
  browser_read_console: { pastKey: "messageList.toolBrowserConsole", ingKey: "messageList.toolBrowserConsoleIng" },
  browser_read_network: { pastKey: "messageList.toolBrowserNetwork", ingKey: "messageList.toolBrowserNetworkIng" },
  browser_snapshot: { pastKey: "messageList.toolBrowserSnap", ingKey: "messageList.toolBrowserSnapIng" },
  browser_click: { pastKey: "messageList.toolBrowserClick", ingKey: "messageList.toolBrowserClickIng" },
  browser_fill: { pastKey: "messageList.toolBrowserFill", ingKey: "messageList.toolBrowserFillIng" },
  browser_select: { pastKey: "messageList.toolBrowserSelect", ingKey: "messageList.toolBrowserSelectIng" },
  browser_press: { pastKey: "messageList.toolBrowserPress", ingKey: "messageList.toolBrowserPressIng" },
  browser_type: { pastKey: "messageList.toolBrowserType", ingKey: "messageList.toolBrowserTypeIng" },
  browser_scroll: { pastKey: "messageList.toolBrowserScroll", ingKey: "messageList.toolBrowserScrollIng" },
  browser_hover: { pastKey: "messageList.toolBrowserHover", ingKey: "messageList.toolBrowserHoverIng" },
  browser_wait: { pastKey: "messageList.toolBrowserWait", ingKey: "messageList.toolBrowserWaitIng" },
  browser_eval: { pastKey: "messageList.toolBrowserEval", ingKey: "messageList.toolBrowserEvalIng" },
}

function verbLabel(tool: string, running: boolean, tFn: (k: MessageKey) => string): string {
  if (!tool.trim()) return tFn("messageList.toolCall" as MessageKey)
  if (tool === "run_workflow") return tFn(running ? "messageList.workflowRunning" : "messageList.workflowStarted")
  if (tool === "workflow_status") return tFn(running ? "messageList.workflowWatching" : "messageList.workflowStatus")
  const v = TOOL_VERB_KEYS[tool]
  if (!v) return tool
  return tFn((running ? v.ingKey : v.pastKey) as MessageKey)
}

// Group summary chunk: "25 Read file" / "1 Directory" — just count + label.
// The previous "<count> <noun> <verb>" form produced broken strings like
// "25 Directory Read file" / "1 Directory Directory" (noun key was wrong/redundant).
function summarizeTool(tool: string, n: number, running: boolean, tFn: (k: MessageKey) => string): string {
  if (!tool.trim()) return `${n} ${tFn("messageList.toolCall" as MessageKey)}`
  if (tool === "run_workflow") return `${n} ${tFn(running ? "messageList.workflowRunning" : "messageList.workflowStarted")}`
  if (tool === "workflow_status") return `${n} ${tFn(running ? "messageList.workflowWatching" : "messageList.workflowStatus")}`
  const v = TOOL_VERB_KEYS[tool]
  if (!v) return `${n} ${tool}`
  return `${n} ${tFn((running ? v.ingKey : v.pastKey) as MessageKey)}`
}

function pickLabel(input: Record<string, unknown>): string {
  const keys = ["description", "query", "url", "path", "pattern", "name", "command"]
  for (const k of keys) {
    const v = input[k]
    if (typeof v === "string" && v.length > 0) return v
  }
  return ""
}

function Dots() {
  const t = useT()
  // (WCAG 4.1.3 / 1.1.1). Noktalar dekoratif, aria-hidden.
  return (
    <span
      role="status"
      aria-label={t("a11y.responseLoading")}
      className="inline-flex items-center gap-1 text-codezal-mute"
    >
      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current" aria-hidden />
      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current [animation-delay:120ms]" aria-hidden />
      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current [animation-delay:240ms]" aria-hidden />
    </span>
  )
}

// Last-message status discriminator — enum-stable English values.
//   - incomplete tool-call present → "working"
//   - producing text/reasoning     → "writing"
//   - no parts yet                 → "thinking"
function statusForMessage(m: Message): "thinking" | "working" | "writing" {
  const parts = m.parts ?? []
  if (parts.length === 0) return "thinking"
  // Scan backward: is there a pending tool call?
  const resultIds = new Set<string>()
  for (const p of parts) {
    if (p.type === "tool-result") resultIds.add(p.toolCallId)
  }
  let pendingTool = false
  for (let i = parts.length - 1; i >= 0; i--) {
    const p = parts[i]
    if (p.type === "tool-call" && !resultIds.has(p.toolCallId)) {
      pendingTool = true
      break
    }
    if (p.type === "text" || p.type === "tool-result") break
  }
  if (pendingTool) return "working"
  const last = parts[parts.length - 1]
  if (last.type === "text") return "writing"
  if (last.type === "reasoning") return "thinking"
  return "thinking"
}

function SpinnerRing() {
  return (
    <span className="relative inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center">
      <svg
        className="h-full w-full animate-spin-slow text-codezal-accent"
        viewBox="0 0 16 16"
        fill="none"
      >
        <circle cx="8" cy="8" r="6" stroke="currentColor" strokeOpacity="0.25" strokeWidth="1.5" />
        <circle
          cx="8"
          cy="8"
          r="6"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeDasharray="10 50"
        />
      </svg>
    </span>
  )
}

function StreamingHint({ message }: { message: Message }) {
  const t = useT()
  const status = statusForMessage(message)
  return (
    <div className="flex h-6 items-center gap-2.5">
      <SpinnerRing />
      {status === "thinking" && (
        <>
          <span className="text-md leading-[1.7] text-codezal-text">{t("messageList.thinking")}</span>
          <Dots />
        </>
      )}
    </div>
  )
}

function ChatSkeleton() {
  return (
    <div className="flex flex-1 flex-col overflow-hidden px-8 py-6">
      <div className="mx-auto w-full max-w-[860px] space-y-7">
        <div className="flex justify-end">
          <div className="h-9 w-2/5 animate-pulse rounded-2xl bg-codezal-panel-2" />
        </div>
        <div className="space-y-2.5">
          <div className="h-4 w-11/12 animate-pulse rounded bg-codezal-panel-2" />
          <div className="h-4 w-4/5 animate-pulse rounded bg-codezal-panel-2" />
          <div className="h-4 w-3/5 animate-pulse rounded bg-codezal-panel-2" />
        </div>
        <div className="flex justify-end">
          <div className="h-9 w-1/3 animate-pulse rounded-2xl bg-codezal-panel-2" />
        </div>
        <div className="space-y-2.5">
          <div className="h-4 w-10/12 animate-pulse rounded bg-codezal-panel-2" />
          <div className="h-4 w-2/3 animate-pulse rounded bg-codezal-panel-2" />
          <div className="h-4 w-1/2 animate-pulse rounded bg-codezal-panel-2" />
        </div>
      </div>
    </div>
  )
}

function Welcome() {
  const t = useT()

  return (
    <div className="flex flex-1">
      <h1 className="sr-only">{t("sidebar.newSession")}</h1>
    </div>
  )
}
