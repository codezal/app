// Session-based parallel agents — each worker runs as a full session (visible
// in the sidebar under its parent) instead of an ephemeral agent card. Results
// are collected when the worker's stream completes; the session is removed from
// the sidebar afterwards.
//
// App.tsx registers the runStream function at startup via setWorkerStreamFn.
// delegate_agents / spawn_agent call dispatchWorkerSessions which:
//   1. creates a worker session per dispatch (createWorkerSession)
//   2. pushes the task as a user message + pending assistant bubble
//   3. awaits runStream on each worker (parallel, respects AbortSignal)
//   4. extracts the final text from the worker's assistant message
//   5. removes the worker session from the sidebar after a short grace period
//   6. returns structured results to the calling tool

import type { ModelMessage } from "ai"
import type { ProviderId } from "./providers"
import { useSessionsStore } from "@/store/sessions"
import { createId } from "./id"
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
}

export type WorkerSessionResult = {
  status: "done" | "error" | "aborted"
  output: string
  errorMessage?: string
  workerSessionId: string
  durationMs: number
}

// How long (ms) to keep the completed worker session visible in the sidebar
// before auto-removing it. Gives the user a moment to see the result and click
// through if they want the full transcript.
const REMOVAL_GRACE_MS = 4_000

export async function dispatchWorkerSessions(opts: {
  parentSessionId: string
  dispatches: WorkerSessionDispatch[]
  signal?: AbortSignal
}): Promise<WorkerSessionResult[]> {
  const { parentSessionId, dispatches, signal } = opts
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

  const runs = dispatches.map(async (d): Promise<WorkerSessionResult> => {
    const startedAt = Date.now()
    let workerSid = ""
    try {
      // 1. Create the worker session (visible in sidebar under parent).
      workerSid = await store.createWorkerSession({
        ownerSessionId: parentSessionId,
        title: d.title,
        provider: d.provider,
        model: d.model,
        workspacePath: d.workspacePath,
        handle: d.handle,
        readOnly: d.readOnly,
      })

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
      // 5. Schedule removal after a grace period so the user can see the
      // completed session briefly in the sidebar.
      if (workerSid) {
        const sid = workerSid
        setTimeout(() => {
          void useSessionsStore.getState().removeWorkerSession(sid)
        }, REMOVAL_GRACE_MS)
      }
    }
  })

  return Promise.all(runs)
}
