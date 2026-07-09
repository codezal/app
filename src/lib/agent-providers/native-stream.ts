import type { ModelMessage } from "ai"
import { useApprovalsStore } from "@/store/approvals"
import { useSessionsStore } from "@/store/sessions"
import type { Message, Part, Session } from "@/store/types"
import { errorMessage } from "@/lib/errors"
import { getAgentRuntimeClient } from "./runtime-client"
import {
  agentProviderSettings,
  isCliAgentProvider,
  resolveNativeAgentMode,
  type AgentRuntimeEvent,
  type CliAgentProviderId,
} from "."
import type { Settings } from "@/store/types"

type RunNativeAgentStreamArgs = {
  sid: string
  asstMsgId: string
  history: ModelMessage[]
  signal: AbortSignal
  settings: Settings
  session: Session
  provider: CliAgentProviderId
  modelId: string
}

function collapseText(parts: Part[]): string {
  return parts
    .filter((p) => p.type === "text")
    .map((p) => (p as { text: string }).text)
    .join("\n\n")
}

function lastUserText(history: ModelMessage[]): string {
  for (let i = history.length - 1; i >= 0; i--) {
    const msg = history[i]
    if (msg.role !== "user") continue
    if (typeof msg.content === "string") return msg.content
    if (Array.isArray(msg.content)) {
      return msg.content
        .map((part) => {
          if (part && typeof part === "object" && "text" in part && typeof part.text === "string") {
            return part.text
          }
          return ""
        })
        .filter(Boolean)
        .join("\n")
    }
  }
  return ""
}

function buildNativeSystemPrompt(session: Session, provider: CliAgentProviderId): string {
  const providerLabel = provider === "codex-cli" ? "Codex CLI" : "Claude CLI"
  const mode = session.mode ?? "build"
  return [
    `You are running inside Codezal through ${providerLabel}.`,
    `Codezal session mode: ${mode}.`,
    "Use the provider's native tool and permission system. Codezal tools are available through MCP when configured; prefer Codezal code/codemap tools for repository navigation. Reply in the user's language.",
  ].join("\n")
}

function isUnknownRuntimeSessionError(error: unknown, runtimeSessionId: string | undefined): boolean {
  if (!runtimeSessionId) return false
  const message = errorMessage(error)
  return message.includes(`Unknown session: ${runtimeSessionId}`)
}

