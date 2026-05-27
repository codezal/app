// OrchestraConfigModal — orkestra modu açılırken worker havuzunu konfigüre etme arayüzü.
// Parent provider/model + 1-5 worker satırı. Başlat → session.mode="orchestra", orchestra=cfg.
import { useEffect, useMemo, useState } from "react"
import { AlertTriangle, Music, Plus, Trash2, X } from "lucide-react"
import { useSessionsStore } from "@/store/sessions"
import { useSettingsStore } from "@/store/settings"
import {
  PROVIDERS,
  defaultModelFor,
  modelsFor,
  type ProviderId,
} from "@/lib/providers"
import {
  readUserAgents,
  readWorkspaceAgents,
  type AgentDef,
} from "@/lib/agents"
import type {
  OrchestraConfig,
  WorkerConfig,
  WorkerKind,
} from "@/lib/orchestra/types"
import { cn } from "@/lib/utils"
import { useT } from "@/lib/i18n/useT"
import { t as tStatic } from "@/lib/i18n"

type Props = {
  onClose: () => void
}

function buildKindOptions(): { value: WorkerKind; label: string; hint: string }[] {
  return [
    { value: "sdk", label: tStatic("orchestraModal.kindSdk"), hint: tStatic("orchestraModal.kindSdkHint") },
    { value: "claude-cli", label: tStatic("orchestraModal.kindClaude"), hint: tStatic("orchestraModal.kindClaudeHint") },
    { value: "codex-cli", label: tStatic("orchestraModal.kindCodex"), hint: tStatic("orchestraModal.kindCodexHint") },
    { value: "opencode-cli", label: tStatic("orchestraModal.kindOpencode"), hint: tStatic("orchestraModal.kindOpencodeHint") },
  ]
}

function makeDefaultWorker(idx: number, defProvider: ProviderId, defModel: string): WorkerConfig {
  return {
    idx,
    kind: "sdk",
    provider: defProvider,
    model: defModel,
    yolo: false,
    presetAgent: undefined,
  }
}

