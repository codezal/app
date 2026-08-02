import type { ProviderId } from "@/lib/providers"

export type AgentEngineRef =
  | { kind: "sdk"; providerId: ProviderId; modelId: string }
  | { kind: "acp"; providerId: string; modelId?: string; command?: string }

export type EngineCapabilities = {
  session: "stateless" | "resumable"
  cwd: "per-run" | "fixed-session"
  tools: "sdk" | "mcp" | "native"
  permissions: "codezal" | "unsupported"
  usage: "exact" | "partial" | "none"
  cancellation: "cooperative" | "hard"
}

// Fixed orchestration roles. Every role resolves to a provider/model pair
// (optional — unset fields inherit the session's provider/model), so users can
// route cheap models to easy tasks and strong models to hard ones.
export type AgentRoleId = "orchestrator" | "planner" | "worker" | "reviewer" | "small"

export const AGENT_ROLES: AgentRoleId[] = [
  "orchestrator",
  "planner",
  "worker",
  "reviewer",
  "small",
]

// Per-role model mapping. Empty provider/model → inherit session model.
export type RoleModelConfig = {
  provider?: ProviderId
  model?: string
}

export type SupervisorSettings = {
  enabled: boolean
  routing: "hybrid"
  autoDelegate: boolean
  // When on, a reviewer run reviews the merged diff after a delegation and
  // appends structured findings (uses the `reviewer` role).
  autoReview: boolean
  maxParallelRuns: number
  maxChildRunsPerTurn: number
  maxDepth: 1
  maxWallClockMs: number
  isolation: "auto" | "none" | "worktree"
  mergePolicy: "safe-auto" | "manual"
  roles: Partial<Record<AgentRoleId, RoleModelConfig>>
}

export type AgentRunContext = {
  parentSummary?: string
  selectedFiles?: string[]
  workspace?: string
  baseRevision?: string
}

export type AgentRunSpec = {
  runId: string
  parentRunId: string
  sessionId: string
  depth: number
  agentName: string
  // Resolved by the executor (role → engine); the supervisor itself stays
  // engine-agnostic.
  engine?: AgentEngineRef
  task: string
  context?: AgentRunContext
  signal: AbortSignal
}

export type AgentRunResult = {
  status: "done" | "error" | "aborted"
  output: string
  durationMs: number
  tokensIn?: number
  tokensOut?: number
  costUsd?: number
  errorMessage?: string
  isolated?: boolean
  branch?: string
  committed?: boolean
  changedFiles?: string[]
  diffSummary?: string
  isolationNote?: string
  value?: unknown
}

export type AgentRun = {
  runId: string
  parentRunId: string
  sessionId: string
  poolEntryId: string
  task: string
  status: "running" | AgentRunResult["status"]
  startedAt: number
  finishedAt?: number
  output?: string
  errorMessage?: string
  durationMs?: number
}

export type AgentRunEvent =
  | { type: "started"; runId: string }
  | { type: "text-delta"; runId: string; delta: string }
  | { type: "tool-call"; runId: string; name: string; id?: string }
  | { type: "tool-result"; runId: string; name: string; id?: string; isError?: boolean }
  | { type: "waiting-approval"; runId: string; toolName: string }
  | { type: "usage"; runId: string; tokensIn?: number; tokensOut?: number; costUsd?: number }
  | { type: "completed"; runId: string; result: AgentRunResult }

export type SupervisorDispatch = {
  sessionId: string
  parentRunId: string
  depth: number
  existingChildCount?: number
  context?: AgentRunContext
  signal?: AbortSignal
  dispatches: Array<{ role: AgentRoleId; task: string }>
}

export type AgentRunExecutor = (run: AgentRunSpec) => Promise<AgentRunResult>
