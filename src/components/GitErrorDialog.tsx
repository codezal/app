import { useRef } from "react"
import { AlertTriangle } from "@/lib/icons"
import { Dialog } from "@/components/Dialog"
import { useT } from "@/lib/i18n/useT"

type Props = {
  open: boolean
  title: string
  detail: string
  onShowOutput: () => void
  onClose: () => void
}

export function GitErrorDialog({ open, title, detail, onShowOutput, onClose }: Props) {
  const t = useT()
  const closeRef = useRef<HTMLButtonElement | null>(null)
  if (!open) return null

  const preview = detail
    .split("\n")
    .filter((l) => l.trim())
    .slice(0, 6)
    .join("\n")

  return (
    <Dialog
      role="alertdialog"
      onClose={onClose}
      labelledById="git-error-title"
      backdropClassName="z-[60]"
      panelClassName="w-[520px] max-w-[92vw] overflow-hidden rounded-xl border border-codezal bg-codezal-panel shadow-2xl"
      initialFocus={closeRef}
    >
      <div className="flex gap-3 p-4">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-destructive/10 text-destructive">
          <AlertTriangle className="h-5 w-5" aria-hidden />
        </div>
        <div className="min-w-0 flex-1 pt-0.5">
          <h2 id="git-error-title" className="text-sm font-semibold text-codezal-text">
            {title}
          </h2>
          {preview && (
            <pre className="mt-2 max-h-40 overflow-hidden whitespace-pre-wrap break-words rounded-md border border-codezal bg-codezal-bg px-2.5 py-2 font-mono text-sm leading-relaxed text-codezal-mute">
              {preview}
            </pre>
          )}
        </div>
      </div>
      <div className="flex justify-end gap-2 border-t border-codezal px-4 py-3">
        <button
          type="button"
          onClick={onShowOutput}
          className="rounded-md px-3 py-1.5 text-sm text-codezal-dim transition-colors hover:bg-codezal-panel-2 hover:text-codezal-text"
        >
          {t("gitPanel.showOutput")}
        </button>
        <button
          ref={closeRef}
          type="button"
          onClick={onClose}
          className="rounded-md bg-codezal-text px-3 py-1.5 text-sm font-medium text-codezal-bg transition-opacity hover:opacity-90"
        >
          {t("common.close")}
        </button>
      </div>
    </Dialog>
  )
}
