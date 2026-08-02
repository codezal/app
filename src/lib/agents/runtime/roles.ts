// Role → engine resolution. Every orchestration role maps to an optional
// provider/model pair in SupervisorSettings.roles; unset fields inherit the
// session's provider/model so the system works with zero configuration and
// users only pin roles they want to route to a different (usually cheaper)
// model.
import type { ProviderId } from "@/lib/providers"
import type { Session } from "@/store/types"
import type { WorkerConfig } from "@/lib/orchestra/types"
import type { AgentEngineRef, AgentRoleId, RoleModelConfig, SupervisorSettings } from "./types"
import { AGENT_ROLES } from "./types"

// Resolve a role to a concrete engine, or null when the role is not pinned
// (inherit the session's provider/model).
export function resolveRoleEngine(
  settings: SupervisorSettings,
  role: AgentRoleId,
  _session?: Session,
): AgentEngineRef | null {
  const cfg = settings.roles?.[role]
  const provider = cfg?.provider
  const model = cfg?.model
  if (!provider || !model) return null
  return { kind: "sdk", providerId: provider, modelId: model }
}

// Effective provider/model for a root run. Plan-mode runs use the `planner`
// role, build-mode runs use the `orchestrator` role; explicit per-turn
// overrides (slash command `model:` frontmatter) win over role pinning.
export function resolveMainEngine(input: {
  settings: SupervisorSettings
  session: Session
  mode: "build" | "plan"
  override?: { provider?: ProviderId; model?: string } | null
}): { provider: ProviderId; model: string } {
  const role: AgentRoleId = input.mode === "plan" ? "planner" : "orchestrator"
  // Explicit per-turn override (slash command `model:` frontmatter) wins over
  // role pinning.
  const overrideProvider = input.override?.provider
  const overrideModel = input.override?.model
  if (overrideProvider || overrideModel) {
    return {
      provider: overrideProvider ?? input.session.provider,
      model: overrideModel ?? input.session.model,
    }
  }
  const pinned = resolveRoleEngine(input.settings, role, input.session)
  if (pinned && pinned.kind === "sdk") {
    return { provider: pinned.providerId, model: pinned.modelId }
  }
  return {
    provider: input.session.provider,
    model: input.session.model,
  }
}

// Build the WorkerConfig for a delegated child run of a given role.
export function workerConfigForRole(input: {
  role: AgentRoleId
  engine: AgentEngineRef
  idx: number
  session: Session
  // Optional per-run system prompt (e.g. the reviewer contract). Takes
  // precedence over preset agents so role prompts are deterministic.
  systemPrompt?: string
  label?: string
}): WorkerConfig {
  const provider =
    input.engine.kind === "sdk" ? input.engine.providerId : input.session.provider
  const model = input.engine.kind === "sdk" ? input.engine.modelId : input.session.model
  return {
    idx: input.idx,
    kind: "sdk",
    provider,
    model,
    yolo: false,
    label: input.label ?? input.role,
    systemPrompt: input.systemPrompt,
    readOnly: input.role === "reviewer",
  }
}

// Readable catalog block for the system prompt: which roles are pinned to
// which provider/model, and which inherit the session model.
export function rolesCatalogForPrompt(
  settings: SupervisorSettings,
  session: { provider: ProviderId; model: string },
): string {
  const lines = [
    "## AGENT ORCHESTRATION",
    "You orchestrate a team of child agents. Delegate independent subtasks with delegate_agents (role: \"worker\") and request code review with review_changes.",
    "Synthesize all child results yourself. Child agents cannot delegate further.",
    "",
  ]
  for (const role of AGENT_ROLES) {
    const cfg: RoleModelConfig | undefined = settings.roles?.[role]
    if (cfg?.provider && cfg.model) {
      lines.push(`- **${role}**: ${cfg.provider}/${cfg.model}`)
    } else {
      lines.push(`- **${role}**: inherits the session model (${session.provider}/${session.model})`)
    }
  }
  return lines.join("\n")
}
