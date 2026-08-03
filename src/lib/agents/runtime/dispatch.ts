import type { Session } from "@/store/types"
import { errorMessage } from "@/lib/errors"
import { runGit } from "@/lib/tools/worktree"
import { RunSupervisor } from "./supervisor"
import { resolveRoleEngine } from "./roles"
import type { AgentRoleId, AgentRunResult, SupervisorSettings } from "./types"
import { useAgentRunsStore } from "@/store/agent-runs"
import { useSessionsStore } from "@/store/sessions"
import { createId } from "@/lib/id"
import { findAgent } from "@/lib/agents"
import type { AgentCardPart } from "@/lib/orchestra/types"
import {
  dispatchWorkerSessions,
  type WorkerSessionDispatch,
} from "@/lib/worker-session"

export type DelegateAgentsInput = {
  session: Session
  parentMessageId: string
  settings: SupervisorSettings
  dispatches: Array<{
    role: AgentRoleId
    // Optional named agent (opencode `subagent_type`). Resolves model/prompt/
    // title from a user agent file; unset → plain role run.
    agent?: string
    // Short 3-5 word label shown as the task-card subtitle (opencode
    // `description`). Unset → first line of the task, truncated.
    description?: string
    // Resume a prior subagent session (opencode `task_id`) instead of starting
    // fresh. Unset → new worker session.
    taskId?: string
    task: string
  }>
  signal?: AbortSignal
}

function engineFor(session: Session, settings: SupervisorSettings, role: AgentRoleId) {
  return (
    resolveRoleEngine(settings, role, session) ?? {
      kind: "sdk" as const,
      providerId: session.provider,
      modelId: session.model,
    }
  )
}

export type TaskCardMeta = { agentType?: string; description?: string }

// Runs session-based workers and keeps an opencode-style agent-task card on the
// parent message in sync for each dispatch (pushed before the stream starts,
// workerSessionId attached on creation, status/final text settled on finish).
// Shared by delegate_agents (dispatchSupervisorAgents) and spawn_agent so every
// parallel-agent path shows live, clickable task cards.
export async function dispatchWorkerSessionsWithCards(input: {
  session: Session
  parentMessageId: string
  dispatches: WorkerSessionDispatch[]
  cards?: TaskCardMeta[]
  // Caller-supplied card ids (e.g. agent-run ids) so external tracking can
  // correlate; generated when omitted.
  workerIds?: string[]
  maxParallel?: number
  signal?: AbortSignal
}): Promise<import("@/lib/worker-session").WorkerSessionResult[]> {
  const store = useSessionsStore.getState()
  const ids = input.workerIds ?? input.dispatches.map(() => createId("worker"))
  const now = Date.now()
  input.dispatches.forEach((d, i) => {
    const meta = input.cards?.[i]
    const agentName = meta?.agentType ?? "worker"
    const first = d.task.split("\n")[0]?.trim() ?? ""
    const description = meta?.description?.trim() || d.title || (first ? first.slice(0, 80) : agentName)
    store.pushAgentCardFor(input.session.id, input.parentMessageId, {
      type: "agent-card",
      workerId: ids[i],
      workerIdx: i,
      taskNum: i + 1,
      task: d.task,
      description,
      workerLabel: `${agentName} · task-${i + 1}`,
      displayName: agentName,
      agentType: agentName,
      kind: "sdk",
      configSnapshot: { kind: "sdk", yolo: false },
      status: "running",
      outputLog: [],
      toolCalls: [],
      startedAt: now + i,
    })
  })

  const patch = (i: number, p: Partial<AgentCardPart>) =>
    store.patchAgentCardFor(input.session.id, input.parentMessageId, ids[i], p)

  try {
    const results = await dispatchWorkerSessions({
      parentSessionId: input.session.id,
      dispatches: input.dispatches,
      signal: input.signal,
      maxParallel: input.maxParallel,
      onSessionCreated: (i, sid) => patch(i, { workerSessionId: sid }),
    })
    results.forEach((r, i) => {
      patch(i, {
        status: r.status === "done" ? "done" : r.status === "aborted" ? "aborted" : "error",
        finalText: r.output,
        errorMessage: r.errorMessage,
        finishedAt: Date.now(),
      })
    })
    return results
  } catch (error) {
    input.dispatches.forEach((_d, i) => {
      patch(i, { status: "error", errorMessage: errorMessage(error), finishedAt: Date.now() })
    })
    throw error
  }
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

  // Resolve optional named agents (opencode `subagent_type`) up front so model
  // routing and card titles are deterministic before dispatch.
  const agentDefs = await Promise.all(
    input.dispatches.map((d) =>
      d.agent ? findAgent(input.session.workspacePath, d.agent) : Promise.resolve(null),
    ),
  )

  const descriptionOf = (index: number, fallbackRole: string): string => {
    const explicit = input.dispatches[index]?.description?.trim()
    if (explicit) return explicit
    const firstLine = input.dispatches[index]?.task.split("\n")[0]?.trim()
    return firstLine ? firstLine.slice(0, 80) : fallbackRole
  }

  // Register runs for budget tracking.
  const runIds = input.dispatches.map(() => createId("worker"))
  const now = Date.now()
  for (const [index, dispatch] of input.dispatches.entries()) {
    useAgentRunsStore.getState().start({
      runId: runIds[index],
      parentRunId: input.parentMessageId,
      sessionId: input.session.id,
      poolEntryId: dispatch.role,
      task: dispatch.task,
      status: "running",
      startedAt: now + index,
    })
  }

  // Build session-based worker dispatches + aligned task-card metadata.
  const cards: TaskCardMeta[] = []
  const workerDispatches: WorkerSessionDispatch[] = resolved.map((dispatch, index) => {
    const def = agentDefs[index]
    const engine = engineFor(input.session, input.settings, dispatch.role)
    const role = input.dispatches[index]?.role ?? "worker"
    // Named-agent model pin wins over the role engine; fall back to role/session.
    const provider =
      def?.provider ?? (engine.kind === "sdk" ? engine.providerId : input.session.provider)
    const model = def?.model ?? (engine.kind === "sdk" ? engine.modelId : input.session.model)
    const agentName = def?.name ?? role
    const description = descriptionOf(index, agentName)
    cards.push({ agentType: agentName, description })
    const title = input.dispatches[index]?.description?.trim()
      ? `${input.dispatches[index]!.description!.trim()} (@${agentName} subagent)`
      : `⚙ ${agentName} · task-${index + 1}`
    return {
      task: dispatch.task,
      title,
      provider,
      model,
      workspacePath: input.session.workspacePath,
      handle: `${agentName}-${index + 1}-${input.session.id.slice(-6)}`,
      readOnly: role === "reviewer",
      resumeSessionId: input.dispatches[index]?.taskId,
    }
  })

  try {
    const results = await dispatchWorkerSessionsWithCards({
      session: input.session,
      parentMessageId: input.parentMessageId,
      dispatches: workerDispatches,
      cards,
      workerIds: runIds,
      maxParallel: input.settings.maxParallelRuns,
      signal: input.signal,
    })

    return results.map((r, index) => {
      const runId = runIds[index]
      const result: AgentRunResult = {
        status: r.status,
        output: r.output,
        errorMessage: r.errorMessage,
        durationMs: r.durationMs,
        workerSessionId: r.workerSessionId || undefined,
      }
      if (runId) useAgentRunsStore.getState().finish(runId, result)
      return result
    })
  } catch (error) {
    // Never leave worker tracking stuck at "running" (cards are settled by the
    // helper's catch path).
    for (const runId of runIds) {
      const run = useAgentRunsStore.getState().runs[runId]
      if (run && run.status === "running") {
        useAgentRunsStore.getState().finish(runId, {
          status: "error",
          output: "",
          errorMessage: errorMessage(error),
          durationMs: Date.now() - (run.startedAt ?? Date.now()),
        })
      }
    }
    throw error
  }
}

