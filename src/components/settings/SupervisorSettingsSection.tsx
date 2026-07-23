import { createId } from "@/lib/id"
import type { AgentEngineRef, SupervisorPoolEntry } from "@/lib/agents/runtime"
import { useT } from "@/lib/i18n/useT"
import { useSettingsStore } from "@/store/settings"
import { Row, Section, Toggle } from "./primitives"

export function SupervisorSettingsSection() {
  const t = useT()
  const settings = useSettingsStore((state) => state.settings)
  const update = useSettingsStore((state) => state.update)
  const supervisor = settings.supervisor
  const patchSupervisor = (next: Partial<typeof supervisor>) =>
    void update({ supervisor: { ...supervisor, ...next } })
  const patchEntry = (id: string, next: Partial<SupervisorPoolEntry>) =>
    patchSupervisor({
      pool: supervisor.pool.map((entry) => (entry.id === id ? { ...entry, ...next } : entry)),
    })
  const addEntry = () =>
    patchSupervisor({
      pool: [
        ...supervisor.pool,
        {
          id: createId("worker"),
          agentName: "general",
          enabled: true,
          engine: { kind: "native-cli", providerId: "codex-cli", modelId: "gpt-5.4" },
        },
      ],
    })

  return (
    <Section title={t("settings.cliAgents.supervisorTitle")} description={t("settings.cliAgents.supervisorDesc")}>
      <Row label={t("settings.cliAgents.supervisorEnabled")}>
        <Toggle
          label={t("settings.cliAgents.supervisorEnabled")}
          checked={supervisor.enabled}
          onChange={(enabled) => patchSupervisor({ enabled })}
        />
      </Row>
      <LimitRow
        label={t("settings.cliAgents.supervisorParallel")}
        value={supervisor.maxParallelRuns}
        onChange={(maxParallelRuns) => patchSupervisor({ maxParallelRuns })}
      />
      <LimitRow
        label={t("settings.cliAgents.supervisorChildren")}
        value={supervisor.maxChildRunsPerTurn}
        onChange={(maxChildRunsPerTurn) => patchSupervisor({ maxChildRunsPerTurn })}
      />
      <div className="mt-4 space-y-3">
        <div className="text-md font-semibold text-codezal-text">{t("settings.cliAgents.supervisorPool")}</div>
        {supervisor.pool.length === 0 ? (
          <div className="rounded-md border border-dashed border-codezal px-3 py-4 text-sm text-codezal-mute">
            {t("settings.cliAgents.supervisorPoolEmpty")}
          </div>
        ) : (
          supervisor.pool.map((entry) => (
            <SupervisorPoolRow
              key={entry.id}
              entry={entry}
              onPatch={(next) => patchEntry(entry.id, next)}
              onRemove={() => patchSupervisor({ pool: supervisor.pool.filter((item) => item.id !== entry.id) })}
              defaultProvider={settings.defaultProvider}
              defaultModel={settings.defaultModel}
            />
          ))
        )}
        <button type="button" onClick={addEntry} className="rounded-md border border-codezal px-3 py-1.5 text-base text-codezal-text hover:bg-codezal-panel-2">
          {t("settings.cliAgents.supervisorAdd")}
        </button>
      </div>
    </Section>
  )
}

function LimitRow({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) {
  return (
    <Row label={label}>
      <input
        type="number"
        min={1}
        max={5}
        value={value}
        onChange={(event) => onChange(Math.max(1, Math.min(5, Number(event.target.value) || 1)))}
        className="w-20 rounded-md border border-codezal bg-codezal-input px-2 py-1 text-base text-codezal-text"
      />
    </Row>
  )
}

function SupervisorPoolRow({ entry, onPatch, onRemove, defaultProvider, defaultModel }: {
  entry: SupervisorPoolEntry
  onPatch: (next: Partial<SupervisorPoolEntry>) => void
  onRemove: () => void
  defaultProvider: string
  defaultModel: string
}) {
  const t = useT()
  const patchEngine = (next: Partial<AgentEngineRef>) => onPatch({ engine: { ...entry.engine, ...next } as AgentEngineRef })
  const changeKind = (kind: AgentEngineRef["kind"]) => {
    const engine: AgentEngineRef = kind === "sdk"
      ? { kind, providerId: defaultProvider, modelId: defaultModel }
      : kind === "native-cli"
        ? { kind, providerId: "codex-cli", modelId: "gpt-5.4" }
        : { kind, providerId: "gemini-cli", modelId: "gemini-2.5-pro" }
    onPatch({ engine })
  }
  return (
    <div className="rounded-md border border-codezal p-3">
      <div className="grid gap-2 md:grid-cols-4">
        <input aria-label={t("settings.cliAgents.supervisorAgent")} value={entry.agentName} onChange={(event) => onPatch({ agentName: event.target.value })} placeholder="general" className="rounded-md border border-codezal bg-codezal-input px-2 py-1 text-base text-codezal-text" />
        <select aria-label={t("settings.cliAgents.supervisorEngine")} value={entry.engine.kind} onChange={(event) => changeKind(event.target.value as AgentEngineRef["kind"])} className="rounded-md border border-codezal bg-codezal-input px-2 py-1 text-base text-codezal-text">
          <option value="sdk">SDK</option><option value="native-cli">Native CLI</option><option value="acp">ACP</option>
        </select>
        {entry.engine.kind === "native-cli" ? (
          <select aria-label={t("settings.cliAgents.supervisorProvider")} value={entry.engine.providerId} onChange={(event) => patchEngine({ providerId: event.target.value as "codex-cli" | "claude-cli" })} className="rounded-md border border-codezal bg-codezal-input px-2 py-1 text-base text-codezal-text">
            <option value="codex-cli">Codex CLI</option><option value="claude-cli">Claude CLI</option>
          </select>
        ) : (
          <input aria-label={t("settings.cliAgents.supervisorProvider")} value={entry.engine.providerId} onChange={(event) => patchEngine({ providerId: event.target.value })} className="rounded-md border border-codezal bg-codezal-input px-2 py-1 text-base text-codezal-text" />
        )}
        <input aria-label={t("settings.cliAgents.supervisorModel")} value={entry.engine.modelId ?? ""} onChange={(event) => patchEngine({ modelId: event.target.value })} className="rounded-md border border-codezal bg-codezal-input px-2 py-1 text-base text-codezal-text" />
      </div>
      <div className="mt-2 flex items-center justify-between">
        <Toggle label={entry.label ?? entry.agentName} checked={entry.enabled} onChange={(enabled) => onPatch({ enabled })} />
        <button type="button" onClick={onRemove} className="text-sm text-codezal-danger hover:underline">{t("settings.cliAgents.supervisorRemove")}</button>
      </div>
    </div>
  )
}
