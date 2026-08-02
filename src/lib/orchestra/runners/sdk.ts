// SDK worker runner — buildModel + streamText + buildAllTools reuse.
import { streamText, isStepCount, type ModelMessage } from "ai"
import { buildLanguageModel, transformHistory, buildProviderOptions } from "../../providers"
import { buildAllTools, READONLY_ALLOW } from "../../tools"
import { findAgent } from "../../agents"
import { useSettingsStore } from "@/store/settings"
import { useApprovalsStore } from "@/store/approvals"
import { makeToolCallRepair } from "../../tool-repair"
import { errorMessage } from "@/lib/errors"
import type {
  RunnerStart,
  WorkerDispatchResult,
} from "../types"

const DEFAULT_SYSTEM = `You are a Codezal worker. Complete the single assigned task with tools, then return a brief final summary. The parent agent dispatched you; do not add unnecessary conversation.

Work discipline:
- Fix the root cause, not the symptom.
- If you changed code, verify it yourself BEFORE reporting: run the relevant tests and type checks, and inspect the output.
- In the final summary, state what you did and the verification result (passed/failed) in one line; do not hide failures.`

// Read-only browser observation tools kept for reviewer runs (the mutating
// browser_* tools are dropped with the allow-list below).
const READ_ONLY_BROWSER = new Set([
  "browser_screenshot",
  "browser_snapshot",
  "browser_read_console",
  "browser_read_network",
  "browser_scroll",
  "browser_hover",
  "browser_wait",
])

export const startSdkWorker: RunnerStart = async ({
  workerId,
  config,
  task,
  workWorkspace,
  configWorkspace,
  emit,
  signal,
}) => {
  const settings = useSettingsStore.getState().settings

  if (config.yolo) {
    useApprovalsStore.getState().addBypassWorker(workerId)
  }

  const cleanup = () => {
    if (config.yolo) {
      useApprovalsStore.getState().removeBypassWorker(workerId)
    }
  }

  const startedAt = Date.now()
  const done = new Promise<WorkerDispatchResult>((resolve) => {
    void (async () => {
      try {
        const provider = config.provider ?? settings.defaultProvider
        const modelId = config.model ?? settings.defaultModel

        let systemPrompt = DEFAULT_SYSTEM
        if (config.systemPrompt) {
          systemPrompt = config.systemPrompt
        } else {
          const presetName = config.presetAgent ?? settings.defaultAgent
          if (presetName) {
            const ag = await findAgent(configWorkspace, presetName)
            if (ag) systemPrompt = ag.systemPrompt
          }
        }

        const model = await buildLanguageModel({ providerId: provider, modelId, settings })
        // ownerSessionId = workerId: isolate tools that write session state.
        const tools = await buildAllTools(
          workWorkspace,
          settings.mcpServers ?? [],
          workerId,
          configWorkspace,
        )
        // Read-only runs (reviewer): keep ONLY read-only tools — an allow-list
        // derived from the workspaceReadOnly set plus read-only browser
        // observation. Everything else (writes, exec, delegation, PR/worktree,
        // job control, MCP servers, cross-session writes) is dropped, so
        // read-only is enforced by the toolset, not the system prompt.
        if (config.readOnly) {
          for (const name of Object.keys(tools)) {
            if (!READONLY_ALLOW.has(name) && !READ_ONLY_BROWSER.has(name)) delete tools[name]
          }
        }

        emit({ type: "started" })

        const messages = transformHistory(
          [{ role: "user", content: task }] as ModelMessage[],
          provider,
          modelId,
        )
        const providerOptions = buildProviderOptions({
          providerId: provider,
          modelId,
          sessionId: workerId,
          effort: undefined,
          reasoningCapable: false,
        })

        const result = streamText({
          model,
          instructions: systemPrompt,
          messages,
          ...(Object.keys(providerOptions).length > 0
            ? { providerOptions: providerOptions as Parameters<typeof streamText>[0]["providerOptions"] }
            : {}),
          tools,
          stopWhen: isStepCount(40),
          abortSignal: signal,
          experimental_repairToolCall: makeToolCallRepair(),
          onError: ({ error }) => {
            console.error(`[sdk-worker ${workerId}] stream error:`, error)
          },
        })

        let finalText = ""
        for await (const chunk of result.stream) {
          if (signal.aborted) break
          switch (chunk.type) {
            case "text-delta": {
              const delta = chunk.text ?? ""
              if (delta) {
                finalText += delta
                emit({ type: "text-delta", delta })
              }
              break
            }
            case "tool-call":
              emit({
                type: "tool-call",
                name: chunk.toolName,
                id: chunk.toolCallId,
              })
              break
            case "tool-result":
              emit({
                type: "tool-result",
                name: chunk.toolName,
                id: chunk.toolCallId,
              })
              break
            case "tool-error": {
              const toolErr = errorMessage(chunk.error)
              // Surface the real error in the agent card's output log so it is
              // visible in the UI without digging through ~/.codezal/error.log.
              emit({ type: "log", line: `[tool-error] ${chunk.toolName}: ${toolErr}` })
              emit({
                type: "tool-result",
                name: chunk.toolName,
                id: chunk.toolCallId,
                isError: true,
                error: toolErr,
              })
              break
            }
            case "error": {
              const err = chunk.error
              const msg = errorMessage(err)
              throw new Error(msg)
            }
            case "finish":
              break
          }
        }

        // Final usage
        let tokensIn: number | undefined
        let tokensOut: number | undefined
        try {
          const usage = await result.usage
          if (usage) {
            tokensIn = usage.inputTokens ?? undefined
            tokensOut = usage.outputTokens ?? undefined
            emit({ type: "usage", tokensIn, tokensOut })
          }
        } catch {
          // Intentionally ignored.
        }

        if (signal.aborted) {
          emit({ type: "aborted" })
          resolve({
            workerIdx: config.idx,
            workerId,
            status: "aborted",
            output: finalText,
            tokensIn,
            tokensOut,
            durationMs: Date.now() - startedAt,
          })
          return
        }

        emit({ type: "complete", text: finalText })
        resolve({
          workerIdx: config.idx,
          workerId,
          status: "done",
          output: finalText || "(empty response)",
          tokensIn,
          tokensOut,
          durationMs: Date.now() - startedAt,
        })
      } catch (e) {
        const msg = errorMessage(e)
        emit({ type: "error", message: msg })
        resolve({
          workerIdx: config.idx,
          workerId,
          status: signal.aborted ? "aborted" : "error",
          output: "",
          errorMessage: msg,
          durationMs: Date.now() - startedAt,
        })
      } finally {
        cleanup()
      }
    })()
  })

  return { done }
}
