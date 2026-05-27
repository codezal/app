// AgentCard — orkestra worker'ın canlı durum kartı.
// MessageList part rendering'inde "agent-card" type için bu component basılır.
// Stream sırasında store.patchAgentCard ile sürekli güncellenir.
import { useState } from "react"
import {
  AlertCircle,
  Bot,
  Check,
  ChevronRight,
  Loader2,
  Terminal,
  XCircle,
} from "lucide-react"
import type { AgentCardPart, AgentCardStatus, WorkerKind } from "@/lib/orchestra/types"
import { cn } from "@/lib/utils"
import { useT } from "@/lib/i18n/useT"
import { t as tStatic } from "@/lib/i18n"

const KIND_LABEL: Record<WorkerKind, string> = {
  sdk: "SDK",
  "claude-cli": "Claude CLI",
  "codex-cli": "Codex CLI",
  "opencode-cli": "OpenCode CLI",
}

function statusLabel(status: AgentCardStatus): string {
  switch (status) {
    case "pending": return tStatic("agentCard.statusPending")
    case "running": return tStatic("agentCard.statusRunning")
    case "waiting-approval": return tStatic("agentCard.statusWaitingApproval")
    case "done": return tStatic("agentCard.statusDone")
    case "error": return tStatic("agentCard.statusError")
    case "aborted": return tStatic("agentCard.statusAborted")
  }
}

function statusStyle(status: AgentCardStatus): {
  dot: string
  text: string
  bg: string
} {
  switch (status) {
    case "pending":
      return { dot: "bg-codezal-mute", text: "text-codezal-mute", bg: "bg-codezal-panel-2/30" }
    case "running":
      return {
        dot: "bg-codezal-accent animate-pulse",
        text: "text-codezal-accent",
        bg: "bg-codezal-accent-dim/30",
      }
    case "waiting-approval":
      return {
        dot: "bg-amber-400 animate-pulse",
        text: "text-amber-400",
        bg: "bg-amber-400/10",
      }
    case "done":
      return {
        dot: "bg-emerald-400",
        text: "text-emerald-400",
        bg: "bg-emerald-400/5",
      }
    case "error":
      return { dot: "bg-destructive", text: "text-destructive", bg: "bg-destructive/10" }
    case "aborted":
      return { dot: "bg-codezal-dim", text: "text-codezal-dim", bg: "bg-codezal-panel-2/20" }
  }
}

function StatusIcon({ status }: { status: AgentCardStatus }) {
  switch (status) {
    case "running":
    case "pending":
      return <Loader2 className="h-3 w-3 animate-spin" />
    case "waiting-approval":
      return <AlertCircle className="h-3 w-3" />
    case "done":
      return <Check className="h-3 w-3" />
    case "error":
      return <XCircle className="h-3 w-3" />
    case "aborted":
      return <XCircle className="h-3 w-3" />
  }
}

function formatTok(n: number | undefined): string {
  if (n == null) return "—"
  if (n < 1000) return String(n)
  return (n / 1000).toFixed(1) + "k"
}

