import type { Session } from "@/store/types"
import { errorMessage } from "@/lib/errors"
import { runGit } from "@/lib/tools/worktree"
import { RunSupervisor } from "./supervisor"
import { resolveRoleEngine } from "./roles"
import type { AgentRoleId, AgentRunResult, SupervisorSettings } from "./types"
import { useAgentRunsStore } from "@/store/agent-runs"
import { createId } from "@/lib/id"
import {
  dispatchWorkerSessions,
  type WorkerSessionDispatch,
} from "@/lib/worker-session"

export type DelegateAgentsInput = {
  session: Session
  parentMessageId: string
  settings: SupervisorSettings
  dispatches: Array<{ role: AgentRoleId; task: string }>
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

  // Register runs for budget tracking.
  const runIds = input.dispatches.map(() => createId("worker"))
  for (const [index, dispatch] of input.dispatches.entries()) {
    useAgentRunsStore.getState().start({
      runId: runIds[index],
      parentRunId: input.parentMessageId,
      sessionId: input.session.id,
      poolEntryId: dispatch.role,
      task: dispatch.task,
      status: "running",
      startedAt: Date.now() + index,
    })
  }

  // Build session-based worker dispatches.
  const workerDispatches: WorkerSessionDispatch[] = resolved.map((dispatch, index) => {
    const engine = engineFor(input.session, input.settings, dispatch.role)
    const provider = engine.kind === "sdk" ? engine.providerId : input.session.provider
    const model = engine.kind === "sdk" ? engine.modelId : input.session.model
    const role = input.dispatches[index]?.role ?? "worker"
    return {
      task: dispatch.task,
      title: `⚙ ${role} · task-${index + 1}`,
      provider,
      model,
      workspacePath: input.session.workspacePath,
      handle: `${role}-${index + 1}-${input.session.id.slice(-6)}`,
      readOnly: role === "reviewer",
    }
  })

  try {
    const results = await dispatchWorkerSessions({
      parentSessionId: input.session.id,
      dispatches: workerDispatches,
      signal: input.signal,
    })

    const normalized: AgentRunResult[] = results.map((r, index) => {
      const runId = runIds[index]
      const result: AgentRunResult = {
        status: r.status,
        output: r.output,
        errorMessage: r.errorMessage,
        durationMs: r.durationMs,
      }
      if (runId) useAgentRunsStore.getState().finish(runId, result)
      return result
    })
    return normalized
  } catch (error) {
    // Never leave worker tracking stuck at "running".
    const failRun = (runId: string) => {
      const run = useAgentRunsStore.getState().runs[runId]
      if (!run || run.status !== "running") return
      useAgentRunsStore.getState().finish(runId, {
        status: "error",
        output: "",
        errorMessage: errorMessage(error),
        durationMs: Date.now() - (run.startedAt ?? Date.now()),
      })
    }
    runIds.forEach(failRun)
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
