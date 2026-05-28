// Alt status bar — context %, token, cost.
import { useSessionsStore } from "@/store/sessions"
import { contextCap } from "@/lib/pricing"
import { cn } from "@/lib/utils"
import { useT } from "@/lib/i18n/useT"

export function StatusBar() {
  const t = useT()
  // Dar selector'lar — usage/model yalnız tur sonunda değişir; StatusBar artık
  // stream patch'lerinde (active.messages değişimi) re-render olmaz.
  const hasActive = useSessionsStore((s) => s.active != null)
  const usage = useSessionsStore((s) => s.active?.usage)
  const model = useSessionsStore((s) => s.active?.model ?? "")
  if (!hasActive) return null

  const cap = contextCap(model)
  // ctx doluluk = efektif bağlam (estimator). Yoksa son turn'ün input'u.
  // Kümülatif input + output ARTIK kullanılmıyor — yanlış %100 göstergesi.
  const used = usage?.effectiveContextTokens ?? usage?.lastInputTokens ?? 0
  const pct = Math.min(100, Math.round((used / cap) * 100))

  return (
    <div className="flex h-[22px] shrink-0 items-center gap-3 border-t border-codezal bg-codezal-sidebar px-3 text-[10.5px] text-codezal-mute">
      <span title={t("statusBar.ctxTitle", { used: used.toLocaleString(), cap: cap.toLocaleString() })}>
        ctx{" "}
        <span
          className={cn(
            pct > 80 ? "text-destructive" : pct > 50 ? "text-codezal-accent" : "text-codezal-dim",
          )}
        >
          {pct}%
        </span>
      </span>

      {usage && (
        <>
          <span className="text-codezal-mute">·</span>
          <span>
            in <span className="text-codezal-dim">{formatTok(usage.inputTokens)}</span>
          </span>
          <span>
            out <span className="text-codezal-dim">{formatTok(usage.outputTokens)}</span>
          </span>
          {(usage.cacheReadTokens ?? 0) > 0 && (
            <span>
              cache{" "}
              <span className="text-codezal-dim">
                {formatTok(usage.cacheReadTokens ?? 0)}
              </span>
            </span>
          )}
          {(usage.reasoningTokens ?? 0) > 0 && (
            <span>
              think{" "}
              <span className="text-codezal-dim">
                {formatTok(usage.reasoningTokens ?? 0)}
              </span>
            </span>
          )}
          <span className="text-codezal-mute">·</span>
          <span>
            ${usage.costUsd.toFixed(4)}{" "}
            <span className="text-codezal-mute">{t("statusBar.turnsLabel", { n: usage.turns })}</span>
          </span>
        </>
      )}

      <div className="flex-1" />
    </div>
  )
}

function formatTok(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + "M"
  if (n >= 1000) return (n / 1000).toFixed(1) + "K"
  return String(n)
}
