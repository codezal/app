// Mesaj akışı — tasarımdaki "session breadcrumb + avatar bubble" stili.
// User = sağ, başında "EE" avatar; assistant = sol, başında amber spark.
import { memo, useEffect, useRef, useState } from "react"
import {
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  FilePlus,
  FileText,
  GitBranch,
  Pencil,
  RefreshCcw,
  Terminal,
  Trash2,
  Undo2,
  Wrench,
  X,
} from "lucide-react"
import { Markdown } from "./Markdown"
import { CodezalMark } from "./icons"
import { AgentCard } from "./AgentCard"
import type { Message, Part } from "@/store/types"
import { useSessionsStore } from "@/store/sessions"
import { hunksForEdit, type DiffLine } from "@/lib/diff"
import { cn } from "@/lib/utils"

type Props = {
  messages: Message[]
  streaming?: boolean
  emptyHint?: string
  onRegenerate?: (userMsgId: string) => void
  onEditUser?: (userMsgId: string, newText: string) => void
  onBranch?: (messageId: string) => void
  onDelete?: (messageId: string) => void
  // Bu mesajın etkilediği dosyaları snapshot'tan geri yükle, mesajı ve sonrasını sil
  onRevert?: (messageId: string) => void
}

export function MessageList({
  messages,
  streaming,
  onRegenerate,
  onEditUser,
  onBranch,
  onDelete,
  onRevert,
}: Props) {
  const active = useSessionsStore((s) => s.active)
  const scrollRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  // Otomatik dibe yapışma — kullanıcı yukarı kaydırınca pasifleşir,
  // dibe geri inince yeniden aktifleşir.
  const autoFollowRef = useRef(true)
  const rafRef = useRef<number | null>(null)
  const animatingRef = useRef(false)
  const [showJumpToBottom, setShowJumpToBottom] = useState(false)

  const hasMessages = messages.length > 0

  // Stream sırasında DOM yüksekliği büyür — eased rAF loop ile yumuşak takip.
  // hasMessages bool deps — Welcome'dan listeye geçtiğinde scrollRef yeni mount olur, effect tekrar kayıt eder.
  useEffect(() => {
    if (!hasMessages) return
    const scroll = scrollRef.current
    const content = contentRef.current
    if (!scroll || !content) return

    // rAF içinde her karede hedefe doğru %20 yaklaş → smooth ease-out.
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
        // Dibe ulaştık ama hala stream devam ediyor olabilir — döngüyü sürdür
        scroll.scrollTop = target
        // Bir sonraki kareye ek hedef gelirse devam et
        rafRef.current = requestAnimationFrame(tick)
        return
      }
      // Easing katsayısı — 0.18 yeterince yumuşak, takip eder
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
      if (autoFollowRef.current) startAnimation()
    })
    ro.observe(content)

    // Kullanıcı niyeti — wheel/touch/keydown ile yakalanır.
    // Yukarı doğru hareket → autoFollow kapat.
    const onUserScroll = (deltaY: number) => {
      if (deltaY < 0) {
        autoFollowRef.current = false
        setShowJumpToBottom(true)
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

    // Aşağı kaydırıp dibe ulaştığında autoFollow yeniden aktif olsun
    let scrollTimer: number | null = null
    const onScroll = () => {
      if (scrollTimer != null) window.clearTimeout(scrollTimer)
      scrollTimer = window.setTimeout(() => {
        const distance = scroll.scrollHeight - scroll.clientHeight - scroll.scrollTop
        const atBottom = distance < 40
        if (atBottom && !autoFollowRef.current) {
          autoFollowRef.current = true
          setShowJumpToBottom(false)
          startAnimation()
        } else if (!atBottom) {
          setShowJumpToBottom(true)
        } else {
          setShowJumpToBottom(false)
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
  }, [hasMessages])

  function jumpToBottom() {
    const el = scrollRef.current
    if (!el) return
    autoFollowRef.current = true
    setShowJumpToBottom(false)
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" })
  }

  if (messages.length === 0) return <Welcome />

  const tokenEstimate = messages.reduce(
    (n, m) => n + Math.ceil((m.content?.length ?? 0) / 4),
    0,
  )

  return (
    <div ref={scrollRef} className="relative flex-1 overflow-y-auto">
      <div ref={contentRef} className="w-full px-8 pt-5">
        {/* Breadcrumb head */}
        <div className="flex items-center gap-2 border-b border-codezal pb-3">
          <span className="text-codezal-accent">
            <CodezalMark size={13} />
          </span>
          <span className="text-[13px] font-medium text-codezal-text">
            {active?.title ?? "Oturum"}
          </span>
          <span className="text-[12px] text-codezal-mute">
            · {active?.provider ?? "—"} / {active?.model ?? "—"}
          </span>
          <div className="flex-1" />
          <span className="text-[11px] text-codezal-mute">
            {messages.length} mesaj · {formatK(tokenEstimate)} token
          </span>
        </div>

        <div className="flex flex-col gap-4 py-5">
          {messages.map((m, i) => {
            // Asistan mesajı için "yeniden üret" → en yakın önceki user msg üzerinden
            const prevUserId = findPrevUserId(messages, i)
            return (
              <Bubble
                key={m.id}
                m={m}
                streaming={!!streaming}
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
                onBranch={onBranch ? () => onBranch(m.id) : undefined}
                onDelete={onDelete ? () => onDelete(m.id) : undefined}
                onRevert={
                  onRevert && m.snapshotPaths && m.snapshotPaths.length > 0
                    ? () => onRevert(m.id)
                    : undefined
                }
              />
            )
          })}
          {streaming && messages[messages.length - 1]?.role === "assistant" && (
            <StreamingHint message={messages[messages.length - 1]} />
          )}
        </div>
      </div>
      {showJumpToBottom && (
        <button
          type="button"
          onClick={jumpToBottom}
          title="En alta in"
          className="absolute bottom-4 right-6 z-20 flex h-8 items-center gap-1.5 rounded-full border border-codezal bg-codezal-sidebar/95 px-3 text-[11.5px] text-codezal-dim shadow-lg backdrop-blur hover:border-codezal-strong hover:text-codezal-text"
        >
          {streaming && (
            <span className="inline-flex h-1.5 w-1.5 animate-breathe rounded-full bg-codezal-accent" />
          )}
          <span>En alta in</span>
          <ChevronDown className="h-3 w-3" />
        </button>
      )}
    </div>
  )
}

type BubbleProps = {
  m: Message
  streaming: boolean
  onRegenerate?: () => void
  onEditUser?: (newText: string) => void
  onBranch?: () => void
  onDelete?: () => void
  onRevert?: () => void
}

// React.memo — yalnız son mesaj değişir; önceki mesajlar tekrar render olmasın.
// Callbacks her parent render'da yeni referans olduğundan custom comparator
// ile sadece mesaj kimliği + streaming durumuna bak.
const Bubble = memo(BubbleImpl, (prev, next) => {
  return (
    prev.m === next.m &&
    prev.streaming === next.streaming &&
    !!prev.onRegenerate === !!next.onRegenerate &&
    !!prev.onEditUser === !!next.onEditUser &&
    !!prev.onBranch === !!next.onBranch &&
    !!prev.onDelete === !!next.onDelete &&
    !!prev.onRevert === !!next.onRevert
  )
})

function BubbleImpl({
  m,
  streaming,
  onRegenerate,
  onEditUser,
  onBranch,
  onDelete,
  onRevert,
}: BubbleProps) {
  const isUser = m.role === "user"
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(m.content)
  const [copied, setCopied] = useState(false)
  const editRef = useRef<HTMLTextAreaElement>(null)

  // Edit moduna geçince textarea auto-grow + focus
  useEffect(() => {
    if (!editing) return
    const el = editRef.current
    if (!el) return
    el.focus()
    el.setSelectionRange(el.value.length, el.value.length)
    el.style.height = "auto"
    el.style.height = Math.min(el.scrollHeight, 320) + "px"
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
    if (!t || t === m.content) {
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
      // sessiz geç
    }
  }

  // Stream sırasında aksiyon butonları gizli (kafa karıştırmasın)
  const showActions = !streaming && !m.pending && !editing

  return (
    <div className="group/bubble relative flex gap-3">
      {/* Avatar */}
      {isUser ? (
        <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-codezal-chip text-[11px] font-semibold text-codezal-dim">
          EE
        </div>
      ) : (
        <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-codezal-accent-dim text-codezal-accent">
          <CodezalMark size={13} />
        </div>
      )}

      <div className="min-w-0 flex-1">
        <div className="mb-1 text-[11px] text-codezal-dim">
          {isUser ? "Sen" : "Codezal"}
        </div>

        {editing ? (
          <div className="rounded-md border border-codezal-strong bg-codezal-input p-2">
            <textarea
              ref={editRef}
              value={draft}
              onChange={(e) => {
                setDraft(e.target.value)
                const el = e.currentTarget
                el.style.height = "auto"
                el.style.height = Math.min(el.scrollHeight, 320) + "px"
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
              className="w-full resize-none bg-transparent text-[13px] leading-[1.55] text-codezal-text focus:outline-none"
              rows={1}
            />
            <div className="mt-2 flex items-center justify-end gap-2 text-[11px]">
              <button
                type="button"
                onClick={cancelEdit}
                className="flex items-center gap-1 rounded-md border border-codezal px-2 py-1 text-codezal-dim hover:border-codezal-strong"
              >
                <X className="h-3 w-3" /> İptal
              </button>
              <button
                type="button"
                onClick={saveEdit}
                disabled={!draft.trim()}
                className="flex items-center gap-1 rounded-md bg-codezal-accent px-2 py-1 text-[#1a1106] disabled:opacity-50"
              >
                <RefreshCcw className="h-3 w-3" /> Kaydet & yenile
              </button>
            </div>
            <div className="mt-1 text-right text-[10.5px] text-codezal-mute">
              ⌘⏎ kaydet · Esc iptal
            </div>
          </div>
        ) : m.pending && (!m.parts || m.parts.length === 0) && m.content === "" ? (
          <Dots />
        ) : isUser ? (
          <div className="whitespace-pre-wrap text-[13px] leading-[1.55] text-codezal-text">
            {m.content}
          </div>
        ) : m.parts && m.parts.length > 0 ? (
          <PartsRender parts={m.parts} />
        ) : (
          <Markdown content={m.content} className="text-[13px] leading-[1.55]" />
        )}

        {showActions && (
          <div className="mt-1.5 flex items-center gap-1 opacity-0 transition-opacity group-hover/bubble:opacity-100">
            <ActionBtn onClick={copyContent} title="Kopyala">
              {copied ? <Check className="h-3 w-3 text-codezal-accent" /> : <Copy className="h-3 w-3" />}
            </ActionBtn>
            {isUser && onEditUser && (
              <ActionBtn onClick={startEdit} title="Düzenle ve yeniden gönder">
                <Pencil className="h-3 w-3" />
              </ActionBtn>
            )}
            {!isUser && onRegenerate && (
              <ActionBtn onClick={onRegenerate} title="Yeniden üret">
                <RefreshCcw className="h-3 w-3" />
              </ActionBtn>
            )}
            {onBranch && (
              <ActionBtn onClick={onBranch} title="Buradan çatal (yeni session)">
                <GitBranch className="h-3 w-3" />
              </ActionBtn>
            )}
            {onRevert && (
              <ActionBtn
                onClick={onRevert}
                title={`Dosya değişikliklerini geri al (${m.snapshotPaths?.length ?? 0} dosya)`}
              >
                <Undo2 className="h-3 w-3" />
              </ActionBtn>
            )}
            {onDelete && (
              <ActionBtn onClick={onDelete} title="Mesajı sil" danger>
                <Trash2 className="h-3 w-3" />
              </ActionBtn>
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
        "flex h-6 w-6 items-center justify-center rounded border border-transparent text-codezal-mute hover:border-codezal hover:text-codezal-text",
        danger && "hover:border-destructive/40 hover:text-destructive",
      )}
    >
      {children}
    </button>
  )
}

// i indeksindeki mesajdan geriye doğru en yakın user mesajının id'sini bul.
function findPrevUserId(messages: Message[], i: number): string | null {
  for (let k = i - 1; k >= 0; k--) {
    if (messages[k].role === "user") return messages[k].id
  }
  return null
}

// Karışık part akışını sırayla bas: text → Markdown, ardışık tool çağrıları → grup
function PartsRender({ parts }: { parts: Part[] }) {
  // tool-result'ları toolCallId üzerinden tool-call'a iliştir
  const resultMap = new Map<string, Part & { type: "tool-result" }>()
  for (const p of parts) {
    if (p.type === "tool-result") resultMap.set(p.toolCallId, p)
  }

  // Ardışık tool-call'ları tek grup haline getir; agent-card'lar kendi başlarına
  type ToolCallPart = Extract<Part, { type: "tool-call" }>
  type AgentCardPart = Extract<Part, { type: "agent-card" }>
  type Block =
    | { kind: "text"; key: string; text: string }
    | { kind: "tools"; key: string; calls: ToolCallPart[] }
    | { kind: "agent-card"; key: string; card: AgentCardPart }

  const blocks: Block[] = []
  parts.forEach((p, i) => {
    if (p.type === "text") {
      if (!p.text.trim()) return
      blocks.push({ kind: "text", key: `t${i}`, text: p.text })
    } else if (p.type === "tool-call") {
      const last = blocks[blocks.length - 1]
      if (last && last.kind === "tools") last.calls.push(p)
      else blocks.push({ kind: "tools", key: `g${i}`, calls: [p] })
    } else if (p.type === "agent-card") {
      blocks.push({ kind: "agent-card", key: `a${i}-${p.workerId}`, card: p })
    }
    // reasoning ve tool-result tek başına gösterilmez
  })

  return (
    <div className="space-y-2">
      {blocks.map((b) => {
        if (b.kind === "text") {
          return (
            <Markdown
              key={b.key}
              content={b.text}
              className="text-[13px] leading-[1.55]"
            />
          )
        }
        if (b.kind === "agent-card") {
          return <AgentCard key={b.key} part={b.card} />
        }
        if (b.calls.length === 1) {
          const c = b.calls[0]
          return <ToolRow key={c.toolCallId} call={c} result={resultMap.get(c.toolCallId)} />
        }
        return <ToolGroup key={b.key} calls={b.calls} resultMap={resultMap} />
      })}
    </div>
  )
}

// Ardışık tool çağrılarını tek collapse altında topla.
function ToolGroup({
  calls,
  resultMap,
}: {
  calls: Extract<Part, { type: "tool-call" }>[]
  resultMap: Map<string, Extract<Part, { type: "tool-result" }>>
}) {
  const errorCount = calls.reduce((n, c) => {
    const r = resultMap.get(c.toolCallId)
    return n + (r?.isError ? 1 : 0)
  }, 0)
  const runningCount = calls.reduce(
    (n, c) => n + (resultMap.get(c.toolCallId) ? 0 : 1),
    0,
  )
  // Hata varsa default aç, yoksa kapalı.
  const [open, setOpen] = useState(errorCount > 0)

  // İkon dağılımı: en çok hangi tool varsa onun ikonu + sayım badge'leri
  const counts = new Map<string, number>()
  for (const c of calls) counts.set(c.toolName, (counts.get(c.toolName) ?? 0) + 1)
  const summary = Array.from(counts.entries())
    .map(([name, n]) => `${n} ${toolLabel(name).toLowerCase()}`)
    .join(" · ")

  return (
    <div className="rounded-md border border-codezal bg-codezal-panel-2/30 text-[12px]">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-2.5 py-1 text-left"
      >
        <ChevronRight
          className={cn("h-3 w-3 shrink-0 text-codezal-mute transition-transform", open && "rotate-90")}
        />
        <Wrench className="h-3 w-3 shrink-0 text-codezal-accent" />
        <span className="font-medium text-codezal-text">
          {calls.length} araç çağrısı
        </span>
        <span className="truncate text-codezal-mute">{summary}</span>
        <span className="ml-auto flex shrink-0 items-center gap-1.5">
          {runningCount > 0 && (
            <span className="text-[10.5px] text-codezal-mute">{runningCount} çalışıyor</span>
          )}
          {errorCount > 0 && (
            <span className="rounded bg-destructive/10 px-1.5 py-0.5 text-[10.5px] text-destructive">
              {errorCount} hata
            </span>
          )}
          {errorCount === 0 && runningCount === 0 && (
            <span className="rounded bg-codezal-accent-dim px-1.5 py-0.5 text-[10.5px] text-codezal-accent">
              tamam
            </span>
          )}
        </span>
      </button>
      {open && (
        <div className="border-t border-codezal">
          {calls.map((c) => (
            <ToolRow
              key={c.toolCallId}
              call={c}
              result={resultMap.get(c.toolCallId)}
              dense
            />
          ))}
        </div>
      )}
    </div>
  )
}

// Tek satır tool çağrısı — kompakt, hover'da subtle highlight, tıkla detay aç.
// `dense=true` grup içinde — kenarsız, daha sıkışık.
function ToolRow({
  call,
  result,
  dense = false,
}: {
  call: Extract<Part, { type: "tool-call" }>
  result?: Extract<Part, { type: "tool-result" }>
  dense?: boolean
}) {
  // Hata varsa otomatik aç.
  const [open, setOpen] = useState(!!result?.isError)
  const inputPreview = toolPreview(call.toolName, call.input)
  const status = result ? (result.isError ? "hata" : "tamam") : "çalışıyor"
  const Icon = toolIcon(call.toolName)

  const Wrapper = dense
    ? "border-b border-codezal last:border-b-0"
    : "rounded-md border border-codezal bg-codezal-panel-2/30"

  return (
    <div className={cn("text-[11.5px]", Wrapper)}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-2.5 py-1 text-left hover:bg-codezal-panel-2/40"
      >
        <ChevronRight
          className={cn(
            "h-3 w-3 shrink-0 text-codezal-mute transition-transform",
            open && "rotate-90",
          )}
        />
        <Icon className="h-3 w-3 shrink-0 text-codezal-accent" />
        <span className="shrink-0 text-codezal-dim">{toolLabel(call.toolName)}</span>
        <span className="truncate font-mono text-[11px] text-codezal-mute">
          {inputPreview}
        </span>
        <span
          className={cn(
            "ml-auto shrink-0 text-[10px]",
            status === "tamam" && "text-codezal-accent",
            status === "hata" && "text-destructive",
            status === "çalışıyor" && "text-codezal-mute",
          )}
        >
          {status === "tamam" ? "✓" : status === "hata" ? "✕" : "…"}
        </span>
      </button>
      {open && (
        <div className="space-y-2.5 border-t border-codezal bg-codezal-panel-2/20 px-3 py-3">
          <ToolBody call={call} result={result} />
        </div>
      )}
    </div>
  )
}

// Tool tipine göre özel render: edit_file → diff, write_file → yeni dosya, bash → terminal
function ToolBody({
  call,
  result,
}: {
  call: Extract<Part, { type: "tool-call" }>
  result?: Extract<Part, { type: "tool-result" }>
}) {
  const input = call.input as Record<string, unknown>

  if (call.toolName === "edit_file") {
    const oldStr = String(input.old_string ?? "")
    const newStr = String(input.new_string ?? "")
    const hunks = hunksForEdit(oldStr, newStr)
    const diffText = hunks
      .map((l) => (l.kind === "add" ? "+ " : l.kind === "del" ? "- " : "  ") + l.text)
      .join("\n")
    return (
      <>
        <FileLine path={String(input.path ?? "")} />
        <OutputBlock label="diff" copyText={diffText}>
          <DiffBlock lines={hunks} />
        </OutputBlock>
        {result?.isError && <ErrorBlock text={result.output} />}
      </>
    )
  }

  if (call.toolName === "write_file") {
    const content = String(input.content ?? "")
    const lines = content.split(/\r?\n/)
    const preview = lines.slice(0, 40).join("\n")
    const moreLines = Math.max(0, lines.length - 40)
    const body = preview + (moreLines > 0 ? `\n… ${moreLines} satır daha` : "")
    return (
      <>
        <FileLine path={String(input.path ?? "")} meta={`${content.length} char`} />
        <OutputBlock label="yeni içerik" copyText={content}>
          <pre className="m-0 overflow-x-auto whitespace-pre-wrap bg-codezal-code px-4 py-3 font-mono text-[12px] leading-[1.65] text-codezal-text">
            {body}
          </pre>
        </OutputBlock>
        {result?.isError && <ErrorBlock text={result.output} />}
      </>
    )
  }

  if (call.toolName === "bash") {
    const cmd = String(input.command ?? "")
    return (
      <>
        <OutputBlock label="komut" copyText={cmd}>
          <pre className="m-0 overflow-x-auto whitespace-pre-wrap bg-codezal-code px-4 py-3 font-mono text-[12px] leading-[1.65] text-codezal-text">
            <span className="text-codezal-mute">$ </span>
            {cmd}
          </pre>
        </OutputBlock>
        {result && (
          <OutputBlock
            label="çıktı"
            copyText={result.output}
            tone={result.isError ? "error" : "default"}
          >
            <pre
              className={cn(
                "m-0 max-h-[420px] overflow-auto whitespace-pre-wrap bg-codezal-code px-4 py-3 font-mono text-[12px] leading-[1.65]",
                result.isError ? "text-destructive" : "text-codezal-text",
              )}
            >
              {result.output}
            </pre>
          </OutputBlock>
        )}
      </>
    )
  }

  // Generic — JSON input + raw output
  const inputJson = JSON.stringify(call.input, null, 2)
  return (
    <>
      <OutputBlock label="input" copyText={inputJson}>
        <pre className="m-0 overflow-x-auto whitespace-pre-wrap bg-codezal-code px-4 py-3 font-mono text-[12px] leading-[1.65] text-codezal-text">
          {inputJson}
        </pre>
      </OutputBlock>
      {result && (
        <OutputBlock
          label="output"
          copyText={result.output}
          tone={result.isError ? "error" : "default"}
        >
          <pre
            className={cn(
              "m-0 max-h-[420px] overflow-auto whitespace-pre-wrap bg-codezal-code px-4 py-3 font-mono text-[12px] leading-[1.65]",
              result.isError ? "text-destructive" : "text-codezal-text",
            )}
          >
            {result.output}
          </pre>
        </OutputBlock>
      )}
    </>
  )
}

// Dosya yolu satırı — tool body üst köşesinde küçük meta.
function FileLine({ path, meta }: { path: string; meta?: string }) {
  return (
    <div className="text-[11px] text-codezal-mute">
      dosya: <span className="font-mono text-codezal-text">{path}</span>
      {meta && <span className="text-codezal-mute"> · {meta}</span>}
    </div>
  )
}

// Ortak çıktı kutusu — başlık + kopya butonu + içerik.
function OutputBlock({
  label,
  copyText,
  tone = "default",
  children,
}: {
  label: string
  copyText: string
  tone?: "default" | "error"
  children: React.ReactNode
}) {
  const [copied, setCopied] = useState(false)
  async function onCopy(e: React.MouseEvent) {
    e.stopPropagation()
    try {
      await navigator.clipboard.writeText(copyText)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // sessiz geç
    }
  }
  return (
    <div
      className={cn(
        "group/out overflow-hidden rounded-md border bg-codezal-code",
        tone === "error" ? "border-destructive/30" : "border-codezal-strong",
      )}
    >
      <div className="flex items-center justify-between border-b border-codezal bg-codezal-panel-2/60 px-4 py-1.5 text-[10.5px] uppercase tracking-[0.08em] text-codezal-mute">
        <span className="font-mono">{label}</span>
        <button
          type="button"
          onClick={onCopy}
          title="Bu bloğu kopyala"
          className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10.5px] normal-case tracking-normal text-codezal-dim opacity-0 transition hover:bg-codezal-chip hover:text-codezal-text group-hover/out:opacity-100 focus-visible:opacity-100"
        >
          {copied ? (
            <>
              <Check className="h-3 w-3" /> kopyalandı
            </>
          ) : (
            <>
              <Copy className="h-3 w-3" /> kopyala
            </>
          )}
        </button>
      </div>
      {children}
    </div>
  )
}

function ErrorBlock({ text }: { text: string }) {
  return (
    <OutputBlock label="hata" copyText={text} tone="error">
      <pre className="m-0 overflow-x-auto whitespace-pre-wrap bg-destructive/5 px-4 py-3 font-mono text-[12px] leading-[1.65] text-destructive">
        {text}
      </pre>
    </OutputBlock>
  )
}

function DiffBlock({ lines }: { lines: DiffLine[] }) {
  if (lines.length === 0) {
    return (
      <div className="rounded bg-codezal-code p-3 text-[12px] leading-[1.6] font-mono text-codezal-mute">
        (değişiklik yok)
      </div>
    )
  }
  return (
    <pre className="m-0 overflow-x-auto rounded-md border border-codezal-strong bg-codezal-code py-2 font-mono text-[12px] leading-[1.6]">
      {lines.map((l, i) => (
        <div
          key={i}
          className={cn(
            "flex gap-3 px-3",
            l.kind === "add" && "bg-codezal-diff-add text-codezal-diff-add",
            l.kind === "del" && "bg-codezal-diff-del text-codezal-diff-del",
          )}
        >
          <span className="w-3 shrink-0 text-codezal-mute">
            {l.kind === "add" ? "+" : l.kind === "del" ? "-" : " "}
          </span>
          <span className="whitespace-pre">{l.text}</span>
        </div>
      ))}
    </pre>
  )
}

function toolIcon(name: string) {
  if (name === "edit_file") return Pencil
  if (name === "write_file") return FilePlus
  if (name === "read_file") return FileText
  if (name === "bash") return Terminal
  return Wrench
}

function toolLabel(name: string): string {
  const map: Record<string, string> = {
    list_dir: "Dizin",
    read_file: "Dosya oku",
    write_file: "Dosya yaz",
    edit_file: "Dosya düzelt",
    bash: "Bash",
  }
  return map[name] ?? name
}

function toolPreview(name: string, input: unknown): string {
  const i = (input as Record<string, unknown>) ?? {}
  if (name === "bash") return oneLine(String(i.command ?? ""))
  if (i.path) return String(i.path)
  return oneLine(JSON.stringify(input))
}

function oneLine(s: string, max = 80): string {
  const t = s.replace(/\s+/g, " ").trim()
  return t.length > max ? t.slice(0, max - 1) + "…" : t
}

function Dots() {
  return (
    <span className="inline-flex items-center gap-1 text-codezal-mute">
      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current" />
      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current [animation-delay:120ms]" />
      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current [animation-delay:240ms]" />
    </span>
  )
}

// Son mesajın durumuna göre etiket:
//   - tamamlanmamış tool-call varsa → "çalışıyor"
//   - text/reasoning üretiyorsa     → "yazıyor"
//   - henüz part yoksa              → "düşünüyor"
function statusForMessage(m: Message): "düşünüyor" | "çalışıyor" | "yazıyor" {
  const parts = m.parts ?? []
  if (parts.length === 0) return "düşünüyor"
  // Sondan başa: bekleyen tool çağrısı var mı?
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
  if (pendingTool) return "çalışıyor"
  const last = parts[parts.length - 1]
  if (last.type === "text") return "yazıyor"
  if (last.type === "reasoning") return "düşünüyor"
  return "düşünüyor"
}

function StreamingHint({ message }: { message: Message }) {
  const status = statusForMessage(message)
  return (
    <div className="flex items-center gap-2.5">
      {/* Minimal dönen ring — avatar yerine, daha sade. */}
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
      <span className="text-[12px] text-codezal-dim">
        Codezal <span className="text-codezal-text">{status}</span>
      </span>
      <Dots />
    </div>
  )
}

function Welcome() {
  return (
    <div className="flex flex-1 items-center justify-center">
      <div className="-mt-8 flex w-full max-w-[420px] flex-col items-center text-center">
        <div className="mb-3 text-codezal-accent">
          <CodezalMark size={26} />
        </div>
        <h1 className="m-0 text-[16px] font-medium tracking-tight text-codezal-text">
          Tekrar hoş geldin
        </h1>
        <p className="mt-1.5 text-[13px] text-codezal-dim">
          Bir görev tanımla — Codezal araçları çağırarak çalışsın.
        </p>
      </div>
    </div>
  )
}

function formatK(n: number): string {
  if (n >= 1000) return (n / 1000).toFixed(1) + "K"
  return String(n)
}
