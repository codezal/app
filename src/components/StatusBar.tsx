// Alt status bar — context %, token, cost.
import { useState } from "react"
import { useSessionsStore } from "@/store/sessions"
import { useSettingsStore } from "@/store/settings"
import { modelDetail, resolveContextCap, type ProvidersCatalog } from "@/lib/providers-catalog"
import { resolveLocalLlm } from "@/lib/local-llm"
import { useLocalRuntimeStore } from "@/store/local-runtime"
import { cn } from "@/lib/utils"
import { formatCount } from "@/lib/format"
import { nextEditEnabled, setNextEditEnabled } from "@/lib/next-edit"
import { useT } from "@/lib/i18n/useT"

export function StatusBar() {
  const t = useT()
  const [ne, setNe] = useState(() => nextEditEnabled())
  const hasActive = useSessionsStore((s) => s.active != null)
  const usage = useSessionsStore((s) => s.active?.usage)
  const model = useSessionsStore((s) => s.active?.model ?? "")
  const provider = useSessionsStore((s) => s.active?.provider)
  const catalog = useSettingsStore((s) => s.settings.providerCatalog?.data) as ProvidersCatalog | undefined
  const localLlm = useSettingsStore((s) => s.settings.localLlm)
  const localLlmByModel = useSettingsStore((s) => s.settings.localLlmByModel)
  const localEff = useLocalRuntimeStore((s) => (model ? s.effectiveCtx[model] : undefined))
  if (!hasActive) return null

  const settingWin = resolveLocalLlm({ localLlm, localLlmByModel }, model).contextWindow
  const localCtxWindow = localEff && localEff > 0 ? Math.min(localEff, settingWin) : settingWin
  const cap = resolveContextCap(catalog, provider, model, localCtxWindow)
  const deprecated = provider ? modelDetail(catalog, provider, model)?.deprecated === true : false
  const used = usage?.effectiveContextTokens ?? usage?.lastInputTokens ?? 0
  const pct = Math.min(100, Math.round((used / cap) * 100))

  return (
    <div className="group flex h-[22px] shrink-0 items-center gap-3 border-t border-codezal-hair bg-codezal-sidebar px-3 text-sm text-codezal-mute">
      <span
        className="flex items-center gap-1.5"
        title={t("statusBar.ctxTitle", { used: used.toLocaleString(), cap: cap.toLocaleString() })}
      >
        ctx{" "}
        <span
          className={cn(
            pct > 80 ? "text-destructive" : pct > 50 ? "text-codezal-accent" : "text-codezal-dim",
          )}
        >
          {pct}%
        </span>
        <span className="inline-block h-[4px] w-12 overflow-hidden rounded-full bg-codezal-hair">
          <span
            className={cn(
              "block h-full rounded-full transition-all duration-300",
              pct > 90 ? "bg-destructive" : pct > 60 ? "bg-codezal-accent" : "bg-codezal-dim",
            )}
            style={{ width: `${pct}%` }}
          />
        </span>
      </span>

      {usage && (
        <>
          <span className="text-codezal-mute">·</span>
          <span>
            ${usage.costUsd.toFixed(4)}{" "}
            <span className="text-codezal-mute">{t("statusBar.turnsLabel", { n: usage.turns })}</span>
          </span>
        </>
      )}

      {deprecated && (
        <>
          <span className="text-codezal-mute">·</span>
          <span
            className="flex items-center gap-1 rounded bg-destructive/15 px-1.5 py-px text-destructive"
            title={t("statusBar.deprecatedTitle")}
          >
            <span aria-hidden>⚠</span>
            <span>{t("statusBar.deprecatedLabel")}</span>
          </span>
        </>
      )}

      <div className="flex-1" />

      <button
        type="button"
        onClick={() => {
          const next = !ne
          setNextEditEnabled(next)
          setNe(next)
        }}
        title={
          ne
            ? "Next-edit açık — editörde yazarken AI önerisi gelir (Tab ile kabul). Kapatmak için tıkla."
            : "Next-edit kapalı — editörde AI satır önerisi (Cursor-Tab) için tıkla."
        }
        className={cn(
          "rounded px-1.5 py-px text-sm",
          ne ? "bg-codezal-accent/20 text-codezal-accent" : "text-codezal-mute hover:text-codezal-text",
        )}
      >
        NE
      </button>

      {/* Detailed token accounting reads as a dev dashboard — calm by default,
          revealed on hover. Placed after the spacer so a hidden breakdown never
          reserves a gap between ctx and cost. */}
      {usage && (
        <span className="flex items-center gap-3 opacity-0 transition-opacity duration-150 group-hover:opacity-100">
          <span>
            in <span className="text-codezal-dim">{formatCount(usage.inputTokens)}</span>
          </span>
          <span>
            out <span className="text-codezal-dim">{formatCount(usage.outputTokens)}</span>
          </span>
          {(usage.cacheReadTokens ?? 0) > 0 && (
            <span>
              cache{" "}
              <span className="text-codezal-dim">{formatCount(usage.cacheReadTokens ?? 0)}</span>
            </span>
          )}
          {(usage.reasoningTokens ?? 0) > 0 && (
            <span>
              think{" "}
              <span className="text-codezal-dim">{formatCount(usage.reasoningTokens ?? 0)}</span>
            </span>
          )}
        </span>
      )}
    </div>
  )
}

