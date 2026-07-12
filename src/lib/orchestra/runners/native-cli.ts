import { getAgentRuntimeClient } from "@/lib/agent-providers/runtime-client"
import {
  agentProviderSettings,
  resolveNativeAgentMode,
  type AgentRuntimeEvent,
  type CliAgentProviderId,
} from "@/lib/agent-providers"
import { findAgent } from "@/lib/agents"
import { errorMessage } from "@/lib/errors"
import { useApprovalsStore } from "@/store/approvals"
import { useSettingsStore } from "@/store/settings"
import type { RunnerStart, WorkerDispatchResult } from "../types"

const DEFAULT_SYSTEM = "Complete the assigned task with your native tools, verify changes, then return a concise result."

export const startNativeCliWorker: RunnerStart = async (input) => {
  const { workerId, config, task, workWorkspace, configWorkspace, emit, signal, ownerSessionId } = input
  const provider = config.kind as CliAgentProviderId
  if (provider !== "codex-cli" && provider !== "claude-cli") {
    throw new Error(`Unsupported native CLI worker: ${config.kind}`)
  }
  const startedAt = Date.now()
  const runtime = getAgentRuntimeClient()
  const settings = useSettingsStore.getState().settings
  let runtimeSessionId = ""
  let output = ""
  let tokensIn: number | undefined
  let tokensOut: number | undefined

  const done = new Promise<WorkerDispatchResult>((resolve) => {
    const finish = (result: WorkerDispatchResult) => {
      unsubscribe()
      signal.removeEventListener("abort", onAbort)
      if (runtimeSessionId) void runtime.closeSession(runtimeSessionId).catch(() => undefined)
      resolve(result)
    }
    const handleEvent = (event: AgentRuntimeEvent) => {
      if (event.providerId !== provider || event.sessionId !== runtimeSessionId) return
      if (event.type === "text_delta") {
        output += event.delta
        emit({ type: "text-delta", delta: event.delta })
      } else if (event.type === "reasoning_delta") {
        emit({ type: "log", line: event.delta })
      } else if (event.type === "tool_call") {
        emit({ type: "tool-call", name: event.name, id: event.id })
      } else if (event.type === "tool_result") {
        emit({ type: "tool-result", name: event.name, id: event.id, isError: event.isError })
      } else if (event.type === "permission_requested") {
        emit({ type: "waiting-approval", toolName: event.request.name })
        void useApprovalsStore.getState()
          .request(event.request.name, event.request.input ?? {}, {
            workerId,
            workerLabel: config.label ?? config.presetAgent ?? config.kind,
            sessionId: ownerSessionId,
            runId: workerId,
            agentId: config.presetAgent ?? config.kind,
          })
          .then((decision) => runtime.resolvePermission(event.request.id, decision))
          .catch(() => runtime.resolvePermission(event.request.id, "deny"))
      } else if (event.type === "usage") {
        tokensIn = event.inputTokens
        tokensOut = event.outputTokens
        emit({ type: "usage", tokensIn, tokensOut })
      } else if (event.type === "turn_completed") {
        emit({ type: "complete", text: output })
        finish(result("done"))
      } else if (event.type === "turn_failed") {
        emit({ type: "error", message: event.error })
        finish(result("error", event.error))
      } else if (event.type === "turn_canceled") {
        emit({ type: "aborted" })
        finish(result("aborted"))
      } else if (event.type === "stderr" && event.line.trim()) {
        emit({ type: "log", line: event.line.trimEnd() })
      }
    }
    const result = (status: WorkerDispatchResult["status"], failure?: string): WorkerDispatchResult => ({
      workerIdx: config.idx,
      workerId,
      status,
      output,
      tokensIn,
      tokensOut,
      errorMessage: failure,
      durationMs: Date.now() - startedAt,
    })
    const unsubscribe = runtime.subscribe(handleEvent)
    const onAbort = () => {
      if (runtimeSessionId) void runtime.interrupt(runtimeSessionId).catch(() => undefined)
    }

    void (async () => {
      try {
        const preset = config.presetAgent ? await findAgent(configWorkspace, config.presetAgent) : null
        const mode = config.yolo
          ? "bypass"
          : resolveNativeAgentMode({ approvalMode: settings.approvalMode, sessionMode: "build" })
        const created = await runtime.createSession({
          providerId: provider,
          ownerSessionId,
          cwd: workWorkspace,
          model: config.model,
          mode,
          injectCodezalTools: agentProviderSettings(settings, provider).injectCodezalTools !== false,
        })
        runtimeSessionId = created.sessionId
        signal.addEventListener("abort", onAbort, { once: true })
        if (signal.aborted) {
          onAbort()
          emit({ type: "aborted" })
          finish(result("aborted"))
          return
        }
        emit({ type: "started" })
        await runtime.startTurn({
          sessionId: runtimeSessionId,
          prompt: task,
          model: config.model,
          mode,
          providerSettings: agentProviderSettings(settings, provider),
          systemPrompt: preset?.systemPrompt ?? DEFAULT_SYSTEM,
        })
      } catch (error) {
        const message = errorMessage(error)
        emit({ type: "error", message })
        finish(result(signal.aborted ? "aborted" : "error", message))
      }
    })()
  })
  return { done }
}
