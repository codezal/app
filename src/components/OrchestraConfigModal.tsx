import { useEffect, useMemo, useState } from "react"
import { AlertTriangle, Music, Plus, Trash2, X } from "@/lib/icons"
import { useSessionsStore } from "@/store/sessions"
import { useSettingsStore } from "@/store/settings"
import {
  defaultModelFor,
  modelsFor,
  listProviderAdapters,
  isConnectedSync,
  probeEnvVars,
  type ProviderId,
} from "@/lib/providers"
import { modelDetail } from "@/lib/providers-catalog"
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
import { probeAcpModels } from "@/lib/orchestra/acp/probe"
import type { AcpModelOption } from "@/lib/orchestra/acp/protocol"
import { resolveProgram } from "@/lib/exec"
import { cn } from "@/lib/utils"
import { useT } from "@/lib/i18n/useT"
import { t as tStatic } from "@/lib/i18n"
import { errorMessage } from "@/lib/errors"
import { Dialog } from "@/components/Dialog"

type Props = {
  onClose: () => void
}

function buildKindOptions(): { value: WorkerKind; label: string; hint: string }[] {
  return [
    { value: "sdk", label: tStatic("orchestraModal.kindSdk"), hint: tStatic("orchestraModal.kindSdkHint") },
    { value: "claude-cli", label: tStatic("orchestraModal.kindClaude"), hint: tStatic("orchestraModal.kindClaudeHint") },
    { value: "codex-cli", label: tStatic("orchestraModal.kindCodex"), hint: tStatic("orchestraModal.kindCodexHint") },
    { value: "opencode-cli", label: tStatic("orchestraModal.kindOpencode"), hint: tStatic("orchestraModal.kindOpencodeHint") },
    { value: "kimi-cli", label: tStatic("orchestraModal.kindKimi"), hint: tStatic("orchestraModal.kindKimiHint") },
    { value: "gemini-cli", label: tStatic("orchestraModal.kindGemini"), hint: tStatic("orchestraModal.kindGeminiHint") },
    { value: "acp", label: tStatic("orchestraModal.kindAcp"), hint: tStatic("orchestraModal.kindAcpHint") },
  ]
}

const KIND_BINARY: Partial<Record<WorkerKind, string>> = {
  "claude-cli": "claude",
  "codex-cli": "codex",
  "opencode-cli": "opencode",
  "kimi-cli": "kimi",
  "gemini-cli": "gemini",
}

function isAcpKind(k: WorkerKind): boolean {
  return (
    k === "opencode-cli" ||
    k === "claude-cli" ||
    k === "codex-cli" ||
    k === "kimi-cli" ||
    k === "gemini-cli" ||
    k === "acp"
  )
}

function probesModels(k: WorkerKind): boolean {
  return isAcpKind(k) && k !== "gemini-cli"
}

function acpCommandFor(c: WorkerConfig): string {
  if (c.kind === "opencode-cli") return "opencode acp"
  if (c.kind === "claude-cli") return "npx -y @agentclientprotocol/claude-agent-acp"
  if (c.kind === "codex-cli") return "npx -y @zed-industries/codex-acp"
  if (c.kind === "kimi-cli") return "kimi acp"
  if (c.kind === "gemini-cli") return "gemini --experimental-acp"
  return c.acpCommand?.trim() || "opencode acp"
}

const acpModelCache = new Map<
  string,
  { current?: string; models: AcpModelOption[] }
