// Right-panel content for post-run next-step suggestions (Ara-style). Reads the
// ephemeral suggestions store for the active session and renders cards. Hovering
// a card reveals its full prompt (inspect before run); Run dispatches a window
// event the shell turns into a fresh foreground session. Decoupled from App via
// window events (mirrors codezal:run-review), so ContextPanel needs no new props.
import { Loader2, Play, RefreshCcw, Sparkles } from "@/lib/icons"
import { useSessionsStore } from "@/store/sessions"
import { useSuggestionsStore } from "@/store/suggestions"
import { useSettingsStore } from "@/store/settings"
import { useT } from "@/lib/i18n/useT"

function runSuggestion(prompt: string) {
  window.dispatchEvent(new CustomEvent("codezal:run-suggestion", { detail: { prompt } }))
}
function regenerate() {
  window.dispatchEvent(new CustomEvent("codezal:regenerate-suggestions"))
}

export function SuggestionsPanel() {
  const t = useT()
  const activeId = useSessionsStore((s) => s.activeId)
  const entry = useSuggestionsStore((s) => (activeId ? s.bySession[activeId] : undefined))
  const enabled = useSettingsStore((s) => s.settings.suggestionsEnabled ?? true)

  const items = entry?.items ?? []
  const loading = entry?.loading ?? false

  return (
    <div className="flex h-full flex-col">
      {/* Toolbar: refresh. Disabled while a generation is in flight. */}
      <div className="mb-2 flex items-center justify-end">
        <button
          type="button"
          onClick={regenerate}
          disabled={loading}
          title={t("suggestions.regenerate")}
          className="flex items-center gap-1 rounded-md px-2 py-1 text-sm text-codezal-mute hover:bg-codezal-panel-2 hover:text-codezal-text disabled:opacity-50"
        >
          <RefreshCcw className={loading ? "h-3.5 w-3.5 animate-spin" : "h-3.5 w-3.5"} />
          {t("suggestions.regenerate")}
        </button>
      </div>

      {loading && items.length === 0 ? (
        <div className="flex flex-1 items-center justify-center gap-2 text-sm text-codezal-mute">
          <Loader2 className="h-4 w-4 animate-spin" />
          {t("suggestions.loading")}
        </div>
      ) : entry?.error ? (
        <div className="flex flex-1 items-center justify-center px-4 text-center text-sm text-codezal-mute">
          {t("suggestions.error")}
        </div>
      ) : items.length === 0 ? (
        <div className="flex flex-1 items-center justify-center px-4 text-center text-sm text-codezal-mute">
          {enabled ? t("suggestions.empty") : t("suggestions.disabledHint")}
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {items.map((s) => (
            <div
              key={s.id}
              className="group rounded-lg border border-codezal bg-codezal-panel p-2.5 transition-colors hover:border-codezal-accent"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <Sparkles className="h-3.5 w-3.5 shrink-0 text-codezal-accent" />
                    <span className="truncate text-sm font-semibold text-codezal-text">{s.title}</span>
                  </div>
                  {s.rationale && (
                    <div className="mt-0.5 text-sm leading-snug text-codezal-mute">{s.rationale}</div>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => runSuggestion(s.prompt)}
                  title={t("suggestions.runHint")}
                  className="flex shrink-0 items-center gap-1 rounded-md bg-codezal-accent px-2 py-1 text-sm font-medium text-white hover:opacity-90"
                >
                  <Play className="h-3 w-3" />
                  {t("suggestions.run")}
                </button>
              </div>

              {s.files && s.files.length > 0 && (
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {s.files.map((f) => (
                    <span
                      key={f}
                      className="max-w-full truncate rounded bg-codezal-chip px-1.5 py-0.5 font-mono text-sm text-codezal-dim"
                    >
                      {f}
                    </span>
                  ))}
                </div>
              )}

              {/* Full prompt — hidden until hover (inspect before run). */}
              <div className="mt-1.5 hidden whitespace-pre-wrap rounded bg-codezal-input p-2 text-sm leading-snug text-codezal-dim group-hover:block">
                {s.prompt}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
