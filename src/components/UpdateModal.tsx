import { useRef } from "react"
import { AlertTriangle, RefreshCcw, Sparkles, X } from "@/lib/icons"
import { useUpdateStore } from "@/store/update"
import { t } from "@/lib/i18n"
import { cn } from "@/lib/utils"
import { Dialog } from "@/components/Dialog"

function mb(bytes: number): string {
  return (bytes / 1024 / 1024).toFixed(1)
}

export function UpdateModal() {
  const { update, phase, downloaded, total, error, beginDownload, dismiss } = useUpdateStore()
  const primaryRef = useRef<HTMLButtonElement | null>(null)

  if (phase === "idle" || !update) return null

  const busy = phase === "downloading" || phase === "installing"
  const percent = total > 0 ? Math.min(100, Math.round((downloaded / total) * 100)) : null
  const canDismiss = phase === "available" || phase === "error"

  return (
    <Dialog
      role="dialog"
      onClose={dismiss}
      labelledById="update-dialog-title"
      backdropClassName="z-[70]"
      panelClassName="w-[440px] max-w-[90vw] overflow-hidden rounded-xl border border-codezal bg-codezal-panel shadow-2xl"
      initialFocus={primaryRef}
      closeOnEscape={canDismiss}
      closeOnBackdrop={canDismiss}
    >
      <div className="flex items-start gap-3 p-4">
        <div
          className={cn(
            "flex h-9 w-9 shrink-0 items-center justify-center rounded-full",
            phase === "error"
              ? "bg-destructive/10 text-destructive"
              : "bg-codezal-accent-dim text-codezal-accent",
          )}
        >
          {phase === "error" ? (
            <AlertTriangle className="h-5 w-5" aria-hidden />
          ) : busy ? (
            <RefreshCcw className="h-5 w-5 animate-spin" aria-hidden />
          ) : (
            <Sparkles className="h-5 w-5" aria-hidden />
          )}
        </div>
        <div className="min-w-0 flex-1 pt-0.5">
          <h2 id="update-dialog-title" className="text-sm font-semibold text-codezal-text">
            {phase === "error"
              ? t("settings.about.updateFailed")
              : t("settings.about.updateTitle")}
          </h2>
          <p className="mt-0.5 text-sm text-codezal-mute">
            {phase === "error"
              ? error || "—"
              : phase === "installing"
                ? t("settings.about.restarting")
                : phase === "downloading"
                  ? t("settings.about.downloading")
                  : t("settings.about.updateSubtitle")}
          </p>
        </div>
        {canDismiss && (
          <button
            type="button"
            onClick={dismiss}
            aria-label={t("settings.about.later")}
            className="rounded-md p-1 text-codezal-dim transition-colors hover:bg-codezal-panel-2 hover:text-codezal-text"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        )}
      </div>

      <div className="px-4 pb-1">
        {phase === "available" && (
          <>
            <div className="mb-3 flex items-center gap-2 text-sm">
              <code className="rounded bg-codezal-panel-2 px-1.5 py-0.5 text-codezal-mute">
                v{update.currentVersion}
              </code>
              <span className="text-codezal-dim">→</span>
              <code className="rounded bg-codezal-accent-dim px-1.5 py-0.5 font-medium text-codezal-accent">
                v{update.version}
              </code>
            </div>
            {update.body && (
              <div className="max-h-40 overflow-y-auto rounded-md border border-codezal bg-codezal-panel-2 p-2.5">
                <div className="mb-1 text-sm font-medium uppercase tracking-wide text-codezal-mute">
                  {t("settings.about.releaseNotes")}
                </div>
                <p className="whitespace-pre-wrap text-sm text-codezal-dim">{update.body}</p>
              </div>
            )}
          </>
        )}

        {busy && (
          <div className="py-2">
            <div className="h-2 w-full overflow-hidden rounded-full bg-codezal-panel-2">
              <div
                className={cn(
                  "h-full rounded-full bg-codezal-accent transition-[width] duration-200",
                  percent === null && "w-1/3 animate-pulse",
                )}
                style={percent !== null ? { width: `${percent}%` } : undefined}
              />
            </div>
            <div className="mt-1.5 flex justify-between text-sm text-codezal-mute">
              <span>
                {phase === "installing"
                  ? t("settings.about.installing")
                  : t("settings.about.downloading")}
              </span>
              <span>
                {percent !== null ? `%${percent}` : ""}
                {total > 0 ? ` · ${mb(downloaded)}/${mb(total)} MB` : ""}
              </span>
            </div>
          </div>
        )}
      </div>

      {/* ── Footer ── */}
      <div className="flex items-center justify-end gap-2 border-t border-codezal px-4 py-3">
        {phase === "available" && (
          <>
            <button
              type="button"
              onClick={dismiss}
              className="rounded-md px-3 py-1.5 text-sm text-codezal-dim transition-colors hover:bg-codezal-panel-2 hover:text-codezal-text"
            >
              {t("settings.about.later")}
            </button>
            <button
              ref={primaryRef}
              type="button"
              onClick={() => void beginDownload()}
              className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-foreground transition-opacity hover:opacity-90"
            >
              {t("settings.about.updateNow")}
            </button>
          </>
        )}
        {phase === "error" && (
          <>
            <button
              type="button"
              onClick={dismiss}
              className="rounded-md px-3 py-1.5 text-sm text-codezal-dim transition-colors hover:bg-codezal-panel-2 hover:text-codezal-text"
            >
              {t("settings.about.later")}
            </button>
            <button
              type="button"
              onClick={() => void beginDownload()}
              className="flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-foreground transition-opacity hover:opacity-90"
            >
              <RefreshCcw className="h-3.5 w-3.5" aria-hidden />
              {t("settings.about.retry")}
            </button>
          </>
        )}
        {busy && (
          <span className="text-sm text-codezal-mute">
            {t("settings.about.downloadingHint")}
          </span>
        )}
      </div>
    </Dialog>
  )
}