const MAX_REVIEW_DIFF_CHARS = 40_000

// Deterministic reviewer contract (Kun-style structured findings).
export const REVIEW_SYSTEM_PROMPT = `You are a senior code reviewer. Review the diff provided in the task and produce a findings report.

Return a markdown report with:
1. **Verdict**: one line — "Approved", "Approved with nits", or "Changes requested".
2. **Findings**: for each issue — severity (\`critical\` | \`warning\` | \`nit\`), \`file:line\`, what the issue is, why it matters, and a concrete suggested fix.

Rules:
- Only report real, actionable issues; do not invent problems.
- Prioritize correctness, security, and hidden behavior over style.
- Do not modify any files. This is a read-only review.`

// Collect the working-tree diff (staged + unstaged tracked changes) for a
// manual review_changes call. Returns null when there is nothing to review.
export async function collectWorkingDiff(repoPath: string): Promise<string | null> {
  try {
    const staged = await runGit(repoPath, ["diff", "--cached"])
    const unstaged = await runGit(repoPath, ["diff"])
    const stat = await runGit(repoPath, ["diff", "HEAD", "--stat"])
    const body = `${staged.stdout}\n${unstaged.stdout}`.trim()
    if (!body) return null
    const capped =
      body.length > MAX_REVIEW_DIFF_CHARS
        ? body.slice(0, MAX_REVIEW_DIFF_CHARS) + "\n…(diff truncated)"
        : body
    return `<diff-stat>\n${stat.stdout.trim() || "(empty)"}\n</diff-stat>\n<diff>\n${capped}\n</diff>`
  } catch {
    return null
  }
}

// Run a single reviewer pass over a diff as a read-only worker session.
export async function runReviewer(input: {
  session: Session
  parentMessageId: string
  settings: SupervisorSettings
  diff: string
  signal?: AbortSignal
}): Promise<AgentRunResult> {
  const reviewer = engineFor(input.session, input.settings, "reviewer")
  const provider = reviewer.kind === "sdk" ? reviewer.providerId : input.session.provider
  const model = reviewer.kind === "sdk" ? reviewer.modelId : input.session.model
  const [result] = await dispatchWorkerSessions({
    parentSessionId: input.session.id,
    dispatches: [
      {
        task: `Review these changes:\n\n${input.diff}`,
        title: "⚙ reviewer",
        provider,
        model,
        workspacePath: input.session.workspacePath,
        readOnly: true,
      },
    ],
    signal: input.signal,
  })
  if (!result) return { status: "error", output: "", errorMessage: "Reviewer run returned no result", durationMs: 0 }
  return {
    status: result.status,
    output: result.output,
    errorMessage: result.errorMessage,
    durationMs: result.durationMs,
  }
}
