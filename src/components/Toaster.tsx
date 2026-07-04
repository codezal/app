// Toast host — renders the global toast queue at the bottom-right corner.
// Mounted once in App. Each toast auto-dismisses; click ✕ to close early.
// Toasts may carry an optional inline action (e.g. "Undo") shown as a button.
import { useToastStore, type ToastKind } from "@/store/toast"
import { AlertCircle, Check, Info, X } from "@/lib/icons"
import { cn } from "@/lib/utils"
import { useT } from "@/lib/i18n/useT"

const KIND_STYLES: Record<
  ToastKind,
  { border: string; icon: React.ReactNode }
> = {
  success: {
    border: "border-codezal-accent/40",
    icon: <Check className="h-4 w-4 text-codezal-accent" />,
  },
  error: {
    border: "border-destructive/50",
    icon: <AlertCircle className="h-4 w-4 text-destructive" />,
  },
  info: {
    border: "border-codezal",
    icon: <Info className="h-4 w-4 text-codezal-dim" />,
  },
}

export function Toaster() {
  const t = useT()
  const toasts = useToastStore((s) => s.toasts)
  const dismiss = useToastStore((s) => s.dismiss)
  const pause = useToastStore((s) => s.pause)
  const resume = useToastStore((s) => s.resume)

  return (
    <div
      aria-live="polite"
      aria-atomic="false"
      className="pointer-events-none fixed bottom-4 right-4 z-[100] flex max-w-[360px] flex-col gap-2"
    >
      {toasts.map((toast) => {
        const style = KIND_STYLES[toast.kind]
        return (
          <div
            key={toast.id}
            role={toast.kind === "error" ? "alert" : "status"}
            onMouseEnter={() => pause(toast.id)}
            onMouseLeave={() => resume(toast.id)}
            onFocus={() => pause(toast.id)}
            onBlur={() => resume(toast.id)}
            className={cn(
              "pointer-events-auto flex animate-toast-in items-start gap-2.5 rounded-lg border bg-codezal-panel px-3 py-2.5 text-base text-codezal-text shadow-lg",
              style.border,
            )}
          >
            <span className="mt-px shrink-0">{style.icon}</span>
            <span className="min-w-0 flex-1 break-words">{toast.message}</span>
            {toast.action && (
              <button
                type="button"
                onClick={() => {
                  // Run the action, then dismiss so the toast doesn't linger.
                  toast.action!.onClick()
                  dismiss(toast.id)
                }}
                className="-my-0.5 shrink-0 rounded-md border border-codezal-accent/40 px-2 py-0.5 text-sm font-medium text-codezal-accent hover:bg-codezal-accent/10"
              >
                {toast.action.label}
              </button>
            )}
            <button
              type="button"
              onClick={() => dismiss(toast.id)}
              title={t("common.close")}
              aria-label={t("common.close")}
              className="-mr-1 flex h-6 w-6 shrink-0 items-center justify-center rounded text-codezal-mute hover:bg-codezal-panel-2 hover:text-codezal-text"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )
      })}
    </div>
  )
}
