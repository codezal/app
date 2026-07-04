import { useEffect, useMemo, useRef } from "react"
import {
  AlertCircle,
  Check,
  Loader2,
  X,
  XCircle,
} from "@/lib/icons"
import type { AgentCardPart, AgentCardStatus, AgentCardToolCall } from "@/lib/orchestra/types"
import { cn } from "@/lib/utils"
import { formatCount, formatDurationMs } from "@/lib/format"
import { useSessionsStore } from "@/store/sessions"
import { Identicon } from "@/lib/identicon"
import { Markdown } from "./Markdown"
import { useT } from "@/lib/i18n/useT"
import { t as tStatic, type MessageKey } from "@/lib/i18n"


// eslint-disable-next-line react-refresh/only-export-components
export function statusLabel(status: AgentCardStatus): string {
  switch (status) {
    case "pending": return tStatic("agentCard.statusPending")
    case "running": return tStatic("agentCard.statusRunning")
    case "waiting-approval": return tStatic("agentCard.statusWaitingApproval")
    case "done": return tStatic("agentCard.statusDone")
    case "error": return tStatic("agentCard.statusError")
    case "aborted": return tStatic("agentCard.statusAborted")
  }
}

// eslint-disable-next-line react-refresh/only-export-components
export function statusStyle(status: AgentCardStatus): { dot: string; text: string; bg: string } {
  switch (status) {
    case "pending":
      return { dot: "bg-codezal-mute", text: "text-codezal-mute", bg: "bg-codezal-panel-2/30" }
    case "running":
      return { dot: "bg-amber-400 animate-pulse", text: "text-amber-400", bg: "bg-amber-400/10" }
    case "waiting-approval":
      return { dot: "bg-codezal-accent", text: "text-codezal-accent", bg: "bg-codezal-accent/10" }
    case "done":
      return { dot: "bg-emerald-400", text: "text-emerald-400", bg: "bg-emerald-400/5" }
    case "error":
      return { dot: "bg-destructive", text: "text-destructive", bg: "bg-destructive/10" }
    case "aborted":
      return { dot: "bg-codezal-dim", text: "text-codezal-dim", bg: "bg-codezal-panel-2/20" }
  }
}

export function StatusIcon({ status }: { status: AgentCardStatus }) {
  switch (status) {
    case "running":
    case "pending":
      return <Loader2 className="h-4 w-4 animate-spin" />
    case "waiting-approval":
      return <AlertCircle className="h-4 w-4" />
    case "done":
      return <Check className="h-4 w-4" />
    case "error":
    case "aborted":
      return <XCircle className="h-4 w-4" />
  }
}

export function StatusPill({ status }: { status: AgentCardStatus }) {
  const style = statusStyle(status)
  return (
    <span className={cn("inline-flex items-center gap-1 text-sm", style.text)}>
      <StatusIcon status={status} />
      <span className="capitalize">{statusLabel(status)}</span>
    </span>
  )
}

// eslint-disable-next-line react-refresh/only-export-components -- pure token formatter.
export function formatTok(n: number | undefined): string {
  if (n == null) return "—"
  return formatCount(n)
}

// eslint-disable-next-line react-refresh/only-export-components -- pure duration formatter.
export function formatDuration(start: number | undefined, end: number | undefined): string {
  if (!start) return ""
  return formatDurationMs((end ?? Date.now()) - start)
}


type ToolStatus = AgentCardToolCall["status"]
export type ToolGroup = { name: string; count: number; status: ToolStatus }

function mergeStatus(a: ToolStatus, b: ToolStatus): ToolStatus {
  if (a === "running" || b === "running") return "running"
  if (a === "error" || b === "error") return "error"
  return "done"
}

// eslint-disable-next-line react-refresh/only-export-components
export function groupTools(calls: AgentCardToolCall[]): ToolGroup[] {
  const groups: ToolGroup[] = []
  for (const c of calls) {
    const last = groups[groups.length - 1]
    if (last && last.name === c.name) {
      last.count++
      last.status = mergeStatus(last.status, c.status)
    } else {
      groups.push({ name: c.name, count: 1, status: c.status })
    }
  }
  return groups
}

const TOOL_VERB: Record<string, { past: MessageKey; ing: MessageKey }> = {
  read_file: { past: "messageList.toolReadFile", ing: "messageList.toolReadFileIng" },
  list_dir: { past: "messageList.toolDir", ing: "messageList.toolDir" },
  write_file: { past: "messageList.fileCreated", ing: "messageList.fileCreated" },
  edit_file: { past: "messageList.fileChanged", ing: "messageList.fileChanged" },
  bash: { past: "messageList.toolBash", ing: "messageList.toolBash" },
  todo_write: { past: "messageList.todoUpdated", ing: "messageList.todoUpdated" },
  dispatch_workers: { past: "messageList.toolDispatchWorkers", ing: "messageList.toolDispatchWorkersIng" },
}

function toolVerb(name: string, running: boolean, tFn: (k: MessageKey) => string): string {
  const v = TOOL_VERB[name]
  if (!v) return name
  return tFn(running ? v.ing : v.past)
}

function ToolStatusIcon({ status }: { status: ToolStatus }) {
  if (status === "running") return <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-codezal-accent" />
  if (status === "error") return <XCircle className="h-3.5 w-3.5 shrink-0 text-destructive" />
  return <Check className="h-3.5 w-3.5 shrink-0 text-emerald-400" />
}

