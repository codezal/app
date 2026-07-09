import type { ProviderId } from "@/lib/providers"
import type { ApprovalMode } from "@/store/types"

export type CliAgentProviderId = "codex-cli" | "claude-cli"

export type CliAgentProviderSettings = {
  enabled?: boolean
  order?: number
  command?: string
  env?: Record<string, string>
  injectCodezalTools?: boolean
  models?: string[]
  discoveredModels?: CliAgentModel[]
  modelsFetchedAt?: number
  lastStatus?: "available" | "missing" | "error"
  lastVersion?: string
  lastError?: string
  lastCheckedAt?: number
}

export type AgentProvidersSettings = Partial<Record<CliAgentProviderId, CliAgentProviderSettings>>

export type CliAgentModel = {
  id: string
  label?: string
  description?: string
  source?: "runtime" | "custom" | "fallback"
}

export type CliAgentProviderDefinition = {
  id: CliAgentProviderId
  label: string
  defaultModel: string
  fallbackModels: string[]
  defaultCommand: string
}

export type NativeAgentHandle = {
  providerId: CliAgentProviderId
  runtimeSessionId?: string
  nativeHandle?: string
  cwd?: string
  model?: string
  mode?: NativeAgentMode
}

export type NativeAgentMode = "ask" | "auto-review" | "bypass" | "plan"

export type AgentRuntimeEvent =
  | { type: "thread_started"; providerId: CliAgentProviderId; sessionId: string; nativeHandle?: string }
  | { type: "turn_started"; providerId: CliAgentProviderId; sessionId: string; turnId: string }
  | { type: "text_delta"; providerId: CliAgentProviderId; sessionId: string; turnId?: string; delta: string }
  | { type: "reasoning_delta"; providerId: CliAgentProviderId; sessionId: string; turnId?: string; delta: string }
  | { type: "tool_call"; providerId: CliAgentProviderId; sessionId: string; turnId?: string; id: string; name: string; input?: unknown }
  | { type: "tool_result"; providerId: CliAgentProviderId; sessionId: string; turnId?: string; id: string; name: string; output?: string; isError?: boolean }
  | { type: "permission_requested"; providerId: CliAgentProviderId; sessionId: string; turnId?: string; request: AgentRuntimePermissionRequest }
  | { type: "permission_resolved"; providerId: CliAgentProviderId; sessionId: string; turnId?: string; requestId: string; decision: "allow" | "deny" }
  | { type: "usage"; providerId: CliAgentProviderId; sessionId: string; turnId?: string; inputTokens?: number; outputTokens?: number; reasoningTokens?: number; costUsd?: number }
  | { type: "turn_completed"; providerId: CliAgentProviderId; sessionId: string; turnId: string; nativeHandle?: string }
  | { type: "turn_failed"; providerId: CliAgentProviderId; sessionId: string; turnId: string; error: string }
  | { type: "turn_canceled"; providerId: CliAgentProviderId; sessionId: string; turnId: string }
  | { type: "stderr"; providerId?: CliAgentProviderId; sessionId?: string; turnId?: string; line: string }

export type AgentRuntimePermissionRequest = {
  id: string
  providerId: CliAgentProviderId
  name: string
  title: string
  input?: unknown
  metadata?: Record<string, unknown>
}

export type AgentRuntimeDiagnostic = {
  providerId: CliAgentProviderId
  command: string
  exists: boolean
  version: string | null
  runtime: { bun: string | null; node: string | null }
  sdk: boolean | null
  sdkError: string | null
}

export type AgentRuntimeModeInput = {
  approvalMode: ApprovalMode
  sessionMode?: "build" | "plan" | "orchestra"
}

export type AgentProviderLike = {
  id: ProviderId
  label: string
  popular?: boolean
}
