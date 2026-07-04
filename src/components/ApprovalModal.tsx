import { useEffect, useRef, useState } from "react"
import { AlertTriangle, Check, FileText, ShieldCheck, X } from "@/lib/icons"
import { Dialog } from "@/components/Dialog"
import { useApprovalsStore } from "@/store/approvals"
import { useSettingsStore } from "@/store/settings"
import { useSessionsStore } from "@/store/sessions"
import { permissionKey } from "@/lib/permission-keys"
import type { SecurityFinding } from "@/lib/security/scan"
import { annotateIntraline, hunksForEdit, type DiffLine } from "@/lib/diff"
import { cn } from "@/lib/utils"
import { useT } from "@/lib/i18n/useT"
import { t as tStatic } from "@/lib/i18n"

export function ApprovalModal() {
  const t = useT()
  const queue = useApprovalsStore((s) => s.queue)
  const decide = useApprovalsStore((s) => s.decide)
  const appendProjectApproved = useApprovalsStore((s) => s.appendProjectApproved)
  const updateSettings = useSettingsStore((s) => s.update)
  const req = queue[0]
  const [tab, setTab] = useState<"detay" | "kural">("detay")
  const denyRef = useRef<HTMLButtonElement | null>(null)

  useEffect(() => {
    denyRef.current?.focus()
  }, [req?.id])

  useEffect(() => {
    if (!req) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault()
        decide(req.id, "deny")
        return
      }
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        const risky =
          checkDanger(req.tool, req.input) ||
          (req.findings?.some((f) => f.severity === "critical") ?? false)
        if (risky) return
        e.preventDefault()
        decide(req.id, "once")
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [req, decide])

  if (!req) return null

  const subj = subjectOf(req.tool, req.input)
  const permKey = permissionKey(req.tool)
  const isDangerous = checkDanger(req.tool, req.input)
  const findings = req.findings ?? []
  const hasCriticalFinding = findings.some((f) => f.severity === "critical")
  const actionLabel =
    req.tool === "edit_file"
      ? t("approvalModal.actionEdit")
      : req.tool === "write_file"
        ? t("approvalModal.actionWrite")
        : req.tool === "bash"
          ? t("approvalModal.actionBash")
          : t("approvalModal.actionGeneric")

  async function decideAndMaybeRule(d: "once" | "always" | "deny", rule?: "tool" | "subject") {
    if (rule && d === "always") {
      const newRule = {
        permission: permKey,
        pattern: rule === "subject" ? subj || "*" : "*",
        action: "allow" as const,
      }
      const st = useSessionsStore.getState()
      const session = req!.sessionId ? st.sessions[req!.sessionId] : st.active
      const wsPath = session?.workspacePath
      if (wsPath) appendProjectApproved(wsPath, newRule)
      else {
        const cur = useSettingsStore.getState().settings
        await updateSettings({ permission: [...(cur.permission ?? []), newRule] })
      }
    }
    decide(req!.id, d)
  }

  return (
    <Dialog
      role="alertdialog"
      onClose={() => {}}
      labelledById="approval-dialog-title"
      backdropClassName="z-[60]"
      panelClassName="w-[520px] overflow-hidden rounded-xl border border-codezal bg-codezal-panel shadow-2xl"
      initialFocus={denyRef}
      closeOnEscape={false}
      closeOnBackdrop={false}
    >
        <div className="flex items-center gap-2 border-b border-codezal px-3 py-2.5">
          <ShieldCheck className="h-4 w-4 text-codezal-accent" aria-hidden />
          <span id="approval-dialog-title" className="text-base font-medium text-codezal-text">{t("approvalModal.needApproval")}</span>
          {(isDangerous || hasCriticalFinding) && (
            <span className="ml-2 flex items-center gap-1 rounded bg-destructive/15 px-1.5 py-0.5 text-sm text-destructive">
              <AlertTriangle className="h-4 w-4" />
              {t("approvalModal.riskyLabel")}
            </span>
          )}
          <div className="flex-1" />
          {queue.length > 1 && (
            <span className="text-sm text-codezal-mute">{t("approvalModal.pendingMore", { count: queue.length - 1 })}</span>
          )}
        </div>

        <div className="px-3 py-3">
          {findings.length > 0 && <SecurityBanner findings={findings} />}
          <div className="mb-2 flex items-center gap-2">
            <span className="text-sm text-codezal-text">{actionLabel}</span>
            <div className="flex-1" />
            <span
              className="shrink-0 rounded bg-codezal-chip px-1.5 py-0.5 font-mono text-sm text-codezal-mute"
              title={req.tool}
            >
              {permKey}
            </span>
          </div>

          <div className="mb-3 flex rounded-md border border-codezal text-sm">
            {(["detay", "kural"] as const).map((tt) => (
              <button
                key={tt}
                type="button"
                onClick={() => setTab(tt)}
                className={cn(
                  "flex-1 px-2 py-1 capitalize",
                  tab === tt ? "bg-codezal-chip text-codezal-text" : "text-codezal-dim",
                )}
              >
                {tt === "detay" ? t("approvalModal.tabDetail") : t("approvalModal.tabRule")}
              </button>
            ))}
          </div>

          {tab === "detay" ? (
            <DetailView tool={req.tool} input={req.input} />
          ) : (
            <div className="space-y-2 text-sm text-codezal-dim">
              <p>{t("approvalModal.rulesHintLine1", { tool: permKey })}</p>
              <p>{t("approvalModal.rulesHintLine2")}</p>
            </div>
          )}
        </div>

        {queue.length > 1 && (
          <div className="border-t border-codezal bg-codezal-panel-2/40 px-3 py-2">
            <div className="mb-1.5 text-sm text-codezal-mute">
              {t("approvalModal.pendingMore", { count: queue.length - 1 })} — {t("approvalModal.decideEach")}
            </div>
            <div className="max-h-[160px] space-y-1 overflow-y-auto">
              {queue.slice(1).map((q) => {
                const qCritical = q.findings?.some((f) => f.severity === "critical") ?? false
                const qRisky = qCritical || checkDanger(q.tool, q.input)
                return (
                  <div
                    key={q.id}
                    className="flex items-center gap-2 rounded bg-codezal-panel px-2 py-1 text-sm"
                  >
                    {qRisky && (
                      <AlertTriangle
                        className="h-3.5 w-3.5 shrink-0 text-destructive"
                        aria-label={t("approvalModal.riskyLabel")}
                      />
                    )}
                    <span className="shrink-0 font-mono text-sm text-codezal-dim">{q.tool}</span>
                    <span className="min-w-0 flex-1 truncate text-codezal-mute" title={subjectOf(q.tool, q.input)}>
                      {subjectOf(q.tool, q.input)}
                    </span>
                    <button
                      type="button"
                      onClick={() => decide(q.id, "once")}
                      disabled={qCritical}
                      title={qCritical ? t("approvalModal.reviewInDetail") : t("approvalModal.allow")}
                      aria-label={qCritical ? t("approvalModal.reviewInDetail") : t("approvalModal.allow")}
                      className={cn(
                        "flex h-6 w-6 items-center justify-center rounded",
                        qCritical
                          ? "cursor-not-allowed text-codezal-mute opacity-40"
                          : "text-codezal-accent hover:bg-codezal-accent/10",
                      )}
                    >
                      <Check className="h-4 w-4" aria-hidden />
                    </button>
                    <button
                      type="button"
                      onClick={() => decide(q.id, "deny")}
                      title={t("approvalModal.deny")}
                      aria-label={t("approvalModal.deny")}
                      className="flex h-6 w-6 items-center justify-center rounded text-codezal-dim hover:bg-destructive/10 hover:text-destructive"
                    >
                      <X className="h-4 w-4" aria-hidden />
                    </button>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-codezal px-3 py-2.5">
          <button
            ref={denyRef}
            type="button"
            onClick={() => decideAndMaybeRule("deny")}
            className="flex items-center gap-1 rounded-md border border-codezal px-2.5 py-1.5 text-sm text-codezal-dim hover:border-destructive/40 hover:text-destructive"
          >
            <X className="h-4 w-4" aria-hidden /> {t("approvalModal.deny")}
          </button>
          {subj && (
            <button
              type="button"
              onClick={() => void decideAndMaybeRule("always", "subject")}
              className="rounded-md border border-codezal px-2.5 py-1.5 text-sm text-codezal-dim hover:border-codezal-strong hover:text-codezal-text"
              title={t("approvalModal.btnPatternTitle", { pattern: subj.slice(0, 40) })}
            >
              {t("approvalModal.btnPatternAllow")}
            </button>
          )}
          <button
            type="button"
            onClick={() => void decideAndMaybeRule("always", "tool")}
            className="rounded-md border border-codezal px-2.5 py-1.5 text-sm text-codezal-dim hover:border-codezal-strong hover:text-codezal-text"
            title={t("approvalModal.btnAllToolTitle", { tool: permKey })}
          >
            {t("approvalModal.btnAllToolAllow", { tool: permKey })}
          </button>
          <button
            type="button"
            onClick={() => void decideAndMaybeRule("once")}
            className="flex items-center gap-1 rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-foreground hover:bg-accent/90"
          >
            <Check className="h-4 w-4" aria-hidden /> {t("approvalModal.allow")}
          </button>
        </div>
    </Dialog>
  )
}

// Pre-write security scan banner — lists leaked-credential and risky-pattern
// findings surfaced before the write touches disk. A critical finding is what
// forced this modal open even in bypass/auto-review mode (escalation); warnings
// are informational. Secret values arrive already masked from scan.ts.
function SecurityBanner({ findings }: { findings: SecurityFinding[] }) {
  const hasCrit = findings.some((f) => f.severity === "critical")
  // Content (scan) findings carry a 1-based line; destination (path-class)
  // findings use line 0. The "remove the secret" hint only applies to the former.
  const hasSecret = findings.some((f) => f.severity === "critical" && f.line > 0)
  return (
    <div
      className={cn(
        "mb-3 rounded-md border px-3 py-2",
        hasCrit
          ? "border-destructive/40 bg-destructive/10"
          : "border-codezal-accent/40 bg-codezal-accent/10",
      )}
    >
      <div className="mb-1.5 flex items-center gap-1.5 text-sm font-medium">
        <AlertTriangle
          className={cn("h-4 w-4", hasCrit ? "text-destructive" : "text-codezal-accent")}
        />
        <span className={hasCrit ? "text-destructive" : "text-codezal-accent"}>
          {tStatic("approvalModal.securityHeading")}
        </span>
      </div>
      <ul className="space-y-1.5">
        {findings.map((f, idx) => (
          <li key={idx} className="text-sm">
            <div className="flex flex-wrap items-center gap-1.5">
              <span
                className={cn(
                  "rounded px-1 py-0.5 font-mono text-sm uppercase tracking-wide",
                  f.severity === "critical"
                    ? "bg-destructive/20 text-destructive"
                    : "bg-codezal-accent/20 text-codezal-accent",
                )}
              >
                {f.severity === "critical"
                  ? tStatic("approvalModal.securityCriticalLabel")
                  : tStatic("approvalModal.securityWarningLabel")}
              </span>
              <span className="text-codezal-text">{f.message}</span>
              {f.line > 0 && (
                <span className="text-codezal-mute">
                  · {tStatic("approvalModal.securityLine", { line: f.line })}
                </span>
              )}
            </div>
            <code className="mt-0.5 block whitespace-pre-wrap break-all rounded bg-codezal-code px-1.5 py-0.5 font-mono text-codezal-dim">
              {f.excerpt}
            </code>
          </li>
        ))}
      </ul>
      {hasSecret && (
        <p className="mt-1.5 text-sm text-destructive/90">
          {tStatic("approvalModal.securitySecretHint")}
        </p>
      )}
    </div>
  )
}

function subjectOf(tool: string, input: unknown): string {
  const i = (input as Record<string, unknown>) ?? {}
  if (tool === "bash") return String(i.command ?? "")
  if (typeof i.path === "string") return i.path
  return ""
}

function DetailView({ tool, input }: { tool: string; input: unknown }) {
  const i = (input as Record<string, unknown>) ?? {}

  if (tool === "edit_file") {
    const path = String(i.path ?? "")
    const oldStr = String(i.old_string ?? "")
    const newStr = String(i.new_string ?? "")
    const hunks = hunksForEdit(oldStr, newStr)
    const added = hunks.filter((h) => h.kind === "add").length
    const removed = hunks.filter((h) => h.kind === "del").length
    return (
      <div className="max-h-[320px] overflow-auto rounded-md border border-codezal-strong bg-codezal-code">
        <div className="sticky top-0 z-10 flex items-center gap-2 border-b border-codezal bg-codezal-panel-2/80 px-3 py-1.5 text-sm backdrop-blur">
          <FileText className="h-4 w-4 text-codezal-mute" />
          <span className="font-mono text-codezal-text">{path}</span>
          {added > 0 && <span className="text-codezal-diff-add">{tStatic("approvalModal.addedLabel", { n: added })}</span>}
          {removed > 0 && <span className="text-codezal-diff-del">{tStatic("approvalModal.removedLabel", { n: removed })}</span>}
        </div>
        <UnifiedDiff lines={hunks} />
      </div>
    )
  }

  if (tool === "write_file") {
    const path = String(i.path ?? "")
    const content = String(i.content ?? "")
    const lines = content.split(/\r?\n/)
    const preview = lines.slice(0, 30).join("\n")
    const more = Math.max(0, lines.length - 30)
    return (
      <div className="max-h-[320px] overflow-auto rounded-md border border-codezal-strong bg-codezal-code">
        <div className="sticky top-0 z-10 flex items-center gap-2 border-b border-codezal bg-codezal-panel-2/80 px-3 py-1.5 text-sm backdrop-blur">
          <FileText className="h-4 w-4 text-codezal-mute" />
          <span className="font-mono text-codezal-text">{path}</span>
          <span className="text-codezal-mute">{tStatic("approvalModal.newFileLabel", { count: content.length })}</span>
        </div>
        <pre className="m-0 whitespace-pre-wrap px-3 py-2 font-mono text-sm leading-[1.6] text-codezal-text">
          {preview}
          {more > 0 && `\n${tStatic("approvalModal.moreLines", { count: more })}`}
        </pre>
      </div>
    )
  }

  if (tool === "bash") {
    const cmd = String(i.command ?? "")
    return (
      <div className="overflow-hidden rounded-md border border-codezal-strong bg-codezal-code">
        <div className="border-b border-codezal bg-codezal-panel-2/80 px-3 py-1.5 text-sm uppercase tracking-[0.08em] text-codezal-mute">
          {tStatic("approvalModal.commandLabel")}
        </div>
        <pre className="m-0 max-h-[260px] overflow-auto whitespace-pre-wrap px-3 py-2 font-mono text-sm leading-[1.65] text-codezal-text">
          <span className="text-codezal-mute">$ </span>
          {cmd}
        </pre>
      </div>
    )
  }

  return (
    <pre className="m-0 max-h-[260px] overflow-auto whitespace-pre-wrap rounded-md border border-codezal-strong bg-codezal-code px-3 py-2 font-mono text-sm leading-[1.6] text-codezal-text">
      {JSON.stringify(input, null, 2)}
    </pre>
  )
}

// Unified diff render — referanstaki GitHub stili.
function UnifiedDiff({ lines }: { lines: DiffLine[] }) {
  if (lines.length === 0) {
    return (
      <div className="px-3 py-3 text-sm text-codezal-mute">{tStatic("approvalModal.diffEmpty")}</div>
    )
  }
  return (
    <div className="font-mono text-sm leading-[1.65]">
      {annotateIntraline(lines).map((l, idx) => {
        const isAdd = l.kind === "add"
        const isDel = l.kind === "del"
        const isCtx = l.kind === "ctx"
        return (
          <div
            key={idx}
            className={cn(
              "grid grid-cols-[28px_1fr] items-start",
              isAdd && "bg-codezal-diff-add",
              isDel && "bg-codezal-diff-del",
            )}
          >
            <span
              className={cn(
                "select-none border-r border-codezal/40 px-2 text-center",
                isAdd && "text-codezal-diff-add",
                isDel && "text-codezal-diff-del",
                isCtx && "text-codezal-mute",
              )}
            >
              {isAdd ? "+" : isDel ? "-" : " "}
            </span>
            <span
              className={cn(
                "whitespace-pre-wrap break-all px-3",
                isAdd && "text-codezal-diff-add",
                isDel && "text-codezal-diff-del",
                isCtx && "text-codezal-text",
              )}
            >
              {l.segs
                ? l.segs.map((s, si) => (
                    <span key={si} className={s.changed ? "font-semibold" : "opacity-55"}>
                      {s.text}
                    </span>
                  ))
                : l.text || " "}
            </span>
          </div>
        )
      })}
    </div>
  )
}

function checkDanger(tool: string, input: unknown): boolean {
  if (tool !== "bash") return false
  const cmd = String((input as { command?: string }).command ?? "")
  return /(\brm\s+-rf|\bsudo\b|\bmkfs\b|\bdd\s+if=|\bchmod\s+777|:\s*\(\s*\)\s*\{|\bcurl\s+.*\|\s*sh)/.test(cmd)
}