>()
const probedCommands = new Set<string>()

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

  const initialProvider = settings.defaultProvider as ProviderId
  const initialModel = settings.defaultModel

  const [parentProvider, setParentProvider] = useState<ProviderId>(initialProvider)
  const [parentModel, setParentModel] = useState(initialModel)
  const [workers, setWorkers] = useState<WorkerConfig[]>([
    makeDefaultWorker(1, initialProvider, initialModel),
  ])
  const [agentPresets, setAgentPresets] = useState<AgentDef[]>([])

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

  const adapters = useMemo(() => listProviderAdapters(catalog), [catalog])
  const [envHits, setEnvHits] = useState<Record<string, boolean>>({})
  useEffect(() => {
    const unique = Array.from(new Set(adapters.flatMap((p) => p.envVars)))
    if (unique.length === 0) return
    void probeEnvVars(unique).then(setEnvHits)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.envFallback])
  const connectedProviders = useMemo(
    () =>
      adapters
        .filter((p) => isConnectedSync(p, settings, envHits))
        .sort((a, b) => {
          if (Boolean(a.popular) !== Boolean(b.popular)) return a.popular ? -1 : 1
          return a.label.localeCompare(b.label)
        }),
    [adapters, settings, envHits],
  )

  const parentModels = useMemo(
    () => modelsFor(parentProvider, catalog),
    [parentProvider, catalog],
  )

  const yoloCount = workers.filter((w) => w.yolo).length

  const [installedKinds, setInstalledKinds] = useState<Set<WorkerKind> | null>(null)
  useEffect(() => {
    let alive = true
    void (async () => {
      const entries = await Promise.all(
        Object.entries(KIND_BINARY).map(
          async ([kind, bin]) => [kind as WorkerKind, !!(await resolveProgram(bin))] as const,
        ),
      )
      if (alive) setInstalledKinds(new Set(entries.filter(([, ok]) => ok).map(([k]) => k)))
    })()
    return () => {
      alive = false
    }
  }, [])

  const kindOptions = useMemo(
    () =>
      buildKindOptions().filter(
        (o) => !(o.value in KIND_BINARY) || (installedKinds?.has(o.value) ?? false),
      ),
    [installedKinds],
  )

  const [acpByCommand, setAcpByCommand] = useState<
    Record<string, { current?: string; models: AcpModelOption[]; error?: string }>
  >(() => Object.fromEntries(acpModelCache))
  const [acpInflight, setAcpInflight] = useState(0)

  const acpWorkers = workers.filter((w) => probesModels(w.kind))
  const acpConnecting = acpInflight > 0
  const acpError = (() => {
    const errs = acpWorkers
      .map((w) => acpByCommand[acpCommandFor(w)]?.error)
      .filter((e): e is string => !!e)
    return errs.length ? [...new Set(errs)].join(" | ") : null
  })()
  const acpConnected =
    acpWorkers.length > 0 &&
    !acpError &&
    acpWorkers.every((w) => (acpByCommand[acpCommandFor(w)]?.models.length ?? 0) > 0)

  function probeCommands(cmds: string[]) {
    if (cmds.length === 0) return
    const cwd = useSessionsStore.getState().active?.workspacePath
    for (const cmd of cmds) {
      probedCommands.add(cmd)
      setAcpInflight((n) => n + 1)
      void (async () => {
        try {
          const res = await probeAcpModels(cmd, cwd)
          const entry = { current: res.currentModelId, models: res.models }
          acpModelCache.set(cmd, entry)
          setAcpByCommand((prev) => ({ ...prev, [cmd]: entry }))
        } catch (e) {
          probedCommands.delete(cmd)
          setAcpByCommand((prev) => ({ ...prev, [cmd]: { models: [], error: errorMessage(e) } }))
        } finally {
          setAcpInflight((n) => n - 1)
        }
      })()
    }
  }

  useEffect(() => {
    if (!installedKinds) return
    const cmds = [...installedKinds]
      .filter((k) => probesModels(k))
      .map((k) => acpCommandFor({ kind: k } as WorkerConfig))
    probeCommands(cmds.filter((c) => !probedCommands.has(c)))
  }, [installedKinds])

  const acpCmdKey = [...new Set(acpWorkers.map(acpCommandFor))].sort().join("|")
  useEffect(() => {
    const cmds = acpCmdKey ? acpCmdKey.split("|") : []
    probeCommands(cmds.filter((c) => c && !probedCommands.has(c)))
  }, [acpCmdKey])

  useEffect(() => {
    setWorkers((ws) => {
      let changed = false
      const next = ws.map((w) => {
        if (!isAcpKind(w.kind) || w.model) return w
        const r = acpByCommand[acpCommandFor(w)]
        const pick = r?.current ?? r?.models[0]?.modelId
        if (!pick) return w
        changed = true
        return { ...w, model: pick }
      })
      return changed ? next : ws
    })
  }, [acpByCommand, acpCmdKey])

  function connectAllAcp() {
    probeCommands([...new Set(acpWorkers.map(acpCommandFor))])
  }

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
    const store = useSessionsStore.getState()
    store.updateActiveMeta({ provider: parentProvider, model: parentModel })
    onClose()
  }

  return (
    <Dialog
      onClose={onClose}
      label={t("orchestraModal.headerTitle")}
      align="start"
      backdropClassName="z-50"
      panelClassName="mt-[10vh] flex max-h-[80vh] w-[760px] max-w-[94vw] flex-col overflow-hidden rounded-xl border border-codezal bg-codezal-panel shadow-2xl"
      closeOnBackdrop={false}
    >
        <div className="flex items-center gap-2.5 border-b border-codezal px-4 py-3">
          <Music className="h-4 w-4 text-codezal-accent" aria-hidden />
          <span className="text-base font-semibold text-codezal-text">
            {t("orchestraModal.headerTitle")}
          </span>
          <span className="rounded-full bg-codezal-chip px-2 py-0.5 text-sm font-medium text-codezal-mute">
            {t("orchestraModal.workerCount", { count: workers.length })}
          </span>
          <div className="flex-1" />
          <button
            type="button"
            onClick={onClose}
            aria-label={t("common.close")}
            className="rounded-md p-1 text-codezal-mute transition-colors hover:bg-codezal-chip hover:text-codezal-text"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>

        <div className="flex-1 space-y-4 overflow-auto px-4 py-4 text-sm">
          <section className="rounded-lg border border-codezal-strong bg-codezal-input/30 p-3.5">
            <div className="mb-2.5 text-sm font-semibold uppercase tracking-wide text-codezal-dim">
              {t("orchestraModal.parentTitle")}
            </div>
            <div className="flex flex-wrap items-center gap-2.5">
              <select
                value={parentProvider}
                aria-label={t("composer.switchProvider")}
                onChange={(e) => {
                  const p = e.target.value as ProviderId
                  setParentProvider(p)
                  setParentModel(defaultModelFor(p, catalog))
                }}
                className="codezal-select-sm w-[160px] shrink-0"
              >
                {connectedProviders.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </select>
              <select
                value={parentModel}
                aria-label={t("composer.switchModel")}
                onChange={(e) => setParentModel(e.target.value)}
                className="codezal-select-sm min-w-[200px] flex-1"
              >
                {parentModels.map((m) => (
                  <option key={m} value={m}>
                    {modelDetail(catalog, parentProvider, m)?.name?.trim() || m}
                  </option>
                ))}
              </select>
              <span className="text-sm text-codezal-mute">
                {t("orchestraModal.parentHint")}
              </span>
            </div>
          </section>

          <section>
            <div className="mb-2.5 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-codezal-dim">
              {t("orchestraModal.workerHeading")}
              <div className="flex-1" />
              {acpWorkers.length > 0 && (
                <button
                  type="button"
                  onClick={connectAllAcp}
                  disabled={acpConnecting}
                  title={acpError ?? t("orchestraModal.acpConnectTitle")}
                  className={cn(
                    "flex items-center gap-1 rounded-md border px-2.5 py-1 text-sm font-medium normal-case tracking-normal transition-colors disabled:opacity-50",
                    acpError
                      ? "border-destructive text-destructive"
                      : acpConnected
                        ? "border-emerald-400/60 text-emerald-400"
                        : "border-codezal text-codezal-dim hover:border-codezal-strong hover:text-codezal-text",
                  )}
                >
                  {acpConnecting
                    ? t("orchestraModal.acpConnecting")
                    : acpConnected
                      ? `${t("orchestraModal.acpConnect")} ✓`
                      : t("orchestraModal.acpConnect")}
                </button>
              )}
              <button
                type="button"
                onClick={addWorker}
                disabled={workers.length >= 5}
                className={cn(
                  "flex items-center gap-1 rounded-md border border-codezal px-2.5 py-1 text-sm font-medium normal-case tracking-normal transition-colors",
                  workers.length >= 5
                    ? "cursor-not-allowed text-codezal-mute"
                    : "text-codezal-dim hover:border-codezal-strong hover:text-codezal-text",
                )}
              >
                <Plus className="h-3.5 w-3.5" /> {t("orchestraModal.addWorker")}
              </button>
            </div>

            <div className="space-y-2">
              {workers.map((w) => (
                <WorkerRow
                  key={w.idx}
                  config={w}
                  kindOptions={kindOptions}
                  agentPresets={agentPresets}
                  catalog={catalog}
                  canRemove={workers.length > 1}
                  onChange={(patch) => updateWorker(w.idx, patch)}
                  onRemove={() => removeWorker(w.idx)}
                  onPickPreset={(name) => applyPreset(w.idx, name)}
                  acpModels={acpByCommand[acpCommandFor(w)]?.models ?? []}
                  providers={connectedProviders.map((p) => ({ id: p.id, label: p.label }))}
                />
              ))}
            </div>
          </section>

          {yoloCount > 0 && (
            <div className="flex items-start gap-2 rounded-md border border-codezal-accent/60 bg-codezal-accent/20 p-2.5 text-sm text-codezal-text">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-codezal-accent" />
              <div>
                <span className="font-semibold text-codezal-accent">
                  {t("orchestraModal.yoloCountWarn", { count: yoloCount })}
                </span>{" "}
                {t("orchestraModal.yoloMsg")}
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center gap-2.5 border-t border-codezal px-4 py-3">
          <span className="min-w-0 flex-1 truncate text-sm text-codezal-mute">
            {t("orchestraModal.startHint")}
          </span>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-md border border-codezal px-3 py-1.5 text-sm text-codezal-dim transition-colors hover:border-codezal-strong hover:text-codezal-text"
          >
            {t("orchestraModal.cancel")}
          </button>
          <button
            type="button"
            onClick={handleStart}
            className="flex shrink-0 items-center gap-1.5 rounded-md bg-accent px-3.5 py-1.5 text-sm font-semibold text-accent-foreground shadow-sm transition-[filter] hover:brightness-95"
          >
            <Music className="h-4 w-4" /> {t("orchestraModal.start")}
          </button>
        </div>
    </Dialog>
  )
}

type WorkerRowProps = {
  config: WorkerConfig
  kindOptions: { value: WorkerKind; label: string; hint: string }[]
  agentPresets: AgentDef[]
  catalog: Parameters<typeof modelsFor>[1]
  canRemove: boolean
  onChange: (patch: Partial<WorkerConfig>) => void
  onRemove: () => void
  onPickPreset: (name: string) => void
  acpModels: AcpModelOption[]
  providers: { id: ProviderId; label: string }[]
}

function WorkerRow({
  config,
  kindOptions,
  agentPresets,
  catalog,
  canRemove,
  onChange,
  onRemove,
  onPickPreset,
  acpModels,
  providers,
}: WorkerRowProps) {
  const t = useT()
  const isSdk = config.kind === "sdk"
  const isAcp = config.kind === "acp"
  // komut implicit, model listesi Connect probe ile gelir.
  const usesAcp = isAcpKind(config.kind)
  const provider = (config.provider ?? "anthropic") as ProviderId
  const models = useMemo(() => modelsFor(provider, catalog), [provider, catalog])

  return (
    <div className="flex items-center gap-2 rounded-lg border border-codezal bg-codezal-input/20 px-3 py-2">
      <span className="shrink-0 rounded bg-codezal-chip px-1.5 py-0.5 text-sm font-medium tabular-nums text-codezal-text">
        worker-{config.idx}
      </span>

      <select
        value={config.kind}
        aria-label={`worker-${config.idx} · ${t("orchestraModal.workerHeading")}`}
        onChange={(e) => onChange({ kind: e.target.value as WorkerKind })}
        className="codezal-select-sm w-[132px] shrink-0"
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
            aria-label={`worker-${config.idx} · ${t("orchestraModal.workerProvider")}`}
            onChange={(e) => {
              const p = e.target.value as ProviderId
              onChange({ provider: p, model: undefined })
            }}
            className="codezal-select-sm w-[124px] shrink-0"
          >
            {providers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
          <select
            value={config.model ?? models[0] ?? ""}
            aria-label={`worker-${config.idx} · ${t("orchestraModal.workerModel")}`}
            onChange={(e) => onChange({ model: e.target.value })}
            className="codezal-select-sm min-w-[140px] flex-1"
          >
            {models.map((m) => (
              <option key={m} value={m}>
                {modelDetail(catalog, provider, m)?.name?.trim() || m}
              </option>
            ))}
          </select>
        </>
      )}

      {usesAcp && (
        <>
          {isAcp && (
            <input
              type="text"
              value={config.acpCommand ?? ""}
              onChange={(e) => onChange({ acpCommand: e.target.value })}
              placeholder={t("orchestraModal.acpCommandPlaceholder")}
              className="h-[30px] w-[130px] shrink-0 rounded-md border border-codezal bg-codezal-input px-2.5 text-sm text-codezal-text transition-colors focus:border-codezal-accent focus:outline-none"
            />
          )}
          {(acpModels.length > 0 || config.model) && (
            <select
              value={config.model ?? ""}
              aria-label={`worker-${config.idx} · ${t("orchestraModal.workerModel")}`}
              onChange={(e) => onChange({ model: e.target.value })}
              className="codezal-select-sm min-w-[140px] flex-1"
            >
              <option value="">{t("orchestraModal.acpModelSelect")}</option>
              {acpModels.length > 0
                ? acpModels.map((m) => (
                    <option key={m.modelId} value={m.modelId}>
                      {m.name}
                    </option>
                  ))
                : config.model && <option value={config.model}>{config.model}</option>}
            </select>
          )}
        </>
      )}

      <select
        value={config.presetAgent ?? ""}
        onChange={(e) => onPickPreset(e.target.value)}
        className="codezal-select-sm w-[124px] shrink-0"
        title={t("orchestraModal.presetTitle")}
        aria-label={t("orchestraModal.presetTitle")}
      >
        <option value="">{t("orchestraModal.presetEmpty")}</option>
        {agentPresets.map((p) => (
          <option key={p.path} value={p.name}>
            {p.name}
          </option>
        ))}
      </select>

      <label className="flex shrink-0 cursor-pointer items-center gap-1.5 text-sm text-codezal-dim">
        <input
          type="checkbox"
          checked={config.yolo}
          onChange={(e) => onChange({ yolo: e.target.checked })}
          className="h-3.5 w-3.5 accent-codezal-accent"
        />
        {t("orchestraModal.yoloLabel")}
      </label>

      {canRemove && (
        <button
          type="button"
          onClick={onRemove}
          title={t("orchestraModal.removeWorkerTitle")}
          className="shrink-0 rounded-md p-1 text-codezal-mute transition-colors hover:bg-codezal-chip hover:text-destructive"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      )}
    </div>
  )
}
