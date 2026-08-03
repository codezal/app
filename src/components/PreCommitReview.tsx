// Presentational dialogs for the pre-commit / pre-push code review gate.
//
// The driving hook lives in lib/use-commit-review.tsx (kept separate so this file
// only exports components, as react-refresh requires). See lib/git-review.ts for
// the review engine itself.
import { AlertTriangle, CheckCircle2, Info, Loader2, ShieldAlert, Sparkles } from "@/lib/icons"
import { Dialog } from "@/components/Dialog"
import type {
  ReviewCategory,
  ReviewFinding,
  ReviewResult,
  ReviewSeverity,
} from "@/lib/git-review"
import { cn } from "@/lib/utils"
import { useT } from "@/lib/i18n/useT"

export type GateMode = "commit" | "push" | "turn"
export type GateVerdict = "proceed" | "abort"

const SEVERITY_STYLE: Record<ReviewSeverity, string> = {
  critical: "border-destructive/40 bg-destructive/10 text-destructive",
  warning: "border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400",
  info: "border-sky-500/40 bg-sky-500/10 text-sky-600 dark:text-sky-400",
}

function SeverityIcon({ severity, className }: { severity: ReviewSeverity; className?: string }) {
  if (severity === "critical") return <ShieldAlert className={className} aria-hidden />
  if (severity === "warning") return <AlertTriangle className={className} aria-hidden />
  return <Info className={className} aria-hidden />
}

export function ReviewingDialog({ title, onCancel }: { title: string; onCancel: () => void }) {
  const t = useT()
  return (
    <Dialog
      onClose={onCancel}
      labelledById="review-reviewing-title"
      backdropClassName="z-[60]"
      panelClassName="w-[360px] max-w-[92vw] overflow-hidden rounded-xl border border-codezal bg-codezal-panel shadow-2xl"
    >
      <div className="flex items-center gap-3 p-4">
        <Loader2 className="h-5 w-5 shrink-0 animate-spin text-codezal-accent" aria-hidden />
        <div className="min-w-0">
          <h2 id="review-reviewing-title" className="text-sm font-semibold text-codezal-text">
            {title}
          </h2>
          <p className="text-xs text-codezal-mute">{t("codeReview.reviewing")}</p>
        </div>
      </div>
      <div className="flex justify-end border-t border-codezal px-4 py-3">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md px-3 py-1.5 text-sm text-codezal-dim transition-colors hover:bg-codezal-panel-2 hover:text-codezal-text"
        >
          {t("codeReview.cancel")}
        </button>
      </div>
    </Dialog>
  )
}