export function OrchestraConfigModal({ onClose }: Props) {
  const t = useT()
  const active = useSessionsStore((s) => s.active)
  const setMode = useSessionsStore((s) => s.setMode)
  const setOrchestra = useSessionsStore((s) => s.setOrchestra)
  const settings = useSettingsStore((s) => s.settings)

  const initialProvider = (active?.provider ?? settings.defaultProvider) as ProviderId
  const initialModel = active?.model ?? settings.defaultModel

  const [parentProvider, setParentProvider] = useState<ProviderId>(initialProvider)
  const [parentModel, setParentModel] = useState(initialModel)
  const [workers, setWorkers] = useState<WorkerConfig[]>([
    makeDefaultWorker(1, initialProvider, initialModel),
  ])
  const [agentPresets, setAgentPresets] = useState<AgentDef[]>([])

  // AgentDef presetlerini yükle (proje + global) — modal mount edildiğinde tek seferlik
  useEffect(() => {
    let alive = true
    Promise.all([
      readWorkspaceAgents(active?.workspacePath),
      readUserAgents(),
    ])
      .then(([p, u]) => alive && setAgentPresets([...p, ...u]))
      .catch(() => alive && setAgentPresets([]))
    return () => {
      alive = false
    }
  }, [active?.workspacePath])

  const catalog = settings.providerCatalog?.data as
    | Parameters<typeof modelsFor>[1]
    | undefined

  const parentModels = useMemo(
    () => modelsFor(parentProvider, catalog),
    [parentProvider, catalog],
  )

  const yoloCount = workers.filter((w) => w.yolo).length
  const cliCount = workers.filter((w) => w.kind !== "sdk").length

  function updateWorker(idx: number, patch: Partial<WorkerConfig>) {
    setWorkers((ws) => ws.map((w) => (w.idx === idx ? { ...w, ...patch } : w)))
  }

  function addWorker() {
    if (workers.length >= 5) return
    const nextIdx = Math.max(...workers.map((w) => w.idx)) + 1
    setWorkers((ws) => [...ws, makeDefaultWorker(nextIdx, parentProvider, parentModel)])
  }

  function removeWorker(idx: number) {
    if (workers.length <= 1) return
    setWorkers((ws) => {
      const filtered = ws.filter((w) => w.idx !== idx)
      // idx'leri 1'den yeniden numarala
      return filtered.map((w, i) => ({ ...w, idx: i + 1 }))
    })
  }

  function applyPreset(idx: number, presetName: string | "") {
    if (!presetName) {
      updateWorker(idx, { presetAgent: undefined })
      return
    }
    const preset = agentPresets.find((p) => p.name === presetName)
    if (!preset) return
    updateWorker(idx, {
      presetAgent: presetName,
      provider: (preset.provider ?? parentProvider) as ProviderId,
      model: preset.model ?? parentModel,
    })
  }

  function handleStart() {
    const cfg: OrchestraConfig = {
      parentProvider,
      parentModel,
      workers,
      logBufferLines: 200,
    }
    setOrchestra(cfg)
    setMode("orchestra")
    // Parent session'ın provider/model'i de güncellenir (parent stream onu kullanır)
    const store = useSessionsStore.getState()
    store.updateActiveMeta({ provider: parentProvider, model: parentModel })
    onClose()
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === "Escape") onClose()
        }}
        className="mt-[10vh] flex max-h-[80vh] w-[760px] max-w-[94vw] flex-col overflow-hidden rounded-xl border border-codezal bg-codezal-panel shadow-2xl"
      >
        <header className="flex items-center gap-2 border-b border-codezal px-3 py-2.5">
          <Music className="h-4 w-4 text-codezal-accent" />
          <span className="text-[13px] font-medium text-codezal-text">
            {t("orchestraModal.headerTitle")}
          </span>
          <span className="text-[11px] text-codezal-mute">
            {t("orchestraModal.workerCount", { count: workers.length })}
          </span>
          <div className="flex-1" />
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-codezal-mute hover:text-codezal-text"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </header>

        <div className="flex-1 space-y-4 overflow-auto px-4 py-3 text-[12px]">
          {/* Parent satırı */}
          <section className="rounded-md border border-codezal-strong bg-codezal-input/30 p-3">
            <div className="mb-2 text-[11px] font-medium uppercase tracking-wide text-codezal-dim">
              {t("orchestraModal.parentTitle")}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={parentProvider}
                onChange={(e) => {
                  const p = e.target.value as ProviderId
                  setParentProvider(p)
                  setParentModel(defaultModelFor(p, catalog))
                }}
                className="rounded border border-codezal bg-codezal-input px-2 py-1 text-[12px] text-codezal-text"
              >
                {Object.values(PROVIDERS).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </select>
              <select
                value={parentModel}
                onChange={(e) => setParentModel(e.target.value)}
                className="min-w-[200px] rounded border border-codezal bg-codezal-input px-2 py-1 text-[12px] text-codezal-text"
              >
                {parentModels.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
              <span className="text-[11px] text-codezal-mute">
                {t("orchestraModal.parentHint")}
              </span>
            </div>
          </section>

          {/* Worker satırları */}
          <section>
            <div className="mb-2 flex items-center gap-2 text-[11px] font-medium uppercase tracking-wide text-codezal-dim">
              {t("orchestraModal.workerHeading")}
              <div className="flex-1" />
              <button
                type="button"
                onClick={addWorker}
                disabled={workers.length >= 5}
                className={cn(
                  "flex items-center gap-1 rounded border border-codezal px-2 py-0.5 text-[11px]",
                  workers.length >= 5
                    ? "cursor-not-allowed text-codezal-mute"
                    : "text-codezal-dim hover:border-codezal-strong hover:text-codezal-text",
                )}
              >
                <Plus className="h-3 w-3" /> {t("orchestraModal.addWorker")}
              </button>
            </div>

            <div className="space-y-2">
              {workers.map((w) => (
                <WorkerRow
                  key={w.idx}
                  config={w}
                  agentPresets={agentPresets}
                  catalog={catalog}
                  canRemove={workers.length > 1}
                  onChange={(patch) => updateWorker(w.idx, patch)}
                  onRemove={() => removeWorker(w.idx)}
                  onPickPreset={(name) => applyPreset(w.idx, name)}
                />
              ))}
            </div>
          </section>

          {/* Uyarılar */}
          {(yoloCount > 0 || cliCount > 0) && (
            <div className="flex items-start gap-2 rounded-md border border-amber-600/60 bg-amber-500/20 p-2.5 text-[12px] text-amber-950 dark:text-amber-50">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-700 dark:text-amber-300" />
              <div className="space-y-1.5">
                {yoloCount > 0 && (
                  <div>
                    <span className="font-semibold text-amber-900 dark:text-amber-200">
                      {t("orchestraModal.yoloCountWarn", { count: yoloCount })}
                    </span>{" "}
                    {t("orchestraModal.yoloMsg")}
                  </div>
                )}
                {cliCount > 0 && (
                  <div>
                    <span className="font-semibold text-amber-900 dark:text-amber-200">
                      {t("orchestraModal.cliCountWarn", { count: cliCount })}
                    </span>{" "}
                    {t("orchestraModal.cliMsg")}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        <footer className="flex items-center gap-2 border-t border-codezal px-3 py-2">
          <span className="min-w-0 flex-1 truncate text-[11px] text-codezal-mute">
            {t("orchestraModal.startHint")}
          </span>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-md border border-codezal px-3 py-1 text-[12px] text-codezal-dim hover:border-codezal-strong hover:text-codezal-text"
          >
            {t("orchestraModal.cancel")}
          </button>
          <button
            type="button"
            onClick={handleStart}
            className="flex shrink-0 items-center gap-1 rounded-md bg-codezal-accent px-3 py-1 text-[12px] font-medium text-[#1a1106] hover:scale-[1.02]"
          >
            <Music className="h-3 w-3" /> {t("orchestraModal.start")}
          </button>
        </footer>
      </div>
    </div>
  )
}

type WorkerRowProps = {
  config: WorkerConfig
  agentPresets: AgentDef[]
  catalog: Parameters<typeof modelsFor>[1]
  canRemove: boolean
  onChange: (patch: Partial<WorkerConfig>) => void
  onRemove: () => void
  onPickPreset: (name: string) => void
}

function WorkerRow({
  config,
  agentPresets,
  catalog,
  canRemove,
  onChange,
  onRemove,
  onPickPreset,
}: WorkerRowProps) {
  const t = useT()
  const kindOptions = useMemo(() => buildKindOptions(), [])
  const isSdk = config.kind === "sdk"
  const provider = (config.provider ?? "anthropic") as ProviderId
  const models = useMemo(() => modelsFor(provider, catalog), [provider, catalog])

  return (
    <div className="flex items-center gap-2 rounded-md border border-codezal bg-codezal-input/20 px-2.5 py-1.5">
      <span className="shrink-0 rounded bg-codezal-chip px-1.5 py-0.5 text-[10.5px] font-medium text-codezal-text">
        worker-{config.idx}
      </span>

      <select
        value={config.kind}
        onChange={(e) => onChange({ kind: e.target.value as WorkerKind })}
        className="shrink-0 rounded border border-codezal bg-codezal-input px-2 py-1 text-[11.5px] text-codezal-text"
      >
        {kindOptions.map((o) => (
          <option key={o.value} value={o.value} title={o.hint}>
            {o.label}
          </option>
        ))}
      </select>

      {isSdk && (
        <>
          <select
            value={provider}
            onChange={(e) => {
              const p = e.target.value as ProviderId
              onChange({ provider: p, model: undefined })
            }}
            className="shrink-0 rounded border border-codezal bg-codezal-input px-2 py-1 text-[11.5px] text-codezal-text"
          >
            {Object.values(PROVIDERS).map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
          <select
            value={config.model ?? models[0] ?? ""}
            onChange={(e) => onChange({ model: e.target.value })}
            className="min-w-[140px] flex-1 rounded border border-codezal bg-codezal-input px-2 py-1 text-[11.5px] text-codezal-text"
          >
            {models.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </>
      )}

      {!isSdk && (
        <input
          type="text"
          value={config.model ?? ""}
          onChange={(e) => onChange({ model: e.target.value })}
          placeholder={t("orchestraModal.cliModelPlaceholder")}
          className="min-w-[140px] flex-1 rounded border border-codezal bg-codezal-input px-2 py-1 text-[11.5px] text-codezal-text"
        />
      )}

      <select
        value={config.presetAgent ?? ""}
        onChange={(e) => onPickPreset(e.target.value)}
        className="shrink-0 rounded border border-codezal bg-codezal-input px-2 py-1 text-[11.5px] text-codezal-text"
        title={t("orchestraModal.presetTitle")}
      >
        <option value="">{t("orchestraModal.presetEmpty")}</option>
        {agentPresets.map((p) => (
          <option key={p.path} value={p.name}>
            {p.name}
          </option>
        ))}
      </select>

      <label className="flex shrink-0 cursor-pointer items-center gap-1 text-[11px] text-codezal-dim">
        <input
          type="checkbox"
          checked={config.yolo}
          onChange={(e) => onChange({ yolo: e.target.checked })}
          className="accent-codezal-accent"
        />
        {t("orchestraModal.yoloLabel")}
      </label>

      {canRemove && (
        <button
          type="button"
          onClick={onRemove}
          title={t("orchestraModal.removeWorkerTitle")}
          className="shrink-0 rounded p-1 text-codezal-mute hover:text-destructive"
        >
          <Trash2 className="h-3 w-3" />
        </button>
      )}
    </div>
  )
}
