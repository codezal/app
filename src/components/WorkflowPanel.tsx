import { useState } from "react"
import { ChevronRight } from "@/lib/icons"
import { cn } from "@/lib/utils"
import { useT } from "@/lib/i18n/useT"
import {
  useWorkflowsStore,
  type WorkflowRun,
  type WorkflowAgentCard,
} from "@/store/workflows"
import { StatusPill, formatTok, formatDuration, groupTools, ToolLine } from "./AgentTranscript"

export function WorkflowPanel({ onClose }: { onClose: () => void }) {
  const t = useT()
  const runs = useWorkflowsStore((s) => s.runs)
  const abort = useWorkflowsStore((s) => s.abort)
  const list = Object.values(runs).sort((a, b) => b.startedAt - a.startedAt)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const selected = list.find((r) => r.runId === selectedId) ?? list[0]

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-black/30" onClick={onClose}>
      <div
        className="flex h-full w-[440px] max-w-[90vw] flex-col border-l border-codezal bg-codezal-panel shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex h-11 items-center justify-between border-b border-codezal-hair px-3.5">
          <span className="text-md font-semibold text-codezal-text">{t("workflowPanel.title")}</span>
          <button
            type="button"
            onClick={onClose}
            className="rounded px-2 py-0.5 text-sm text-codezal-mute hover:bg-codezal-panel-2 hover:text-codezal-text"
          >
            {t("common.close")}
          </button>
        </div>

        {list.length === 0 ? (
          <div className="flex flex-1 items-center justify-center px-6 text-center text-sm text-codezal-mute">
            {t("workflowPanel.empty")}
          </div>
        ) : (
          <>
            {list.length > 1 && (
              <div className="flex flex-wrap gap-1.5 border-b border-codezal/60 px-3 py-2">
                {list.map((r) => (
                  <button
                    key={r.runId}
                    type="button"
                    onClick={() => setSelectedId(r.runId)}
                    className={cn(
                      "rounded-md border px-2 py-1 text-sm",
                      (selected?.runId === r.runId)
                        ? "border-codezal-accent/50 bg-codezal-accent/10 text-codezal-text"
                        : "border-codezal text-codezal-mute hover:border-codezal-accent/30",
                    )}
                  >
                    {r.name}
                  </button>
                ))}
              </div>
            )}
            {selected && (
              <RunView run={selected} onAbort={() => abort(selected.runId)} />
            )}
          </>
        )}
      </div>
    </div>
  )
}

function RunView({ run, onAbort }: { run: WorkflowRun; onAbort: () => void }) {
  const t = useT()
  let tokOut = 0
  for (const a of run.agents) tokOut += a.tokensOut ?? 0
  const duration = formatDuration(run.startedAt, run.finishedAt)

  const grouped = new Map<string, WorkflowAgentCard[]>()
  for (const a of run.agents) {
    const k = a.phase || "(faz yok)"
    const arr = grouped.get(k) ?? []
    arr.push(a)
    grouped.set(k, arr)
  }
  const phaseKeys = [
    ...new Set([...run.phases.map((p) => p.title), ...grouped.keys()]),
  ].filter((k) => grouped.has(k) || run.phases.some((p) => p.title === k))

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="border-b border-codezal/60 px-3 py-2">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium text-codezal-text">{run.name}</span>
          <span className="ml-auto shrink-0">
            <StatusPill status={runStatusToCard(run.status)} />
          </span>
        </div>
        {run.description && (
          <p className="mt-0.5 text-sm text-codezal-mute">{run.description}</p>
        )}
        <div className="mt-1 flex items-center gap-3 text-sm text-codezal-dim">
          <span>{run.agents.length} {t("workflowPanel.agents")}</span>
          <span>{run.phases.length} {t("workflowPanel.phases")}</span>
          <span>{formatTok(tokOut)}↑ token</span>
          {duration && <span>{duration}</span>}
          {run.status === "running" && (
            <button
              type="button"
              onClick={onAbort}
              className="ml-auto rounded px-1.5 py-0.5 text-sm text-destructive hover:bg-destructive/10"
            >
              {t("workflowPanel.stop")}
            </button>
          )}
        </div>
      </div>

      {/* Faz faz agent listesi */}
      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
        {phaseKeys.length === 0 && (
          <p className="px-2 py-4 text-center text-sm text-codezal-mute">
            {t("workflowPanel.starting")}
          </p>
        )}
        {phaseKeys.map((phase) => {
          const agents = grouped.get(phase) ?? []
          return (
            <div key={phase} className="mb-3">
              <div className="mb-1 flex items-center gap-2 px-1">
                <span className="text-sm font-semibold uppercase tracking-wide text-codezal-dim">
                  {phase}
                </span>
                <span className="text-sm text-codezal-mute">{agents.length}</span>
              </div>
              <div className="flex flex-col gap-1.5">
                {agents.map((a) => (
                  <WorkflowAgentRow key={a.agentId} card={a} />
                ))}
              </div>
            </div>
          )
        })}

        {run.status === "done" && run.result && (
          <div className="mt-2 rounded-md border border-emerald-400/20 bg-emerald-400/5 px-2.5 py-2">
            <div className="mb-1 text-sm font-semibold text-codezal-text">{t("workflowPanel.result")}</div>
            <pre className="max-h-[200px] overflow-auto whitespace-pre-wrap break-words font-mono text-sm text-codezal-mute">
              {run.result}
            </pre>
          </div>
        )}
        {run.status === "error" && (
          <div className="mt-2 rounded-md border border-destructive/30 bg-destructive/10 px-2.5 py-2 text-sm text-codezal-text">
            {t("workflowPanel.error")}: {run.error}
          </div>
        )}
      </div>
    </div>
  )
}

