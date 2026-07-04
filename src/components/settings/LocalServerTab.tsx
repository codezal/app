// Yerel Sunucu sekmesi — in-process yerel modeli OpenAI/Ollama-uyumlu HTTP olarak
import { useEffect, useState } from "react"
import { useSettingsStore } from "@/store/settings"
import { useT } from "@/lib/i18n/useT"
import {
  DEFAULT_INFERENCE_SERVER,
  startInferenceServer,
  stopInferenceServer,
  inferenceServerStatus,
  type InferenceServerStatus,
} from "@/lib/inference-server"
import { Section, Row, Toggle, NumberField } from "./primitives"

export function LocalServerTab() {
  const settings = useSettingsStore((s) => s.settings)
  const update = useSettingsStore((s) => s.update)
  const t = useT()

  const cfg = settings.inferenceServer ?? DEFAULT_INFERENCE_SERVER
  const [status, setStatus] = useState<InferenceServerStatus>({ running: false, port: cfg.port })
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState<string | null>(null)

  function refresh() {
    void inferenceServerStatus()
      .then(setStatus)
      .catch(() => {})
  }

  useEffect(() => {
    refresh()
  }, [])

  async function applyConfig(next: typeof cfg) {
    void update({ inferenceServer: next })
    if (status.running) {
      setBusy(true)
      try {
        await stopInferenceServer()
        await startInferenceServer(next.port, next.expose)
      } catch {
        // Intentionally ignored.
      } finally {
        setBusy(false)
        refresh()
      }
    }
  }

  async function toggleEnabled(v: boolean) {
    void update({ inferenceServer: { ...cfg, enabled: v } })
    setBusy(true)
      try {
        if (v) await startInferenceServer(cfg.port, cfg.expose)
        else await stopInferenceServer()
      } catch {
        // Intentionally ignored.
      } finally {
        setBusy(false)
        refresh()
    }
  }

  function copy(url: string) {
    void navigator.clipboard?.writeText(url)
    setCopied(url)
    setTimeout(() => setCopied((c) => (c === url ? null : c)), 1500)
  }

  const host = cfg.expose ? "0.0.0.0" : "127.0.0.1"
  const port = status.running ? status.port : cfg.port
  const base = `http://${host}:${port}`
  const endpoints = [
    `${base}/v1/chat/completions`,
    `${base}/api/chat`,
    `${base}/v1/models`,
  ]

  return (
    <div className="space-y-6">
      <Section title={t("settings.localServer.title")} description={t("settings.localServer.desc")}>
        <Row label={t("settings.localServer.enableLabel")} description={t("settings.localServer.enableDesc")}>
          <div className="flex items-center gap-3">
            <span
              className={
                "inline-flex items-center gap-1.5 text-md " +
                (status.running ? "text-emerald-500" : "text-codezal-mute")
              }
            >
              <span
                className={
                  "h-2 w-2 rounded-full " + (status.running ? "bg-emerald-500" : "bg-zinc-400")
                }
              />
              {status.running ? t("settings.localServer.statusRunning") : t("settings.localServer.statusStopped")}
            </span>
            <Toggle
              label={t("settings.localServer.enableLabel")}
              checked={cfg.enabled || status.running}
              onChange={(v) => {
                if (!busy) void toggleEnabled(v)
              }}
            />
          </div>
        </Row>
        <Row label={t("settings.localServer.portLabel")} description={t("settings.localServer.portDesc")}>
          <NumberField
            value={cfg.port}
            min={1}
            max={65535}
            fallback={1456}
            onChange={(v) => void applyConfig({ ...cfg, port: v })}
          />
        </Row>
        <Row label={t("settings.localServer.exposeLabel")} description={t("settings.localServer.exposeDesc")}>
          <Toggle
            label={t("settings.localServer.exposeLabel")}
            checked={cfg.expose}
            onChange={(v) => void applyConfig({ ...cfg, expose: v })}
          />
        </Row>
      </Section>

      {cfg.expose && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-md text-amber-700 dark:text-amber-300">
          {t("settings.localServer.exposeWarn")}
        </div>
      )}

      <Section title={t("settings.localServer.endpointsTitle")}>
        <div className="space-y-1.5 py-1">
          {endpoints.map((url) => (
            <div key={url} className="flex items-center gap-2">
              <code className="flex-1 truncate rounded-md bg-codezal-panel-2 px-2.5 py-1.5 text-md text-codezal-text">
                {url}
              </code>
              <button
                type="button"
                onClick={() => copy(url)}
                className="shrink-0 rounded-md bg-codezal-chip px-2.5 py-1.5 text-md text-codezal-text hover:bg-codezal-panel-2"
              >
                {copied === url ? t("settings.localServer.copied") : "Kopyala"}
              </button>
            </div>
          ))}
        </div>
      </Section>
    </div>
  )
}
