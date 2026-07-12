import type { WorkerConfig, WorkerKind } from "@/lib/orchestra/types"
import type { SupervisorPoolEntry } from "./types"

const ACP_KINDS = new Set<WorkerKind>([
  "opencode-cli",
  "kimi-cli",
  "gemini-cli",
  "acp",
])

export type WorkerExecutionAdapter = "sdk" | "native-cli" | "acp"

export function workerExecutionAdapter(kind: WorkerKind): WorkerExecutionAdapter {
  if (kind === "sdk") return "sdk"
  if (kind === "codex-cli" || kind === "claude-cli") return "native-cli"
  return "acp"
}

function acpWorkerKind(providerId: string): WorkerKind {
  return ACP_KINDS.has(providerId as WorkerKind) ? (providerId as WorkerKind) : "acp"
}

export function workerConfigForPoolEntry(
  entry: SupervisorPoolEntry,
  idx: number,
): WorkerConfig {
  const presetAgent = entry.agentName === "general" ? undefined : entry.agentName
  if (entry.engine.kind === "sdk") {
    return {
      idx,
      kind: "sdk",
      provider: entry.engine.providerId,
      model: entry.engine.modelId,
      yolo: false,
      presetAgent,
      label: entry.label,
    }
  }
  if (entry.engine.kind === "native-cli") {
    return {
      idx,
      kind: entry.engine.providerId,
      model: entry.engine.modelId,
      yolo: false,
      presetAgent,
      label: entry.label,
    }
  }
  return {
    idx,
    kind: acpWorkerKind(entry.engine.providerId),
    model: entry.engine.modelId,
    acpCommand: entry.engine.command,
    yolo: false,
    presetAgent,
    label: entry.label,
  }
}
