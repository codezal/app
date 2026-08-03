// Session-based parallel agents — each worker runs as a full session shown as
// a tab next to the parent chat (never in the sidebar). Results are collected
// when the worker's stream completes, then the worker session is removed: the
// agent-task card in the parent timeline keeps the summary/final text as the
// record of the run (opencode parity).
//
// App.tsx registers the runStream function at startup via setWorkerStreamFn.
// delegate_agents / spawn_agent call dispatchWorkerSessions which:
//   1. creates a worker session per dispatch (createWorkerSession)
//   2. pushes the task as a user message + pending assistant bubble
//   3. awaits runStream on each worker (parallel, respects AbortSignal)
//   4. extracts the final text from the worker's assistant message
//   5. removes the worker session (transient; resumed sessions are kept)
//   6. returns structured results to the calling tool

import type { ModelMessage } from "ai"
import type { ProviderId } from "./providers"
import { useSessionsStore } from "@/store/sessions"
import { createId } from "./id"
import { Semaphore } from "./async/semaphore"
import type { Message } from "@/store/types"

// The runStream function signature (App.tsx's makeRunStream output).
type WorkerStreamFn = (
  sid: string,
  asstMsgId: string,
  history: ModelMessage[],
) => Promise<void>

let streamFn: WorkerStreamFn | null = null

export function setWorkerStreamFn(fn: WorkerStreamFn): void {
  streamFn = fn
}

export type WorkerSessionDispatch = {
  task: string
  title: string
  provider: ProviderId
  model: string
  workspacePath?: string
  handle?: string
  readOnly?: boolean
  // Resume an existing worker session instead of creating a fresh one
  // (opencode `task_id`). Falls back to a new session when unset/unknown.
  resumeSessionId?: string
}

export type WorkerSessionResult = {
  status: "done" | "error" | "aborted"
  output: string
  errorMessage?: string
  workerSessionId: string
  durationMs: number
}



export async function dispatchWorkerSessions(opts: {
  parentSessionId: string
  dispatches: WorkerSessionDispatch[]
  signal?: AbortSignal
  // Cap on concurrent worker runs (Settings → Agent Orchestration
  // maxParallelRuns). Unset/<=1 falls back to fully-parallel execution.
  maxParallel?: number
  // Invoked with the created worker session id right after the session exists,
  // so the caller can attach an agent-task card before the stream starts.
  onSessionCreated?: (index: number, workerSessionId: string) => void
}): Promise<WorkerSessionResult[]> {
  const { parentSessionId, dispatches, signal, maxParallel, onSessionCreated } = opts
  if (!streamFn) {
    return dispatches.map(() => ({
      status: "error" as const,
      output: "",
      errorMessage: "Worker stream function not registered",
      workerSessionId: "",
      durationMs: 0,
    }))
  }
  const run = streamFn

  const store = useSessionsStore.getState()

  // The worker body must be deferred into the semaphore slot — creating the
  // promises eagerly would start every async body (up to its first await)
  // before the cap ever gates them, making maxParallel a no-op.
  const runOne = async (d: WorkerSessionDispatch, index: number): Promise<WorkerSessionResult> => {
    const startedAt = Date.now()
    let workerSid = ""
    // Freshly-created workers are transient and removed on completion; resumed
    // sessions (opencode `task_id`) are the caller's and stay untouched.
    let resumed = false
    try {
      // 1. Reuse a prior worker session when resuming (opencode `task_id`),
      // otherwise create a fresh one (shown as a tab next to the parent chat).
      const resumable =
        d.resumeSessionId &&
        d.resumeSessionId !== parentSessionId &&
        useSessionsStore.getState().sessions[d.resumeSessionId]
      if (resumable) {
        workerSid = d.resumeSessionId!
        resumed = true
      } else {
        workerSid = await store.createWorkerSession({
          ownerSessionId: parentSessionId,
          title: d.title,
          provider: d.provider,
          model: d.model,
          workspacePath: d.workspacePath,
          handle: d.handle,
          readOnly: d.readOnly,
        })
      }

      // Let the caller attach its agent-task card (workerSessionId) before the
      // stream starts, so the card is present while the worker runs.
      onSessionCreated?.(index, workerSid)

      // 2. Push the task as a user message + pending assistant bubble.
      const userMsg: Message = {
        id: createId("message"),
        role: "user",
        content: d.task,
        modelMsgCount: 1,
      }
      const asstMsg: Message = {
        id: createId("message"),
        role: "assistant",
        content: "",
        parts: [],
        pending: true,
      }
      const st = useSessionsStore.getState()
      st.pushMessageFor(workerSid, userMsg)
      st.pushMessageFor(workerSid, asstMsg)

      // 3. Build history and run the stream.
      const snap = useSessionsStore.getState().sessions[workerSid]
      const history: ModelMessage[] = [
        ...(snap?.modelMessages ?? []),
        { role: "user", content: d.task },
      ]

      await run(workerSid, asstMsg.id, history)

      // 4. Extract the result.
      if (signal?.aborted) {
        return {
          status: "aborted",
          output: "",
          workerSessionId: workerSid,
          durationMs: Date.now() - startedAt,
        }
      }

      const finalSession = useSessionsStore.getState().sessions[workerSid]
      const finalMsg = finalSession?.messages.find((m) => m.id === asstMsg.id)
      const output = finalMsg?.content?.trim() || "(empty response)"
      const hasError = finalMsg?.parts?.some(
        (p) => p.type === "tool-result" && p.isError,
      )

      return {
        status: hasError ? "error" : "done",
        output,
        errorMessage: hasError ? output : undefined,
        workerSessionId: workerSid,
        durationMs: Date.now() - startedAt,
      }
    } catch (e) {
      return {
        status: signal?.aborted ? "aborted" : "error",
        output: "",
        errorMessage: e instanceof Error ? e.message : String(e),
        workerSessionId: workerSid,
        durationMs: Date.now() - startedAt,
      }
    } finally {
      // 5. Workers are transient: remove the session (DB row + store) once the
      // run settles so the sidebar/tabs stay clean. The parent's agent-task
      // card keeps the summary/final text as the record of the run. If the
      // user was viewing the worker, removeWorkerSession reopens the parent.
      if (workerSid && !resumed) {
        await useSessionsStore.getState().removeWorkerSession(workerSid)
      }
    }
  }

  // Respect the configured concurrency cap instead of fanning everything out at
  // once. maxParallelRuns is currently declared in SupervisorSettings but was
  // never enforced on the live path — wire it here.
  if (maxParallel && maxParallel > 1 && maxParallel < dispatches.length) {
    const semaphore = new Semaphore(maxParallel)
    return Promise.all(
      dispatches.map((d, index) => semaphore.run(() => runOne(d, index))),
    )
  }
  return Promise.all(dispatches.map(runOne))
}
