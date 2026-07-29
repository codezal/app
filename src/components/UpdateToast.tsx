import { AlertTriangle, RefreshCcw, Sparkles, X } from "@/lib/icons"
import { useUpdateStore } from "@/store/update"
import { t } from "@/lib/i18n"
import { cn } from "@/lib/utils"

function mb(bytes: number): string {
  return (bytes / 1024 / 1024).toFixed(1)
}

// Non-modal update notification: a corner card that collapses to a small
// persistent badge when dismissed instead of disappearing entirely.
export function UpdateToast() {
  const { update, phase, minimized, downloaded, total, error, beginDownload, snooze, reopen } =
    useUpdateStore()

  if (phase === "idle" || !update) return null

  const busy = phase === "downloading" || phase === "installing"
  const percent = total > 0 ? Math.min(100, Math.round((downloaded / total) * 100)) : null
  const canSnooze = phase === "available" || phase === "error"

  if (minimized && !busy) {
    return (
      <button
        type="button"
        onClick={reopen}
        aria-label={t("settings.about.updateBadge")}
        title={t("settings.about.updateBadge")}
        className="fixed bottom-4 right-4 z-[70] flex items-center gap-1.5 rounded-full border border-codezal bg-codezal-panel py-1.5 pl-2.5 pr-3 text-xs font-medium text-codezal-text shadow-lg transition-colors hover:bg-codezal-panel-2"
      >
        <span className="relative flex h-4 w-4 items-center justify-center">
          <Sparkles className="h-3.5 w-3.5 text-codezal-accent" aria-hidden />
          <span
            className="absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full bg-codezal-accent"
            aria-hidden
          />
        </span>
        v{update.version}
      </button>
    )
  }

  return (
    <div
      role="status"
      className="fixed bottom-4 right-4 z-[70] w-[360px] max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border border-codezal bg-codezal-panel shadow-2xl"
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
          <h2 className="text-sm font-semibold text-codezal-text">
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
        {canSnooze && (
          <button
            type="button"
            onClick={snooze}
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
              <div className="max-h-32 overflow-y-auto rounded-md border border-codezal bg-codezal-panel-2 p-2.5">
                <div className="mb-1 text-xs font-medium uppercase tracking-wide text-codezal-mute">
                  {t("settings.about.releaseNotes")}
                </div>
                <p className="whitespace-pre-wrap text-xs text-codezal-dim">{update.body}</p>
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
            <div className="mt-1.5 flex justify-between text-xs text-codezal-mute">
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

      <div className="flex items-center justify-end gap-2 border-t border-codezal px-4 py-3">
        {phase === "available" && (
          <>
            <button
              type="button"
              onClick={snooze}
              className="rounded-md px-3 py-1.5 text-sm text-codezal-dim transition-colors hover:bg-codezal-panel-2 hover:text-codezal-text"
            >
              {t("settings.about.later")}
            </button>
            <button
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
              onClick={snooze}
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
          <span className="text-xs text-codezal-mute">{t("settings.about.downloadingHint")}</span>
        )}
      </div>
    </div>
  )
}
