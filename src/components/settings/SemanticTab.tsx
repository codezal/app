import { useEffect, useState } from "react"
import { RefreshCcw } from "@/lib/icons"
import { useSettingsStore } from "@/store/settings"
import { useSessionsStore } from "@/store/sessions"
import { useT } from "@/lib/i18n/useT"
import { cn } from "@/lib/utils"
import { Select } from "@/components/Select"
import { buildIndex, loadIndex, type BuildProgress } from "@/lib/semantic-index"
import { errorMessage } from "@/lib/errors"
import { Section } from "./primitives"

export function SemanticTab() {
  const t = useT()
  const settings = useSettingsStore((s) => s.settings)
  const update = useSettingsStore((s) => s.update)
  const active = useSessionsStore((s) => s.active)
  const workspace = active?.workspacePath
  const cfg = settings.semantic ?? {
    enabled: false,
    provider: "ollama" as const,
    model: "nomic-embed-text",
    baseUrl: "",
    apiKey: "",
    topK: 5,
  }

  const [stats, setStats] = useState<{ chunks: number; model: string; builtAt: number } | null>(null)
  const [building, setBuilding] = useState(false)
  const [progress, setProgress] = useState<BuildProgress | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    if (!workspace) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setStats(null)
      return
    }
    void loadIndex(workspace).then((idx) => {
      if (!alive) return
      setStats(
        idx ? { chunks: idx.chunks.length, model: idx.model, builtAt: idx.builtAt } : null,
      )
    })
    return () => {
      alive = false
    }
  }, [workspace, building])

  function patch(p: Partial<typeof cfg>) {
    void update({ semantic: { ...cfg, ...p } })
  }

  async function onBuild() {
    if (!workspace) {
      setError(t("settings.drawer.semanticNeedWorkspace"))
      return
    }
    setBuilding(true)
    setError(null)
    try {
      await buildIndex({
        workspace,
        cfg: {
          provider: cfg.provider,
          baseUrl: cfg.baseUrl,
          model: cfg.model,
          apiKey: cfg.apiKey,
        },
        onProgress: setProgress,
      })
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBuilding(false)
      setProgress(null)
    }
  }

  return (
    <div className="space-y-6">
      <Section title={t("settings.drawer.semanticTitle")}>
        <p className="mb-3 text-base leading-relaxed text-codezal-mute">
          {t("settings.drawer.semanticHint")}
        </p>

        <label className="mb-3 flex items-center gap-2 text-base">
          <input
            type="checkbox"
            checked={cfg.enabled}
            onChange={(e) => patch({ enabled: e.target.checked })}
          />
          <span className="text-codezal-text">{t("settings.drawer.semanticEnable")}</span>
        </label>

        <div className="mb-3 grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-base font-medium text-codezal-dim">{t("settings.drawer.semanticProviderLabel")}</span>
            <Select
              value={cfg.provider}
              onChange={(v) => patch({ provider: v as "openai" | "ollama" | "custom" })}
              options={[
                { value: "ollama", label: t("settings.drawer.providerOllama") },
                { value: "openai", label: t("settings.drawer.providerOpenai") },
                { value: "custom", label: t("settings.drawer.providerCustom") },
              ]}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-base font-medium text-codezal-dim">{t("settings.drawer.semanticModelLabel")}</span>
            <input
              value={cfg.model}
              onChange={(e) => patch({ model: e.target.value })}
              placeholder={t("settings.drawer.semanticModelPlaceholder")}
              className="rounded-md border border-codezal bg-codezal-input px-3 py-2 font-mono text-base text-codezal-text outline-none focus:border-codezal-accent"
            />
          </label>
          {(cfg.provider === "custom" || cfg.provider === "ollama") && (
            <label className="col-span-2 flex flex-col gap-1">
              <span className="text-base font-medium text-codezal-dim">{t("settings.drawer.semanticBaseUrlLabel")}</span>
              <input
                value={cfg.baseUrl ?? ""}
                onChange={(e) => patch({ baseUrl: e.target.value })}
                placeholder={
                  cfg.provider === "ollama"
                    ? t("settings.drawer.semanticBaseUrlOllamaPh")
                    : t("settings.drawer.semanticBaseUrlCustomPh")
                }
                className="rounded-md border border-codezal bg-codezal-input px-3 py-2 font-mono text-base text-codezal-text outline-none focus:border-codezal-accent"
              />
            </label>
          )}
          {cfg.provider !== "ollama" && (
            <label className="col-span-2 flex flex-col gap-1">
              <span className="text-base font-medium text-codezal-dim">{t("settings.drawer.semanticApiKeyLabel")}</span>
              <input
                type="password"
                value={cfg.apiKey ?? ""}
                onChange={(e) => patch({ apiKey: e.target.value })}
                className="rounded-md border border-codezal bg-codezal-input px-3 py-2 font-mono text-base text-codezal-text outline-none focus:border-codezal-accent"
              />
            </label>
          )}
          <label className="flex flex-col gap-1">
            <span className="text-base font-medium text-codezal-dim">{t("settings.drawer.semanticTopKLabel")}</span>
            <input
              type="number"
              min={1}
              max={20}
              value={cfg.topK ?? 5}
              onChange={(e) => patch({ topK: Math.max(1, Math.min(20, Number(e.target.value) || 5)) })}
              className="rounded-md border border-codezal bg-codezal-input px-3 py-2 text-base text-codezal-text outline-none focus:border-codezal-accent"
            />
          </label>
        </div>

        {cfg.enabled && (
          <label className="flex items-start gap-2 text-base">
            <input
              type="checkbox"
              checked={cfg.autoContext ?? false}
              onChange={(e) => patch({ autoContext: e.target.checked })}
              className="mt-0.5"
            />
            <span>
              <span className="text-codezal-text">{t("settings.drawer.semanticAutoContext")}</span>
              <span className="block text-codezal-mute">
                {t("settings.drawer.semanticAutoContextHint")}
              </span>
            </span>
          </label>
        )}
      </Section>

      <Section title={t("settings.drawer.semanticWsTitle")}>
        <div className="mb-2 rounded-lg border border-codezal bg-codezal-panel-2 px-3 py-2.5 text-base">
          {!workspace ? (
            <span className="text-codezal-mute">{t("settings.drawer.semanticWsNotConnected")}</span>
          ) : stats ? (
            <>
              <div className="text-codezal-text">
                {t("settings.drawer.semanticChunksLabel", { n: stats.chunks })}{" "}
                <code className="text-codezal-accent">{stats.model}</code>
              </div>
              <div className="text-codezal-mute">
                {t("settings.drawer.semanticBuiltLabel", { date: new Date(stats.builtAt).toLocaleString() })}
              </div>
            </>
          ) : (
            <span className="text-codezal-mute">{t("settings.drawer.semanticNoIndex")}</span>
          )}
        </div>

        {progress && (
          <div className="mb-2 text-base text-codezal-dim">
            {progress.phase}: {progress.done}/{progress.total}
            {progress.current ? ` · ${progress.current}` : ""}
          </div>
        )}

        {error && <div className="mb-2 text-base text-destructive">{error}</div>}

        <button
          type="button"
          disabled={!workspace || building}
          onClick={() => void onBuild()}
          className="flex h-8 items-center gap-1.5 rounded-md border border-codezal px-3 text-base text-codezal-dim hover:border-codezal-strong hover:text-codezal-text disabled:opacity-50"
        >
          <RefreshCcw className={cn("h-4 w-4", building && "animate-spin")} />
          {stats ? t("settings.drawer.semanticRebuildBtn") : t("settings.drawer.semanticBuildBtn")}
        </button>
      </Section>
    </div>
  )
}

