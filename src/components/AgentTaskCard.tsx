// opencode-style task card for a parallel subagent run. One card per agent in
// the parent timeline: agent name as the title, the short task description as
// the subtitle, an agent-toned status glyph, and a click target that opens the
// child worker session transcript. The subagent's raw output is intentionally
// not rendered inline (opencode parity) — the result goes to the parent model.
import type { CSSProperties, KeyboardEvent } from "react"
import { AlertCircle, Check, ExternalLink, Loader2, XCircle } from "@/lib/icons"
import type { AgentCardPart, AgentCardStatus } from "@/lib/orchestra/types"
import { useSessionsStore } from "@/store/sessions"
import { cn } from "@/lib/utils"
import { useT } from "@/lib/i18n/useT"

// Known roles/agents get a fixed accent; everything else hashes into a stable
// palette so each agent keeps a consistent color across runs (opencode tones).
const AGENT_TONES: Record<string, string> = {
  orchestrator: "#818cf8",
  planner: "#fbbf24",
  worker: "#38bdf8",
  reviewer: "#34d399",
  small: "#a78bfa",
}
const AGENT_PALETTE = [
  "#818cf8",
  "#34d399",
  "#fbbf24",
  "#f472b6",
  "#38bdf8",
  "#a78bfa",
  "#fb923c",
  "#4ade80",
  "#f87171",
  "#22d3ee",
]

function agentTone(name: string): string {
  const key = name.toLowerCase()
  const fixed = AGENT_TONES[key]
  if (fixed) return fixed
  let hash = 0
  for (const ch of key) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0
  return AGENT_PALETTE[hash % AGENT_PALETTE.length]
}

// Explicit agentColor wins when it already looks like a CSS color; otherwise
// the value (or the agent name) is hashed into the palette.
function resolveTone(color: string | undefined, name: string): string {
  const c = color?.trim()
  if (c && /^(#|rgb|hsl|var\()/.test(c)) return c
  return agentTone(c || name)
}

function statusLabelKey(status: AgentCardStatus):
  | "agentCard.statusPending"
  | "agentCard.statusRunning"
  | "agentCard.statusWaitingApproval"
  | "agentCard.statusDone"
  | "agentCard.statusError"
  | "agentCard.statusAborted" {
  switch (status) {
    case "pending":
      return "agentCard.statusPending"
    case "running":
      return "agentCard.statusRunning"
    case "waiting-approval":
      return "agentCard.statusWaitingApproval"
    case "done":
      return "agentCard.statusDone"
    case "error":
      return "agentCard.statusError"
    case "aborted":
      return "agentCard.statusAborted"
  }
}

function StatusGlyph({ status, tone }: { status: AgentCardStatus; tone: string }) {
  switch (status) {
    case "pending":
    case "running":
      return <Loader2 className="h-4 w-4 shrink-0 animate-spin" style={{ color: tone }} aria-hidden />
    case "waiting-approval":
      return <AlertCircle className="h-4 w-4 shrink-0" style={{ color: tone }} aria-hidden />
    case "done":
      return <Check className="h-4 w-4 shrink-0 text-emerald-400" aria-hidden />
    case "error":
      return <XCircle className="h-4 w-4 shrink-0 text-destructive" aria-hidden />
    case "aborted":
      return <XCircle className="h-4 w-4 shrink-0 text-codezal-dim" aria-hidden />
  }
}

export function AgentTaskCard({ card }: { card: AgentCardPart }) {
  const t = useT()
  const name = card.agentType ?? card.displayName ?? card.workerLabel
  const tone = resolveTone(card.agentColor, name)
  const subtitle = card.description ?? card.task ?? ""
  const clickable = Boolean(card.workerSessionId)

  const open = () => {
    const sid = card.workerSessionId
    if (!sid) return
    const st = useSessionsStore.getState()
    // Worker sessions are transient: they are removed when the run completes.
    // When the session still exists, open its transcript in the main chat.
    // Otherwise fall back to the right-hand agent pane, which renders the
    // card's own summary/final text — the record of the finished run.
    const alive = !!st.sessions[sid] || st.index.some((m) => m.id === sid)
    if (alive) {
      void st.open(sid)
    } else {
      window.dispatchEvent(
        new CustomEvent("codezal:open-agent-pane", { detail: { workerId: card.workerId } }),
      )
    }
  }
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!clickable) return
    if (e.key !== "Enter" && e.key !== " ") return
    e.preventDefault()
    open()
  }

  return (
    <div
      role={clickable ? "link" : undefined}
      tabIndex={clickable ? 0 : undefined}
      aria-label={clickable ? `${name}: ${t("agentCard.openSession")}` : undefined}
      onClick={clickable ? open : undefined}
      onKeyDown={onKeyDown}
      style={{ "--agent-tone": tone } as CSSProperties}
      className={cn(
        "group flex items-center gap-2.5 rounded-xl border border-codezal-hair bg-codezal-sidebar px-3 py-2 transition-colors",
        clickable && "cursor-pointer hover:bg-codezal-chip/40 focus:outline-none focus-visible:ring-1 focus-visible:ring-codezal-accent",
      )}
    >
      <StatusGlyph status={card.status} tone={tone} />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="truncate text-md font-semibold" style={{ color: tone }}>
            {name}
          </span>
          {subtitle && (
            <span className="min-w-0 truncate text-sm text-codezal-mute">{subtitle}</span>
          )}
        </div>
        <div className="text-sm text-codezal-dim">{t(statusLabelKey(card.status))}</div>
      </div>
      {clickable && (
        <ExternalLink
          className="h-3.5 w-3.5 shrink-0 text-codezal-dim opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
          aria-hidden
        />
      )}
    </div>
  )
}
