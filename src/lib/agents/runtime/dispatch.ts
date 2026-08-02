import type { Session } from "@/store/types"
import { dispatchWorkers } from "@/lib/orchestra/runtime"
import { findRepoRoot, runGit } from "@/lib/tools/worktree"
import { mergeWorkerBranches } from "@/lib/orchestra/isolation"
import { errorMessage } from "@/lib/errors"
import { RunSupervisor } from "./supervisor"
import { resolveRoleEngine, workerConfigForRole } from "./roles"
import type { AgentRoleId, AgentRunResult, SupervisorSettings } from "./types"
import { useAgentRunsStore } from "@/store/agent-runs"
import { createId } from "@/lib/id"

export type DelegateAgentsInput = {
  session: Session
  parentMessageId: string
  settings: SupervisorSettings
  dispatches: Array<{ role: AgentRoleId; task: string }>
  signal?: AbortSignal
}

const MAX_REVIEW_DIFF_CHARS = 40_000

// Deterministic reviewer contract (Kun-style structured findings). The diff is
// passed in the task; the worker never touches the working tree.
export const REVIEW_SYSTEM_PROMPT = `You are a senior code reviewer. Review the diff provided in the task and produce a findings report.

Return a markdown report with:
1. **Verdict**: one line — "Approved", "Approved with nits", or "Changes requested".
2. **Findings**: for each issue — severity (\`critical\` | \`warning\` | \`nit\`), \`file:line\`, what the issue is, why it matters, and a concrete suggested fix.

Rules:
- Only report real, actionable issues; do not invent problems.
- Prioritize correctness, security, and hidden behavior over style.
- Do not modify any files. This is a read-only review.`

function engineFor(session: Session, settings: SupervisorSettings, role: AgentRoleId) {
  return (
    resolveRoleEngine(settings, role, session) ?? {
      kind: "sdk" as const,
      providerId: session.provider,
      modelId: session.model,
    }
  )
}

async function currentHead(workspacePath?: string): Promise<string | null> {
  if (!workspacePath) return null
  const repoPath = await findRepoRoot(workspacePath)
  if (!repoPath) return null
  try {
    const out = await runGit(repoPath, ["rev-parse", "HEAD"])
    return out.stdout.trim() || null
  } catch {
    return null
  }
}

async function diffSince(repoPath: string, baseSha: string): Promise<string | null> {
  try {
    const stat = await runGit(repoPath, ["diff", "--stat", `${baseSha}..HEAD`])
    const body = await runGit(repoPath, ["diff", `${baseSha}..HEAD`])
    const capped = body.stdout.length > MAX_REVIEW_DIFF_CHARS
      ? body.stdout.slice(0, MAX_REVIEW_DIFF_CHARS) + "\n…(diff truncated)"
      : body.stdout
    return `<diff-stat>\n${stat.stdout.trim() || "(empty)"}\n</diff-stat>\n<diff>\n${capped}\n</diff>`
  } catch {
    return null
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
  const workers = resolved.map((dispatch, index) =>
    workerConfigForRole({
      role: dispatch.role,
      engine: engineFor(input.session, input.settings, dispatch.role),
      idx: index + 1,
      session: input.session,
    }),
  )
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
  const controller = new AbortController()
  const abort = () => controller.abort()
  input.signal?.addEventListener("abort", abort, { once: true })
  const deadline = setTimeout(abort, input.settings.maxWallClockMs)
  const baseSha = await currentHead(input.session.workspacePath)
  try {
    const raw = await dispatchWorkers(
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
    await mergeSuccessfulRuns(input, raw)
    await autoReview(input, raw, baseSha, controller.signal)
    const normalized = raw.map(({ workerIdx: _workerIdx, workerId: _workerId, ...result }) => result)
    normalized.forEach((result, index) => {
      const runId = runIds[index]
      if (runId) useAgentRunsStore.getState().finish(runId, result)
    })
    return normalized
  } catch (error) {
    // Fail hard, but never leave worker tracking stuck at "running" (that would
    // inflate existingChildCount for later delegations in the same turn).
    for (const runId of runIds) {
      useAgentRunsStore.getState().finish(runId, {
        status: "error",
        output: "",
        errorMessage: errorMessage(error),
        durationMs: Date.now() - (useAgentRunsStore.getState().runs[runId]?.startedAt ?? Date.now()),
      })
    }
    throw error
  } finally {
    clearTimeout(deadline)
    input.signal?.removeEventListener("abort", abort)
  }
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

// Optional post-delegation review: when enabled and workers committed changes,
// a reviewer run reviews the merged diff and is appended as an extra result.
async function autoReview(
  input: DelegateAgentsInput,
  results: Awaited<ReturnType<typeof dispatchWorkers>>,
  baseSha: string | null,
  signal: AbortSignal,
): Promise<void> {
  if (!input.settings.autoReview) return
  // The reviewer diffs baseSha..HEAD — worker changes only land in HEAD under
  // the safe-auto merge policy. Manual merges (or conflicts) would show the
  // reviewer an empty/wrong diff, so skip.
  if (input.settings.mergePolicy !== "safe-auto") return
  if (!baseSha || !input.session.workspacePath) return
  const committed = results.some((r) => r.status === "done" && r.committed)
  if (!committed) return
  const repoPath = await findRepoRoot(input.session.workspacePath)
  if (!repoPath) return
  const diff = await diffSince(repoPath, baseSha)
  if (!diff) return
  const review = await runReviewer({
    session: input.session,
    parentMessageId: input.parentMessageId,
    settings: input.settings,
    diff,
    signal,
  })
  if (review.status === "done") {
    results.push({
      workerIdx: results.length + 1,
      workerId: `review-${Date.now()}`,
      status: "done",
      output: review.output,
      durationMs: review.durationMs,
    })
  }
}

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

// Run a single reviewer pass over a diff using the `reviewer` role engine
// (inherits the session model when not pinned). Streams an agent card.
export async function runReviewer(input: {
  session: Session
  parentMessageId: string
  settings: SupervisorSettings
  diff: string
  signal?: AbortSignal
}): Promise<AgentRunResult> {
  const reviewer = engineFor(input.session, input.settings, "reviewer")
  const idx = 1
  const [result] = await dispatchWorkers(
    {
      parentProvider: input.session.provider,
      parentModel: input.session.model,
      workers: [
        workerConfigForRole({
          role: "reviewer",
          engine: reviewer,
          idx,
          session: input.session,
          systemPrompt: REVIEW_SYSTEM_PROMPT,
          label: "reviewer",
        }),
      ],
      maxParallel: 1,
    },
    [{ workerIdx: idx, task: `Review these changes:\n\n${input.diff}` }],
    input.parentMessageId,
    input.session.id,
    input.session.workspacePath,
    input.signal,
  )
  if (!result) return { status: "error", output: "", errorMessage: "Reviewer run returned no result", durationMs: 0 }
  const rest = {
    status: result.status,
    output: result.output,
    durationMs: result.durationMs,
    tokensIn: result.tokensIn,
    tokensOut: result.tokensOut,
    errorMessage: result.errorMessage,
    isolated: result.isolated,
    branch: result.branch,
    committed: result.committed,
    changedFiles: result.changedFiles,
    diffSummary: result.diffSummary,
    isolationNote: result.isolationNote,
  }
  return rest
}