export async function runNativeAgentStream(args: RunNativeAgentStreamArgs): Promise<void> {
  const { sid, asstMsgId, history, signal, settings, session, provider, modelId } = args
  if (!isCliAgentProvider(provider)) return
  const runtime = getAgentRuntimeClient()
  const parts: Part[] = []
  let textBuf = ""
  let reasoningBuf = ""
  const existingNative = session.nativeAgent?.providerId === provider ? session.nativeAgent : undefined
  let runtimeSessionId = existingNative?.runtimeSessionId
  let nativeHandle = existingNative?.nativeHandle
  let completed = false
  let failure: string | null = null
  const patchFor = (patch: Partial<Message>) =>
    useSessionsStore.getState().patchMessageFor(sid, asstMsgId, patch)
  const flush = () => {
    const next = [...parts]
    if (reasoningBuf) next.push({ type: "reasoning", text: reasoningBuf })
    if (textBuf) next.push({ type: "text", text: textBuf })
    patchFor({ parts: next, content: collapseText(next) })
  }
  const finishBuffers = () => {
    if (reasoningBuf) {
      parts.push({ type: "reasoning", text: reasoningBuf })
      reasoningBuf = ""
    }
    if (textBuf) {
      parts.push({ type: "text", text: textBuf })
      textBuf = ""
    }
  }
  const handleEvent = (event: AgentRuntimeEvent) => {
    if (event.sessionId !== runtimeSessionId || event.providerId !== provider) return
    switch (event.type) {
      case "thread_started":
        nativeHandle = event.nativeHandle ?? nativeHandle
        useSessionsStore.getState().updateMetaFor(sid, {
          nativeAgent: {
            providerId: provider,
            runtimeSessionId,
            nativeHandle,
            cwd: session.workspacePath,
            model: modelId,
            mode: resolveNativeAgentMode({
              approvalMode: settings.approvalMode,
              sessionMode: session.mode,
            }),
          },
        })
        break
      case "text_delta":
        if (reasoningBuf) {
          parts.push({ type: "reasoning", text: reasoningBuf })
          reasoningBuf = ""
        }
        textBuf += event.delta
        flush()
        break
      case "reasoning_delta":
        if (textBuf) {
          parts.push({ type: "text", text: textBuf })
          textBuf = ""
        }
        reasoningBuf += event.delta
        flush()
        break
      case "tool_call":
        finishBuffers()
        parts.push({
          type: "tool-call",
          toolCallId: event.id,
          toolName: event.name,
          input: event.input,
        })
        flush()
        break
      case "tool_result":
        finishBuffers()
        parts.push({
          type: "tool-result",
          toolCallId: event.id,
          toolName: event.name,
          output: event.output ?? "",
          isError: event.isError,
        })
        flush()
        break
      case "permission_requested":
        void useApprovalsStore
          .getState()
          .request(event.request.name, event.request.input ?? {}, {
            workerId: event.request.id,
            workerLabel: event.request.title,
          })
          .then((decision) => runtime.resolvePermission(event.request.id, decision))
          .catch(() => runtime.resolvePermission(event.request.id, "deny"))
        break
      case "usage":
        useSessionsStore.getState().addUsageFor(sid, {
          inputTokens: event.inputTokens ?? 0,
          outputTokens: event.outputTokens ?? 0,
          reasoningTokens: event.reasoningTokens ?? 0,
          costUsd: event.costUsd ?? 0,
        })
        break
      case "turn_completed":
        completed = true
        nativeHandle = event.nativeHandle ?? nativeHandle
        break
      case "turn_failed":
        failure = event.error
        completed = true
        break
      case "turn_canceled":
        completed = true
        break
    }
  }

  const unsubscribe = runtime.subscribe(handleEvent)
  try {
    const mode = resolveNativeAgentMode({
      approvalMode: settings.approvalMode,
      sessionMode: session.mode,
    })
    const sessionParams = {
      providerId: provider,
      ownerSessionId: sid,
      cwd: session.workspacePath,
      model: modelId,
      mode,
      injectCodezalTools: agentProviderSettings(settings, provider).injectCodezalTools !== false,
    }
    const writeNativeMeta = () => {
      useSessionsStore.getState().updateMetaFor(sid, {
        nativeAgent: {
          providerId: provider,
          runtimeSessionId,
          nativeHandle,
          cwd: session.workspacePath,
          model: modelId,
          mode,
        },
      })
    }
    const openRuntimeSession = async () => {
      const created = nativeHandle
        ? await runtime.resumeSession({ ...sessionParams, nativeHandle })
        : await runtime.createSession(sessionParams)
      runtimeSessionId = created.sessionId
      writeNativeMeta()
    }
    if (!runtimeSessionId) {
      await openRuntimeSession()
    }
    if (signal.aborted) {
      if (runtimeSessionId) await runtime.interrupt(runtimeSessionId).catch(() => undefined)
      return
    }
    const onAbort = () => {
      if (runtimeSessionId) void runtime.interrupt(runtimeSessionId).catch(() => undefined)
    }
    signal.addEventListener("abort", onAbort, { once: true })
    try {
      const startTurn = async () => {
        const currentRuntimeSessionId = runtimeSessionId
        if (!currentRuntimeSessionId) throw new Error("Native agent runtime session is not open")
        await runtime.startTurn({
          sessionId: currentRuntimeSessionId,
          prompt: lastUserText(history),
          model: modelId,
          mode,
          providerSettings: agentProviderSettings(settings, provider),
          systemPrompt: buildNativeSystemPrompt(session, provider),
        })
      }
      try {
        await startTurn()
      } catch (error) {
        if (!isUnknownRuntimeSessionError(error, runtimeSessionId)) throw error
        runtimeSessionId = undefined
        await openRuntimeSession()
        if (signal.aborted) return
        await startTurn()
      }
      while (!completed && !signal.aborted) {
        await new Promise((resolve) => setTimeout(resolve, 50))
      }
      if (failure) throw new Error(failure)
    } finally {
      signal.removeEventListener("abort", onAbort)
    }
    finishBuffers()
    const content = collapseText(parts)
    useSessionsStore.getState().replaceModelMessagesFor(sid, [
      ...history,
      ...(content.trim() ? [{ role: "assistant", content } as ModelMessage] : []),
    ])
    patchFor({
      parts: [...parts],
      content,
      pending: false,
      modelMsgCount: content.trim() ? 1 : 0,
    })
    useSessionsStore.getState().updateMetaFor(sid, {
      nativeAgent: {
        providerId: provider,
        runtimeSessionId,
        nativeHandle,
        cwd: session.workspacePath,
        model: modelId,
        mode,
      },
    })
    await useSessionsStore.getState().persistSession(sid)
  } catch (error) {
    finishBuffers()
    const partialText = collapseText(parts)
    patchFor({
      parts: [...parts],
      content: partialText || errorMessage(error),
      pending: false,
      modelMsgCount: partialText.trim() ? 1 : 0,
    })
    if (partialText.trim()) {
      useSessionsStore.getState().replaceModelMessagesFor(sid, [
        ...history,
        { role: "assistant", content: partialText } as ModelMessage,
      ])
    }
    await useSessionsStore.getState().persistSession(sid).catch(() => undefined)
    throw error
  } finally {
    unsubscribe()
  }
}
