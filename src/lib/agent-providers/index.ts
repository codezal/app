import type { Settings } from "@/store/types"
import type { ProviderId } from "@/lib/providers"
import type {
  AgentProviderLike,
  AgentProvidersSettings,
  AgentRuntimeModeInput,
  CliAgentModel,
  CliAgentProviderDefinition,
  CliAgentProviderId,
  CliAgentProviderSettings,
  NativeAgentMode,
} from "./types"

export const CLI_AGENT_PROVIDERS: CliAgentProviderDefinition[] = [
  {
    id: "codex-cli",
    label: "Codex CLI",
    defaultModel: "gpt-5.6-sol",
    fallbackModels: [
      "gpt-5.6-sol",
      "gpt-5.6-terra",
      "gpt-5.6-luna",
      "gpt-5.5",
      "gpt-5.4",
      "gpt-5.4-mini",
      "gpt-5.3-codex-spark",
    ],
    defaultCommand: "codex app-server",
  },
  {
    id: "claude-cli",
    label: "Claude CLI",
    defaultModel: "opus-4.6",
    fallbackModels: ["opus-4.6", "sonnet-4.5"],
    defaultCommand: "claude",
  },
]

export function isCliAgentProvider(id: ProviderId | string | undefined): id is CliAgentProviderId {
  return id === "codex-cli" || id === "claude-cli"
}

export function cliAgentDefinition(id: CliAgentProviderId): CliAgentProviderDefinition {
  const found = CLI_AGENT_PROVIDERS.find((p) => p.id === id)
  if (!found) throw new Error(`Unknown CLI agent provider: ${id}`)
  return found
}

export function agentProviderSettings(
  settings: Settings,
  id: CliAgentProviderId,
): CliAgentProviderSettings {
  const stored = settings.agentProviders?.[id]
  return {
    ...stored,
    enabled: stored?.enabled ?? true,
    injectCodezalTools: stored?.injectCodezalTools ?? true,
    order: stored?.order,
  }
}

export function defaultAgentProvidersSettings(): AgentProvidersSettings {
  return {
    "codex-cli": { enabled: true, injectCodezalTools: true, order: 0 },
    "claude-cli": { enabled: true, injectCodezalTools: true, order: 1 },
  }
}

export function listVisibleAgentProviders(settings: Settings): AgentProviderLike[] {
  return [...CLI_AGENT_PROVIDERS]
    .filter((p) => agentProviderSettings(settings, p.id).enabled !== false)
    .sort((a, b) => {
      const aa = agentProviderSettings(settings, a.id).order ?? 0
      const bb = agentProviderSettings(settings, b.id).order ?? 0
      if (aa !== bb) return aa - bb
      return a.label.localeCompare(b.label)
    })
    .map((p) => ({ id: p.id as ProviderId, label: p.label, popular: true }))
}

export function modelsForAgentProvider(id: CliAgentProviderId, settings: Settings): string[] {
  return modelDefinitionsForAgentProvider(id, settings).map((model) => model.id)
}

export function modelDefinitionsForAgentProvider(
  id: CliAgentProviderId,
  settings: Settings,
): CliAgentModel[] {
  const stored = agentProviderSettings(settings, id)
  const custom = stored.models?.filter((m) => m.trim())
  const discovered = (stored.discoveredModels ?? []).filter((model) => model.id.trim())
  if (custom?.length) {
    return uniqueModels([
      ...custom.map((model) => ({ id: model, label: model, source: "custom" as const })),
      ...discovered,
    ])
  }
  if (discovered.length) return uniqueModels(discovered)
  return cliAgentDefinition(id).fallbackModels.map((model) => ({
    id: model,
    label: model,
    source: "fallback" as const,
  }))
}

export function defaultModelForAgentProvider(id: CliAgentProviderId, settings: Settings): string {
  return modelsForAgentProvider(id, settings)[0] ?? cliAgentDefinition(id).defaultModel
}

export function resolveNativeAgentMode(input: AgentRuntimeModeInput): NativeAgentMode {
  if (input.sessionMode === "plan") return "plan"
  if (input.approvalMode === "bypass") return "bypass"
  if (input.approvalMode === "auto-review") return "auto-review"
  return "ask"
}

export type {
  AgentProvidersSettings,
  AgentRuntimeDiagnostic,
  AgentRuntimeEvent,
  AgentRuntimePermissionRequest,
  CliAgentModel,
  CliAgentProviderId,
  CliAgentProviderSettings,
  NativeAgentHandle,
  NativeAgentMode,
} from "./types"

function uniqueModels(models: CliAgentModel[]): CliAgentModel[] {
  const seen = new Set<string>()
  const out: CliAgentModel[] = []
  for (const model of models) {
    const id = model.id.trim()
    if (!id || seen.has(id)) continue
    seen.add(id)
    out.push({ ...model, id })
  }
  return out
}