function WorkflowAgentRow({ card }: { card: WorkflowAgentCard }) {
  const t = useT()
  const [open, setOpen] = useState(card.status === "error")
  const toolGroups = card.toolCalls.length > 0 ? groupTools(card.toolCalls) : []

  return (
    <div className={cn("rounded-md border border-codezal text-sm", rowBg(card.status))}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left"
      >
        <ChevronRight
          className={cn(
            "h-3.5 w-3.5 shrink-0 text-codezal-mute transition-transform",
            open && "rotate-90",
          )}
        />
        <span className="truncate font-medium text-codezal-text">{card.label}</span>
        <span className="ml-auto flex shrink-0 items-center gap-2 text-sm text-codezal-mute">
          {card.tokensOut != null && <span>{formatTok(card.tokensOut)}↑</span>}
          {card.toolCalls.length > 0 && <span>{card.toolCalls.length} {t("workflowPanel.tools")}</span>}
          {card.startedAt && <span>{formatDuration(card.startedAt, card.finishedAt)}</span>}
          <StatusPill status={card.status} />
        </span>
      </button>
      {open && (
        <div className="border-t border-codezal/60 px-2.5 py-2">
          <p className="mb-1.5 text-sm text-codezal-dim">{card.task}</p>
          {toolGroups.length > 0 && (
            <div className="mb-1.5 flex flex-col gap-0.5">
              {toolGroups.map((g, i) => (
                <ToolLine key={i} group={g} tFn={t} />
              ))}
            </div>
          )}
          {card.finalText && (
            <pre className="max-h-[160px] overflow-auto whitespace-pre-wrap break-words font-mono text-sm leading-tight text-codezal-mute">
              {card.finalText.slice(0, 1200)}
            </pre>
          )}
          {card.errorMessage && (
            <p className="text-sm text-destructive">{card.errorMessage}</p>
          )}
        </div>
      )}
    </div>
  )
}

function runStatusToCard(s: WorkflowRun["status"]): WorkflowAgentCard["status"] {
  switch (s) {
    case "running": return "running"
    case "done": return "done"
    case "error": return "error"
    case "cancelled": return "aborted"
  }
}

function rowBg(status: WorkflowAgentCard["status"]): string {
  switch (status) {
    case "pending": return "bg-codezal-panel-2/30"
    case "running": return "bg-amber-400/10"
    case "waiting-approval": return "bg-codezal-accent/10"
    case "done": return "bg-emerald-400/5"
    case "error": return "bg-destructive/10"
    case "aborted": return "bg-codezal-panel-2/20"
  }
}
