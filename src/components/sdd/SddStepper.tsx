import { Check, ChevronRight, X } from "@/lib/icons"
import type { SddStage } from "@/store/types"
import type { MessageKey } from "@/lib/i18n/types-messages"
import { useT } from "@/lib/i18n/useT"
import { cn } from "@/lib/utils"

const ORDER: SddStage[] = ["requirement", "design", "prototype", "plan", "build"]

export function SddStepper({
  stage,
  onAdvance,
  onClose,
}: {
  stage: SddStage
  onAdvance?: () => void
  onClose?: () => void
}) {
  const t = useT()
  const currentIdx = Math.max(0, ORDER.indexOf(stage === "verify" ? "build" : stage))
  const isLast = currentIdx >= ORDER.length - 1

  return (
    <div className="flex items-center gap-2 border-b border-codezal-hair bg-codezal-bg px-3 py-2">
      <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
        {ORDER.map((s, i) => {
          const done = i < currentIdx
          const active = i === currentIdx
          return (
            <div key={s} className="flex shrink-0 items-center gap-1">
              <span
                className={cn(
                  "flex h-5 w-5 items-center justify-center rounded-full text-xs font-semibold",
                  done
                    ? "bg-codezal-accent text-white"
                    : active
                      ? "bg-codezal-accent/15 text-codezal-accent ring-1 ring-codezal-accent"
                      : "bg-codezal-panel-2 text-codezal-mute",
                )}
              >
                {done ? <Check className="h-3 w-3" /> : i + 1}
              </span>
              <span
                className={cn(
                  "text-sm",
                  active ? "font-medium text-codezal-text" : "text-codezal-mute",
                )}
              >
                {t(`sdd.stage.${s}` as MessageKey)}
              </span>
              {i < ORDER.length - 1 && (
                <ChevronRight className="mx-0.5 h-3.5 w-3.5 shrink-0 text-codezal-dim" />
              )}
            </div>
          )
        })}
      </div>
      {!isLast && onAdvance && (
        <button
          type="button"
          onClick={onAdvance}
          className="flex shrink-0 items-center gap-1.5 rounded-md bg-codezal-accent px-3 py-1.5 text-sm font-medium text-white transition-opacity hover:opacity-90"
        >
          {t("sdd.next")}
          <ChevronRight className="h-3.5 w-3.5" />
        </button>
      )}
      {onClose && (
        <button
          type="button"
          onClick={onClose}
          aria-label={t("common.close")}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-codezal-mute transition-colors hover:bg-codezal-panel-2 hover:text-codezal-text"
        >
          <X className="h-4 w-4" />
        </button>
      )}
    </div>
  )
}
