import type { ProviderId } from "../providers"

// (Connect ile probe edilip model listesi session/new'den gelir). sdk → in-process SDK.
export type WorkerKind =
  | "sdk"
  | "opencode-cli"
  | "kimi-cli"
  | "gemini-cli"
  | "acp"

export type WorkerConfig = {
  idx: number
  kind: WorkerKind
  provider?: ProviderId
  model?: string
  yolo: boolean
  presetAgent?: string
  acpCommand?: string
  label?: string
  // Deterministic per-run system prompt (takes precedence over presetAgent).
  // Used by role runs (e.g. the reviewer contract) so prompts don't depend on
  // user-authored agent files.
  systemPrompt?: string
  // Read-only runs (reviewer role) get write tools stripped at the runner —
  // read-only is enforced by the toolset, not just the system prompt.
  readOnly?: boolean
}

export type OrchestraConfig = {
  parentProvider: ProviderId
  parentModel: string
  workers: WorkerConfig[]
  logBufferLines?: number
  maxParallel?: number
}

export type WorkerDispatchResult = {
  workerIdx: number
  workerId: string
  status: "done" | "error" | "aborted"
  output: string
  tokensIn?: number
  tokensOut?: number
  errorMessage?: string
  durationMs: number
  isolated?: boolean
  branch?: string
  committed?: boolean
  commitSha?: string
  changedFiles?: string[]
  diffSummary?: string
  isolationNote?: string
}

export type AgentCardStatus =
  | "pending"
  | "running"
  | "waiting-approval"
  | "done"
  | "error"
  | "aborted"

export type AgentCardToolCall = {
  name: string
  status: "running" | "done" | "error"
}

export type AgentCardPart = {
  type: "agent-card"
  workerId: string
  workerIdx: number
  taskNum: number
  task?: string
  workerLabel: string
  displayName?: string
  // opencode-style task card metadata. `agentType` is the subagent/agent name
  // shown as the card title, `agentColor` is the resolved accent tone, and
  // `workerSessionId` is the child session the card navigates to when clicked.
  agentType?: string
  agentColor?: string
  workerSessionId?: string
  description?: string
  kind: WorkerKind
  configSnapshot: Pick<
    WorkerConfig,
    "kind" | "provider" | "model" | "yolo" | "presetAgent" | "acpCommand"
  >
  status: AgentCardStatus
  outputLog: string[]
  toolCalls?: AgentCardToolCall[]
  finalText?: string
  tokensIn?: number
  tokensOut?: number
  startedAt?: number
  finishedAt?: number
  errorMessage?: string
}

export type WorkerEvent =
  | { type: "started" }
  | { type: "log"; line: string }
  | { type: "text-delta"; delta: string }
  | { type: "tool-call"; name: string; id?: string }
  | { type: "tool-result"; name: string; id?: string; isError?: boolean; error?: string }
  | { type: "usage"; tokensIn?: number; tokensOut?: number }
  | { type: "waiting-approval"; toolName: string }
  | { type: "complete"; text: string }
  | { type: "error"; message: string }
  | { type: "aborted" }

export type WorkerHandle = {
  workerId: string
  abort: () => void
  done: Promise<WorkerDispatchResult>
}

// Runner factory — config + task + emitter → handle
export type RunnerStart = (input: {
  workerId: string
  config: WorkerConfig
  task: string
  workWorkspace?: string
  configWorkspace?: string
  emit: (event: WorkerEvent) => void
  signal: AbortSignal
  ownerSessionId: string
}) => Promise<{ done: Promise<WorkerDispatchResult> }>
