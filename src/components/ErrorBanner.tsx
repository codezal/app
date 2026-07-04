// Polished, dismissible error card shown floating just above the composer when
// a turn fails. Replaces the bare full-width red line — a composer-width rounded
// card with an icon, an "Error" heading, a dismiss control, and (for auth /
// credential failures) a shortcut to Settings so the user can reconnect.
import { AlertTriangle, Settings, X } from "@/lib/icons"
import { useT } from "@/lib/i18n/useT"

type Props = {
  message: string
  onDismiss: () => void
  // When set, an action button is shown (used for auth errors → open Settings).
  onOpenSettings?: () => void
}

export function ErrorBanner({ message, onDismiss, onOpenSettings }: Props) {
  const t = useT()
  return (
    <div
      role="alert"
      className="flex items-start gap-2.5 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive shadow-md backdrop-blur-sm"
    >
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <div className="min-w-0 flex-1">
        <div className="font-medium">{t("common.error")}</div>
        <div className="mt-0.5 break-words text-destructive/90">{message}</div>
      </div>
      {onOpenSettings && (
        <button
          type="button"
          onClick={onOpenSettings}
          className="flex shrink-0 items-center gap-1 rounded-md border border-destructive/30 px-2 py-1 text-sm font-medium text-destructive transition-colors hover:bg-destructive/15"
        >
          <Settings className="h-3.5 w-3.5" aria-hidden />
          {t("common.settings")}
        </button>
      )}
      <button
        type="button"
        onClick={onDismiss}
        title={t("common.close")}
        aria-label={t("common.close")}
        className="shrink-0 rounded-md p-1 text-destructive/70 transition-colors hover:bg-destructive/15 hover:text-destructive"
      >
        <X className="h-4 w-4" aria-hidden />
      </button>
    </div>
  )
}
