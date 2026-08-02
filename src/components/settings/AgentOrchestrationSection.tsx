// Agent Orchestration settings — per-role model routing.
//
// Each orchestration role (orchestrator / planner / worker / reviewer / small)
// can be pinned to a provider/model pair. Unset roles inherit the session's
// provider/model, so the system works with zero configuration and users only
// pin roles they want to route to a different (usually cheaper) model.
import { useT } from "@/lib/i18n/useT"
import { useSettingsStore } from "@/store/settings"
import { Row, Section, Toggle } from "./primitives"
import { listProviderAdapters, modelsFor, isConnectedSync } from "@/lib/providers"
import type { AgentRoleId, RoleModelConfig, SupervisorSettings } from "@/lib/agents/runtime"
import type { ProvidersCatalog } from "@/lib/providers-catalog"

// UI display order (orchestrator first — the "brain").
const ROLE_ORDER: AgentRoleId[] = ["orchestrator", "planner", "worker", "reviewer", "small"]

// Typed i18n keys per role (template literals can't be type-checked against the
// Messages key union, so map explicitly).
const ROLE_LABEL_KEY = {
  orchestrator: "settings.cliAgents.roleOrchestrator",
  planner: "settings.cliAgents.rolePlanner",
  worker: "settings.cliAgents.roleWorker",
  reviewer: "settings.cliAgents.roleReviewer",
  small: "settings.cliAgents.roleSmall",
} as const
const ROLE_DESC_KEY = {
  orchestrator: "settings.cliAgents.roleDescOrchestrator",
  planner: "settings.cliAgents.roleDescPlanner",
  worker: "settings.cliAgents.roleDescWorker",
  reviewer: "settings.cliAgents.roleDescReviewer",
  small: "settings.cliAgents.roleDescSmall",
} as const

export function AgentOrchestrationSection() {
  const t = useT()
  const settings = useSettingsStore((state) => state.settings)
  const update = useSettingsStore((state) => state.update)
  const supervisor = settings.supervisor
  const catalog = settings.providerCatalog?.data as ProvidersCatalog | undefined
  const patchSupervisor = (next: Partial<SupervisorSettings>) =>
    void update({ supervisor: { ...supervisor, ...next } })
  const patchRole = (role: AgentRoleId, next: Partial<RoleModelConfig>) =>
    patchSupervisor({ roles: { ...supervisor.roles, [role]: { ...supervisor.roles[role], ...next } } })
  const clearRole = (role: AgentRoleId) => {
    const roles = { ...supervisor.roles }
    delete roles[role]
    patchSupervisor({ roles })
  }

  return (
    <Section title={t("settings.cliAgents.supervisorTitle")} description={t("settings.cliAgents.supervisorDesc")}>
      <Row label={t("settings.cliAgents.supervisorEnabled")}>
        <Toggle
          label={t("settings.cliAgents.supervisorEnabled")}
          checked={supervisor.enabled}
          onChange={(enabled) => patchSupervisor({ enabled })}
        />
      </Row>
      <Row label={t("settings.cliAgents.autoReview")} description={t("settings.cliAgents.autoReviewDesc")}>
        <Toggle
          label={t("settings.cliAgents.autoReview")}
          checked={supervisor.autoReview}
          onChange={(autoReview) => patchSupervisor({ autoReview })}
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
        <div className="text-md font-semibold text-codezal-text">{t("settings.cliAgents.rolesTitle")}</div>
        {ROLE_ORDER.map((role) => (
          <RoleRow
            key={role}
            label={t(ROLE_LABEL_KEY[role])}
            description={t(ROLE_DESC_KEY[role])}
            config={supervisor.roles?.[role]}
            defaultProvider={settings.defaultProvider}
            defaultModel={settings.defaultModel}
            catalog={catalog}
            settings={settings}
            onPatch={(next) => patchRole(role, next)}
            onClear={() => clearRole(role)}
          />
        ))}
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

function RoleRow({
  label,
  description,
  config,
  defaultProvider,
  defaultModel,
  catalog,
  settings,
  onPatch,
  onClear,
}: {
  label: string
  description: string
  config?: RoleModelConfig
  defaultProvider: Parameters<typeof isConnectedSync>[0]["id"]
  defaultModel: string
  catalog?: ProvidersCatalog
  settings: ReturnType<typeof useSettingsStore.getState>["settings"]
  onPatch: (next: Partial<RoleModelConfig>) => void
  onClear: () => void
}) {
  const t = useT()
  const pinned = Boolean(config?.provider && config.model)
  const providerId = (config?.provider ?? defaultProvider) as Parameters<typeof isConnectedSync>[0]["id"]
  const providers = listProviderAdapters(catalog).filter((p) => isConnectedSync(p, settings))
  const modelOptions = modelsFor(providerId, catalog, settings.modelStatus)
  const currentModel = config?.model ?? (modelOptions.includes(defaultModel) ? defaultModel : modelOptions[0] ?? "")

  return (
    <div className="rounded-md border border-codezal p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="text-md font-semibold text-codezal-text">{label}</div>
          <div className="text-sm text-codezal-mute">{description}</div>
        </div>
        <div className="flex items-center gap-3">
          {!pinned && (
            <span className="rounded bg-codezal-chip px-1.5 py-0.5 text-sm text-codezal-mute">
              {t("settings.cliAgents.roleInherit")}
            </span>
          )}
          <button
            type="button"
            onClick={() => (pinned ? onClear() : onPatch({ provider: defaultProvider, model: defaultModel }))}
            className="text-sm text-codezal-accent hover:underline"
          >
            {pinned ? t("settings.cliAgents.roleInherit") : t("settings.cliAgents.rolePin")}
          </button>
        </div>
      </div>
      {pinned && (
        <div className="mt-2 grid gap-2 md:grid-cols-2">
          <select
            aria-label={`${label} · ${t("settings.cliAgents.roleProvider")}`}
            value={providerId}
            onChange={(event) => {
              const pid = event.target.value as Parameters<typeof isConnectedSync>[0]["id"]
              const firstModel = modelsFor(pid, catalog, settings.modelStatus)[0] ?? ""
              onPatch({ provider: pid, model: firstModel })
            }}
            className="rounded-md border border-codezal bg-codezal-input px-2 py-1 text-base text-codezal-text"
          >
            {providers.length === 0 && <option value={providerId}>{providerId}</option>}
            {providers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
          <select
            aria-label={`${label} · ${t("settings.cliAgents.roleModel")}`}
            value={currentModel}
            onChange={(event) => onPatch({ model: event.target.value })}
            className="rounded-md border border-codezal bg-codezal-input px-2 py-1 text-base text-codezal-text"
          >
            {modelOptions.length === 0 && <option value={currentModel}>{currentModel || "—"}</option>}
            {modelOptions.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </div>
      )}
    </div>
  )
}