export function ReviewResultsDialog({
  mode,
  result,
  blocking,
  onProceed,
  onAbort,
  onFixWithAI,
}: {
  mode: GateMode
  result: ReviewResult
  blocking: boolean
  onProceed: () => void
  onAbort: () => void
  onFixWithAI?: () => void
}) {
  const t = useT()
  const severityLabel: Record<ReviewSeverity, string> = {
    critical: t("codeReview.severityCritical"),
    warning: t("codeReview.severityWarning"),
    info: t("codeReview.severityInfo"),
  }
  const categoryLabel: Record<ReviewCategory, string> = {
    bug: t("codeReview.categoryBug"),
    security: t("codeReview.categorySecurity"),
    performance: t("codeReview.categoryPerformance"),
    complexity: t("codeReview.categoryComplexity"),
    style: t("codeReview.categoryStyle"),
  }
  const title =
    mode === "commit"
      ? t("codeReview.titleCommit")
      : mode === "push"
        ? t("codeReview.titlePush")
        : t("codeReview.titleTurn")
  // A warning/critical finding the user is about to ship past — the proceed
  // button must make clear the commit will include unresolved findings.
  const hasActionable = result.findings.some(
    (f) => f.severity === "critical" || f.severity === "warning",
  )
  // A turn review is informational — it gates no git operation — so its action
  // button is a plain "Dismiss" regardless of findings.
  const proceedLabel =
    mode === "turn"
      ? t("codeReview.dismiss")
      : blocking
        ? mode === "commit"
          ? t("codeReview.commitAnyway")
          : t("codeReview.pushAnyway")
        : hasActionable
          ? mode === "commit"
            ? t("codeReview.proceedWithFindingsCommit")
            : t("codeReview.proceedWithFindingsPush")
          : t("codeReview.continue")

  return (
    <Dialog
      role="alertdialog"
      onClose={onAbort}
      labelledById="review-results-title"
      backdropClassName="z-[60]"
      panelClassName="w-[560px] max-w-[92vw] overflow-hidden rounded-xl border border-codezal bg-codezal-panel shadow-2xl"
    >
      <div className="flex items-center gap-3 border-b border-codezal p-4">
        <div
          className={cn(
            "flex h-9 w-9 shrink-0 items-center justify-center rounded-full",
            blocking
              ? "bg-destructive/10 text-destructive"
              : "bg-codezal-accent/10 text-codezal-accent",
          )}
        >
          {blocking ? (
            <ShieldAlert className="h-5 w-5" aria-hidden />
          ) : (
            <CheckCircle2 className="h-5 w-5" aria-hidden />
          )}
        </div>
        <h2 id="review-results-title" className="text-sm font-semibold text-codezal-text">
          {title}
        </h2>
      </div>

      <div className="max-h-[50vh] overflow-y-auto p-4">
        {result.summary && (
          <p className="mb-3 text-xs leading-relaxed text-codezal-mute">
            <span className="font-semibold text-codezal-dim">{t("codeReview.summaryLabel")}: </span>
            {result.summary}
          </p>
        )}
        {blocking && (
          <p className="mb-3 rounded-md border border-destructive/30 bg-destructive/10 px-2.5 py-2 text-xs leading-relaxed text-destructive">
            {t("codeReview.blockedHint")}
          </p>
        )}
        {hasActionable && !blocking && mode !== "turn" && (
          <p className="mb-3 rounded-md border border-amber-500/30 bg-amber-500/10 px-2.5 py-2 text-xs leading-relaxed text-amber-600 dark:text-amber-400">
            {t("codeReview.proceedHint")}
          </p>
        )}
        <ul className="flex flex-col gap-2">
          {result.findings.map((f: ReviewFinding, i: number) => (
            <li
              key={i}
              className={cn(
                "rounded-md border px-2.5 py-2 text-xs leading-relaxed",
                SEVERITY_STYLE[f.severity],
              )}
            >
              <div className="mb-1 flex flex-wrap items-center gap-1.5 font-semibold">
                <SeverityIcon severity={f.severity} className="h-3.5 w-3.5" />
                <span>{severityLabel[f.severity]}</span>
                <span className="opacity-60">·</span>
                <span>{categoryLabel[f.category]}</span>
                {f.file && (
                  <span className="font-mono font-normal opacity-80">
                    {f.file}
                    {f.line ? `:${f.line}` : ""}
                  </span>
                )}
              </div>
              <p className="text-codezal-text/90">{f.message}</p>
            </li>
          ))}
        </ul>
      </div>

      <div className="flex items-center gap-2 border-t border-codezal px-4 py-3">
        {onFixWithAI && (
          <button
            type="button"
            onClick={onFixWithAI}
            className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium text-codezal-accent transition-colors hover:bg-codezal-accent/10"
          >
            <Sparkles className="h-4 w-4" aria-hidden />
            {t("codeReview.fixWithAI")}
          </button>
        )}
        <div className="ml-auto flex gap-2">
          <button
            type="button"
            onClick={onAbort}
            className="rounded-md px-3 py-1.5 text-sm text-codezal-dim transition-colors hover:bg-codezal-panel-2 hover:text-codezal-text"
          >
            {t("codeReview.cancel")}
          </button>
          <button
            type="button"
            onClick={onProceed}
            className={cn(
              "rounded-md px-3 py-1.5 text-sm font-medium transition-opacity hover:opacity-90",
              blocking
                ? "bg-destructive text-white"
                : hasActionable
                  ? "bg-amber-500 text-black"
                  : "bg-codezal-text text-codezal-bg",
            )}
          >
            {proceedLabel}
          </button>
        </div>
      </div>
    </Dialog>
  )
}
