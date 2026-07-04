import { useRef } from "react"
import { AlertTriangle } from "@/lib/icons"
import { Dialog } from "@/components/Dialog"
import { useT } from "@/lib/i18n/useT"

type Props = {
  open: boolean
  title: string
  message?: string
  confirmLabel?: string
  cancelLabel?: string
  onConfirm: () => void
  onCancel: () => void
}

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel,
  cancelLabel,
  onConfirm,
  onCancel,
}: Props) {
  const t = useT()
  const confirmRef = useRef<HTMLButtonElement | null>(null)

  if (!open) return null

  return (
    <Dialog
      role="alertdialog"
      onClose={onCancel}
      labelledById="confirm-dialog-title"
      backdropClassName="z-[60]"
      panelClassName="w-[400px] max-w-[90vw] overflow-hidden rounded-xl border border-codezal bg-codezal-panel shadow-2xl"
      initialFocus={confirmRef}
    >
      <div className="flex gap-3 p-4">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-destructive/10 text-destructive">
          <AlertTriangle className="h-5 w-5" aria-hidden />
        </div>
        <div className="min-w-0 flex-1 pt-0.5">
          <h2 id="confirm-dialog-title" className="text-md font-semibold text-codezal-text">
            {title}
          </h2>
          {message && <p className="mt-1 text-md text-codezal-mute">{message}</p>}
        </div>
      </div>
      <div className="flex justify-end gap-2 border-t border-codezal px-4 py-3">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md px-3 py-1.5 text-md text-codezal-dim transition-colors hover:bg-codezal-panel-2 hover:text-codezal-text"
        >
          {cancelLabel ?? t("common.cancel")}
        </button>
        <button
          ref={confirmRef}
          type="button"
          onClick={onConfirm}
          className="rounded-md bg-destructive px-3 py-1.5 text-md font-medium text-destructive-foreground transition-[filter] hover:brightness-95"
        >
          {confirmLabel ?? t("common.delete")}
        </button>
      </div>
    </Dialog>
  )
}