export function ToolLine({ group, tFn }: { group: ToolGroup; tFn: (k: MessageKey) => string }) {
  return (
    <div className="flex items-center gap-1.5 text-sm leading-[1.7]">
      <ToolStatusIcon status={group.status} />
      <span
        className={cn(
          "truncate",
          group.status === "running"
            ? "text-codezal-accent"
            : group.status === "error"
              ? "text-destructive"
              : "text-codezal-dim",
        )}
      >
        {group.count > 1 && <span className="text-codezal-mute">{group.count} </span>}
        {toolVerb(group.name, group.status === "running", tFn)}
      </span>
    </div>
  )
}

export function AgentTranscriptBody({ part, capped = false }: { part: AgentCardPart; capped?: boolean }) {
  const t = useT()
  const logText = (part.outputLog ?? []).join("\n")
  const toolGroups = part.toolCalls && part.toolCalls.length > 0 ? groupTools(part.toolCalls) : []
  const body = part.finalText?.trim() ? part.finalText : logText

  return (
    <div className="space-y-2">
      {toolGroups.length > 0 && (
        <div className="space-y-1">
          {toolGroups.map((g, i) => (
            <ToolLine key={i} group={g} tFn={t} />
          ))}
        </div>
      )}

      {body &&
        (capped ? (
          <pre className="max-h-[320px] overflow-auto whitespace-pre-wrap break-words rounded bg-codezal-bg/60 p-2 font-mono text-sm leading-tight text-codezal-dim">
            {body}
          </pre>
        ) : (
          <Markdown
            content={body}
            streaming={part.status === "running" || part.status === "pending"}
            className="text-sm"
          />
        ))}

      {part.status === "error" && part.errorMessage && (
        <div className="rounded border border-destructive/40 bg-destructive/10 px-2 py-1 text-sm text-destructive">
          {part.errorMessage}
        </div>
      )}
    </div>
  )
}

// eslint-disable-next-line react-refresh/only-export-components -- pure selector.
export function agentDisplayName(part: AgentCardPart): string {
  return part.displayName ?? part.workerLabel
}

export function AgentTranscriptPane({ workerId, onClose }: { workerId: string; onClose: () => void }) {
  const t = useT()
  const messages = useSessionsStore((s) => s.active?.messages)
  const part = useMemo(() => {
    for (const m of messages ?? []) {
      for (const p of m.parts ?? []) {
        if (p.type === "agent-card" && p.workerId === workerId) return p
      }
    }
    return undefined
  }, [messages, workerId])

  const name = part ? agentDisplayName(part) : ""

  const textLen = part
    ? (part.finalText?.length ?? 0) + (part.outputLog ?? []).reduce((n, s) => n + s.length, 0)
    : 0
  const toolLen = part?.toolCalls?.length ?? 0
  const status = part?.status
  const finalText = part?.finalText
  const scrollRef = useRef<HTMLDivElement>(null)
  const stick = useRef(true)
  const onScroll = () => {
    const el = scrollRef.current
    if (!el) return
    stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60
  }
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const live = status === "running" || status === "pending" || status === "waiting-approval"
    if (live) {
      el.scrollTop = el.scrollHeight
      stick.current = true
    } else {
      el.scrollTop = 0
      stick.current = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workerId])
  useEffect(() => {
    const el = scrollRef.current
    if (!el || !stick.current) return
    el.scrollTop = el.scrollHeight
  }, [textLen, toolLen, status, finalText])

  return (
    <div className="flex min-w-0 flex-1 flex-col border-l border-codezal-hair">
      <div className="flex h-[44px] shrink-0 items-center gap-2 border-b border-codezal-hair bg-codezal-sidebar px-3">
        {part ? (
          <>
            <Identicon seed={name} size={20} className="shrink-0 rounded" />
            <span className="min-w-0 flex-1 truncate text-sm font-medium text-codezal-text">{name}</span>
            {part.tokensIn != null && (
              <span className="shrink-0 text-sm text-codezal-mute" title={t("agentCard.tokensTitle")}>
                {formatTok(part.tokensIn)}↓ {formatTok(part.tokensOut)}↑
              </span>
            )}
            {part.startedAt && (
              <span className="shrink-0 text-sm text-codezal-mute">
                {formatDuration(part.startedAt, part.finishedAt)}
              </span>
            )}
            <StatusPill status={part.status} />
          </>
        ) : (
          <span className="min-w-0 flex-1 truncate text-sm text-codezal-mute">
            {t("agentCard.paneEmpty")}
          </span>
        )}
        <button
          type="button"
          onClick={onClose}
          title={t("common.close")}
          aria-label={t("common.close")}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-codezal-mute hover:bg-codezal-panel-2 hover:text-codezal-text"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {part?.task && (
        <div className="shrink-0 border-b border-codezal-hair bg-codezal-panel-2/20 px-3.5 py-2">
          <div className="mb-0.5 text-sm font-medium uppercase tracking-wide text-codezal-mute">
            {t("agentCard.taskLabel")}
          </div>
          <p
            className="line-clamp-3 whitespace-pre-wrap break-words text-sm leading-relaxed text-codezal-dim"
            title={part.task}
          >
            {part.task}
          </p>
        </div>
      )}

      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="min-h-0 flex-1 overflow-y-auto px-3.5 py-3 text-sm"
      >
        {part ? (
          <AgentTranscriptBody part={part} />
        ) : (
          <div className="py-6 text-center text-sm text-codezal-mute">{t("agentCard.paneEmpty")}</div>
        )}
      </div>
    </div>
  )
}