function formatDuration(start: number | undefined, end: number | undefined): string {
  if (!start) return ""
  const ms = (end ?? Date.now()) - start
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

export function AgentCard({ part }: { part: AgentCardPart }) {
  const t = useT()
  const [open, setOpen] = useState(part.status === "error" || part.status === "waiting-approval")
  const style = statusStyle(part.status)
  const kindLabel = KIND_LABEL[part.kind]

  // Body — son 3 satır collapsed, full expand
  const lines = part.outputLog
  const previewLines = lines.slice(-3)
  const lastTool = part.toolCalls?.[part.toolCalls.length - 1]

  return (
    <div
      className={cn(
        "rounded-md border border-codezal text-[12px]",
        style.bg,
      )}
    >
      {/* Header */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left"
      >
        <ChevronRight
          className={cn(
            "h-3 w-3 shrink-0 text-codezal-mute transition-transform",
            open && "rotate-90",
          )}
        />
        {part.kind === "sdk" ? (
          <Bot className="h-3.5 w-3.5 shrink-0 text-codezal-accent" />
        ) : (
          <Terminal className="h-3.5 w-3.5 shrink-0 text-codezal-accent" />
        )}
        <span className="font-medium text-codezal-text">{part.workerLabel}</span>
        <span className="rounded bg-codezal-chip px-1.5 py-0.5 text-[10px] text-codezal-dim">
          {kindLabel}
        </span>
        {part.configSnapshot.yolo && (
          <span className="rounded bg-amber-400/15 px-1.5 py-0.5 text-[10px] text-amber-400">
            {t("agentCard.yolo")}
          </span>
        )}
        <span className="ml-auto flex shrink-0 items-center gap-2 text-[10.5px]">
          {part.tokensIn != null && (
            <span className="text-codezal-mute" title={t("agentCard.tokensTitle")}>
              {formatTok(part.tokensIn)}↓ {formatTok(part.tokensOut)}↑
            </span>
          )}
          {part.startedAt && (
            <span className="text-codezal-mute">
              {formatDuration(part.startedAt, part.finishedAt)}
            </span>
          )}
          <span
            className={cn("inline-flex items-center gap-1", style.text)}
          >
            <span className={cn("h-1.5 w-1.5 rounded-full", style.dot)} />
            <StatusIcon status={part.status} />
            <span className="capitalize">{statusLabel(part.status)}</span>
          </span>
        </span>
      </button>

      {/* Collapsed preview — son tool + son satırlar */}
      {!open && (lastTool || previewLines.length > 0) && (
        <div className="border-t border-codezal/60 px-2.5 py-1 text-[11px] text-codezal-dim">
          {lastTool && (
            <div className="font-mono text-codezal-mute">
              {lastTool.status === "running" ? "→" : lastTool.status === "error" ? "✗" : "✓"}{" "}
              {lastTool.name}
            </div>
          )}
          {previewLines.length > 0 && (
            <pre className="mt-0.5 max-h-[60px] overflow-hidden whitespace-pre-wrap break-words font-mono text-[10.5px] leading-tight text-codezal-mute">
              {previewLines.join("").trim().slice(0, 240)}
            </pre>
          )}
        </div>
      )}

      {/* Expanded — tüm log + tool listesi + final text/error */}
      {open && (
        <div className="space-y-2 border-t border-codezal/60 px-2.5 py-2">
          {part.toolCalls && part.toolCalls.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {part.toolCalls.map((tc, i) => (
                <span
                  key={i}
                  className={cn(
                    "inline-flex items-center gap-1 rounded border px-1.5 py-0.5 font-mono text-[10.5px]",
                    tc.status === "running"
                      ? "border-codezal-accent/40 text-codezal-accent"
                      : tc.status === "error"
                        ? "border-destructive/40 text-destructive"
                        : "border-codezal text-codezal-dim",
                  )}
                >
                  {tc.status === "running" ? (
                    <Loader2 className="h-2.5 w-2.5 animate-spin" />
                  ) : tc.status === "error" ? (
                    <XCircle className="h-2.5 w-2.5" />
                  ) : (
                    <Check className="h-2.5 w-2.5" />
                  )}
                  {tc.name}
                </span>
              ))}
            </div>
          )}

          {lines.length > 0 && (
            <pre className="max-h-[320px] overflow-auto whitespace-pre-wrap break-words rounded bg-codezal-bg/60 p-2 font-mono text-[11px] leading-tight text-codezal-dim">
              {lines.join("")}
            </pre>
          )}

          {part.status === "error" && part.errorMessage && (
            <div className="rounded border border-destructive/40 bg-destructive/10 px-2 py-1 text-[11px] text-destructive">
              {part.errorMessage}
            </div>
          )}

          {part.status === "done" && part.finalText && lines.length === 0 && (
            <pre className="whitespace-pre-wrap break-words text-[12px] text-codezal-text">
              {part.finalText}
            </pre>
          )}
        </div>
      )}
    </div>
  )
}
