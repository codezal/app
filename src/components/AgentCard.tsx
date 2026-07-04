import { useEffect, useState } from "react"
import { ChevronRight, PanelRight } from "@/lib/icons"
import type { AgentCardPart, WorkerKind } from "@/lib/orchestra/types"
import { cn } from "@/lib/utils"
import { Identicon } from "@/lib/identicon"
import { useT } from "@/lib/i18n/useT"
import {
  AgentTranscriptBody,
  StatusPill,
  ToolLine,
  agentDisplayName,
  formatDuration,
  formatTok,
  groupTools,
} from "./AgentTranscript"

const KIND_LABEL: Record<WorkerKind, string> = {
  sdk: "Ajan",
  "claude-cli": "Claude CLI",
  "codex-cli": "Codex CLI",
  "opencode-cli": "OpenCode CLI",
  "kimi-cli": "Kimi CLI",
  "gemini-cli": "Gemini CLI",
  acp: "ACP",
}

function openAgentPane(workerId: string) {
  if (typeof window === "undefined") return
  window.dispatchEvent(
    new CustomEvent("codezal:open-agent-pane", { detail: { workerId } }),
  )
}

export function AgentCard({ part, compact = false }: { part: AgentCardPart; compact?: boolean }) {
  const t = useT()
  const [open, setOpen] = useState(part.status === "error" || part.status === "waiting-approval")
  useEffect(() => {
    if (part.status !== "error" && part.status !== "waiting-approval") return
    const id = setTimeout(() => setOpen(true), 0)
    return () => clearTimeout(id)
  }, [part.status])
  const style = statusStyleBg(part.status)
  const kindLabel = KIND_LABEL[part.kind]
  const name = agentDisplayName(part)
  const duration = part.startedAt ? formatDuration(part.startedAt, part.finishedAt) : ""

  if (compact) {
    return (
      <button
        type="button"
        onClick={() => openAgentPane(part.workerId)}
        title={t("agentCard.openInPane")}
        className={cn(
          "flex w-full items-center gap-2 rounded-md border border-codezal px-2.5 py-2 text-left hover:border-codezal-accent/40",
          style,
        )}
      >
        <Identicon seed={name} size={20} className="shrink-0 rounded" />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-sm font-medium text-codezal-text">{name}</span>
          <span className="truncate text-sm text-codezal-mute">
            {kindLabel}
            {duration && ` · ${duration}`}
          </span>
        </span>
        <StatusPill status={part.status} />
        <PanelRight className="h-3.5 w-3.5 shrink-0 text-codezal-mute" />
      </button>
    )
  }

  const previewLines = (part.outputLog ?? []).slice(-3)
  const toolGroups = part.toolCalls && part.toolCalls.length > 0 ? groupTools(part.toolCalls) : []
  const lastGroup = toolGroups[toolGroups.length - 1]

  return (
    <div className={cn("rounded-md border border-codezal text-sm", style)}>
      <div className="flex items-center gap-2 px-2.5 py-1.5">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
        >
          <ChevronRight
            className={cn("h-4 w-4 shrink-0 text-codezal-mute transition-transform", open && "rotate-90")}
          />
          <Identicon seed={name} size={18} className="shrink-0 rounded" />
          <span className="truncate font-medium text-codezal-text">{name}</span>
          <span className="shrink-0 rounded bg-codezal-chip px-1.5 py-0.5 text-sm text-codezal-dim">
            {kindLabel}
          </span>
          {part.configSnapshot.yolo && (
            <span className="shrink-0 rounded bg-codezal-accent/15 px-1.5 py-0.5 text-sm text-codezal-accent">
              {t("agentCard.yolo")}
            </span>
          )}
        </button>
        <span className="ml-auto flex shrink-0 items-center gap-2 text-sm">
          {part.tokensIn != null && (
            <span className="text-codezal-mute" title={t("agentCard.tokensTitle")}>
              {formatTok(part.tokensIn)}↓ {formatTok(part.tokensOut)}↑
            </span>
          )}
          {part.startedAt && (
            <span className="text-codezal-mute">{formatDuration(part.startedAt, part.finishedAt)}</span>
          )}
          <StatusPill status={part.status} />
          <button
            type="button"
            onClick={() => openAgentPane(part.workerId)}
            title={t("agentCard.openInPane")}
            className="flex h-6 w-6 items-center justify-center rounded text-codezal-mute hover:bg-codezal-panel-2 hover:text-codezal-text"
          >
            <PanelRight className="h-3.5 w-3.5" />
          </button>
        </span>
      </div>

      {!open && (lastGroup || previewLines.length > 0) && (
        <div className="border-t border-codezal/60 px-2.5 py-1 text-sm text-codezal-dim">
          {lastGroup && <ToolLine group={lastGroup} tFn={t} />}
          {previewLines.length > 0 && (
            <pre className="mt-0.5 max-h-[60px] overflow-hidden whitespace-pre-wrap break-words font-mono text-sm leading-tight text-codezal-mute">
              {previewLines.join("\n").trim().slice(0, 240)}
            </pre>
          )}
        </div>
      )}

      {open && (
        <div className="border-t border-codezal/60 px-2.5 py-2">
          <AgentTranscriptBody part={part} capped />
        </div>
      )}
    </div>
  )
}

function statusStyleBg(status: AgentCardPart["status"]): string {
  switch (status) {
    case "pending": return "bg-codezal-panel-2/30"
    case "running": return "bg-amber-400/10"
    case "waiting-approval": return "bg-codezal-accent/10"
    case "done": return "bg-emerald-400/5"
    case "error": return "bg-destructive/10"
    case "aborted": return "bg-codezal-panel-2/20"
  }
}
