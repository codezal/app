import { useRef, useState } from "react"
import { Dialog } from "@/components/Dialog"
import { useT } from "@/lib/i18n/useT"

type Props = {
  open: boolean
  title: string
  placeholder?: string
  initialValue?: string
  confirmLabel?: string
  onConfirm: (value: string) => void
  onCancel: () => void
}

export function PromptDialog({
  open,
  title,
  placeholder,
  initialValue = "",
  confirmLabel,
  onConfirm,
  onCancel,
}: Props) {
  const t = useT()
  const [value, setValue] = useState(initialValue)
  const inputRef = useRef<HTMLInputElement | null>(null)

  if (!open) return null

  const trimmed = value.trim()
  const canSubmit = trimmed.length > 0

  function submit() {
    if (!canSubmit) return
    onConfirm(trimmed)
  }

  return (
    <Dialog
      onClose={onCancel}
      labelledById="prompt-dialog-title"
      backdropClassName="z-[60]"
      panelClassName="w-[420px] max-w-[90vw] overflow-hidden rounded-xl border border-codezal bg-codezal-panel shadow-2xl"
      initialFocus={inputRef}
    >
      <div className="p-4">
        <h2 id="prompt-dialog-title" className="mb-3 text-sm font-semibold text-codezal-text">
          {title}
        </h2>
        <input
          ref={inputRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault()
              submit()
            }
          }}
          placeholder={placeholder}
          spellCheck={false}
          autoComplete="off"
          onFocus={(e) => {
            const el = e.currentTarget
            const dot = el.value.lastIndexOf(".")
            if (dot > 0) el.setSelectionRange(0, dot)
            else el.select()
          }}
          className="w-full rounded-md border border-codezal bg-codezal-input px-2.5 py-1.5 text-sm text-codezal-text placeholder:text-codezal-mute focus:border-codezal-strong focus:outline-none"
        />
      </div>
      <div className="flex justify-end gap-2 border-t border-codezal px-4 py-3">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md px-3 py-1.5 text-sm text-codezal-dim transition-colors hover:bg-codezal-panel-2 hover:text-codezal-text"
        >
          {t("common.cancel")}
        </button>
        <button
          type="button"
          onClick={submit}
          disabled={!canSubmit}
          className="rounded-md bg-codezal-accent px-3 py-1.5 text-sm font-medium text-white transition-[filter] hover:brightness-95 disabled:opacity-50"
        >
          {confirmLabel ?? t("common.ok")}
        </button>
      </div>
    </Dialog>
  )
}
