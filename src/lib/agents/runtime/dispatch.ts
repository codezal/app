import type { Session } from "@/store/types"
import { dispatchWorkers } from "@/lib/orchestra/runtime"
import { findRepoRoot } from "@/lib/tools/worktree"
import { mergeWorkerBranches } from "@/lib/orchestra/isolation"
import { RunSupervisor } from "./supervisor"
import { workerConfigForPoolEntry } from "./orchestra-adapter"
import type { AgentRunResult, SupervisorSettings } from "./types"
import { useAgentRunsStore } from "@/store/agent-runs"
import { createId } from "@/lib/id"

export type DelegateAgentsInput = {
  session: Session
  parentMessageId: string
  settings: SupervisorSettings
  dispatches: Array<{ poolEntryId: string; task: string }>
  signal?: AbortSignal
}

export async function dispatchSupervisorAgents(input: DelegateAgentsInput): Promise<AgentRunResult[]> {
  const supervisor = new RunSupervisor(input.settings)
  const existingChildCount = useAgentRunsStore.getState().forParent(input.parentMessageId).length
  const resolved = supervisor.resolve({
    sessionId: input.session.id,
    parentRunId: input.parentMessageId,
    depth: 0,
    existingChildCount,
    signal: input.signal,
    dispatches: input.dispatches,
  })
  const workers = resolved.map((entry, index) => workerConfigForPoolEntry(entry, index + 1))
  const runIds = input.dispatches.map(() => createId("worker"))
  for (const [index, dispatch] of input.dispatches.entries()) {
    useAgentRunsStore.getState().start({
      runId: runIds[index],
      parentRunId: input.parentMessageId,
      sessionId: input.session.id,
      poolEntryId: dispatch.poolEntryId,
      task: dispatch.task,
      status: "running",
      startedAt: Date.now() + index,
    })
  }
  const controller = new AbortController()
  const abort = () => controller.abort()
  input.signal?.addEventListener("abort", abort, { once: true })
  const deadline = setTimeout(abort, input.settings.maxWallClockMs)
  let results: Awaited<ReturnType<typeof dispatchWorkers>>
  try {
    results = await dispatchWorkers(
      {
        parentProvider: input.session.provider,
        parentModel: input.session.model,
        workers,
        maxParallel: input.settings.maxParallelRuns,
      },
      input.dispatches.map((dispatch, index) => ({ workerIdx: index + 1, task: dispatch.task })),
      input.parentMessageId,
      input.session.id,
      input.session.workspacePath,
      controller.signal,
    )
    await mergeSuccessfulRuns(input, results)
  } finally {
    clearTimeout(deadline)
    input.signal?.removeEventListener("abort", abort)
  }
  const normalized = results.map(({ workerIdx: _workerIdx, workerId: _workerId, ...result }) => result)
  normalized.forEach((result, index) => useAgentRunsStore.getState().finish(runIds[index], result))
  return normalized
}

async function mergeSuccessfulRuns(
  input: DelegateAgentsInput,
  results: Awaited<ReturnType<typeof dispatchWorkers>>,
): Promise<void> {
  if (input.settings.mergePolicy !== "safe-auto" || !input.session.workspacePath) return
  const branches = results
    .filter((result) => result.status === "done" && result.committed && result.branch)
    .map((result) => result.branch as string)
  if (branches.length === 0) return
  const repoPath = await findRepoRoot(input.session.workspacePath)
  if (!repoPath) return
  const outcomes = await mergeWorkerBranches(repoPath, branches)
  for (const outcome of outcomes) {
    const result = results.find((candidate) => candidate.branch === outcome.branch)
    if (!result) continue
    result.isolationNote = outcome.status === "merged"
      ? `merged into parent (${outcome.mergeSha ?? "unknown"})`
      : outcome.note ?? (outcome.conflictFiles?.length ? `merge conflict: ${outcome.conflictFiles.join(", ")}` : outcome.status)
  }
}
